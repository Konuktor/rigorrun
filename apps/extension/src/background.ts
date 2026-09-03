/**
 * The recorder's service worker.
 *
 * It owns the trace: content scripts propose events, this worker timestamps,
 * numbers and stores them. Everything stays in extension-local storage until
 * the user exports it or sends it to their own machine — nothing is uploaded
 * anywhere, and the extension has no remote host permissions to do so with.
 */
import { TRACE_SCHEMA_VERSION } from '@rigorrun/core/versions.ts';
import { randomId } from '@rigorrun/core/ids.ts';
import type { TraceEvent, WorkflowTrace } from '@rigorrun/core/trace.ts';
import {
  DEFAULT_STATE,
  type ContentMessage,
  type PopupMessage,
  type RecorderState,
} from './messages.ts';

const STORAGE_KEY = 'rigorrun.recording.v1';
const MAX_EVENTS = 5000;

interface Recording extends RecorderState {
  events: TraceEvent[];
}

/**
 * Messages are handled one at a time.
 *
 * Every handler is read-modify-write over one storage key, and a page can emit
 * several events in the same tick (a refund and its audit entry, say). Without
 * this queue the second write would load the pre-first-write state and silently
 * drop an event.
 */
let queue: Promise<void> = Promise.resolve();
function enqueue(work: () => Promise<void>): void {
  queue = queue.then(work, work).catch(() => undefined);
}

async function load(): Promise<Recording> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as Recording | undefined) ?? { ...DEFAULT_STATE, events: [] };
}

async function save(recording: Recording): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: recording });
}

async function setBadge(recording: Recording): Promise<void> {
  const text =
    recording.status === 'idle'
      ? ''
      : recording.status === 'paused'
        ? '||'
        : String(recording.eventCount);
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({
    color: recording.status === 'recording' ? '#3ecf8e' : '#6b7482',
  });
}

async function broadcastRecordingFlag(active: boolean): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'recorder:setRecording', recording: active });
      } catch {
        // No content script in that tab. Expected for most tabs.
      }
    }),
  );
}

function buildTrace(recording: Recording): WorkflowTrace {
  const last = recording.events.at(-1);
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    id: `trace_${randomId(10)}`,
    name: recording.title || 'Recorded workflow',
    recordedAt: new Date(recording.startedAt ?? Date.now()).toISOString(),
    durationMs: last?.at ?? 0,
    app: { origin: recording.origin ?? '', title: recording.title },
    events: recording.events,
    meta: {
      recorder: 'rigorrun-chrome-extension',
      recorderVersion: chrome.runtime.getManifest().version,
      redaction: 'rigorrun-redaction-v1',
      droppedSensitiveEvents: recording.droppedSensitiveEvents,
    },
  };
}

chrome.runtime.onMessage.addListener(
  (message: PopupMessage | ContentMessage, sender, sendResponse): boolean => {
    enqueue(async () => {
      const recording = await load();

      switch (message.type) {
        case 'recorder:event': {
          // Only a content script may contribute events.
          if (!sender.tab) return sendResponse({ ok: false });
          if (recording.status !== 'recording') return sendResponse({ ok: false });
          if (recording.events.length >= MAX_EVENTS)
            return sendResponse({ ok: false, reason: 'full' });

          const startedAt = recording.startedAt ?? Date.now();
          const event: TraceEvent = {
            ...message.event,
            index: recording.events.length,
            at: Math.max(0, Date.now() - startedAt),
          };
          recording.events.push(event);
          recording.eventCount = recording.events.length;
          recording.startedAt = startedAt;
          await save(recording);
          await setBadge(recording);
          return sendResponse({ ok: true });
        }

        case 'recorder:dropped': {
          if (!sender.tab) return sendResponse({ ok: false });
          recording.droppedSensitiveEvents += 1;
          await save(recording);
          return sendResponse({ ok: true });
        }

        case 'recorder:pageInfo': {
          if (!sender.tab) return sendResponse({ ok: false });
          if (recording.status === 'recording' && !recording.origin) {
            recording.origin = message.origin;
            recording.title = message.title;
            await save(recording);
          }
          return sendResponse({ ok: true });
        }

        case 'recorder:start': {
          const fresh: Recording = {
            ...DEFAULT_STATE,
            status: 'recording',
            startedAt: Date.now(),
            events: [],
          };
          await save(fresh);
          await setBadge(fresh);
          await broadcastRecordingFlag(true);
          return sendResponse({ ok: true, state: toState(fresh) });
        }

        case 'recorder:pause': {
          recording.status = 'paused';
          await save(recording);
          await setBadge(recording);
          await broadcastRecordingFlag(false);
          return sendResponse({ ok: true, state: toState(recording) });
        }

        case 'recorder:resume': {
          recording.status = 'recording';
          await save(recording);
          await setBadge(recording);
          await broadcastRecordingFlag(true);
          return sendResponse({ ok: true, state: toState(recording) });
        }

        case 'recorder:stop': {
          recording.status = 'idle';
          await save(recording);
          await setBadge(recording);
          await broadcastRecordingFlag(false);
          return sendResponse({ ok: true, state: toState(recording) });
        }

        case 'recorder:reset': {
          const fresh: Recording = { ...DEFAULT_STATE, events: [] };
          await save(fresh);
          await setBadge(fresh);
          await broadcastRecordingFlag(false);
          return sendResponse({ ok: true, state: toState(fresh) });
        }

        case 'recorder:getState':
          return sendResponse({ ok: true, state: toState(recording) });

        case 'recorder:export':
          return sendResponse({ ok: true, trace: buildTrace(recording) });

        case 'recorder:send': {
          const trace = buildTrace(recording);
          try {
            // Loopback only. The manifest grants no other host permission, so
            // this cannot be pointed at a remote server.
            const response = await fetch(`http://127.0.0.1:${message.port}/trace`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(trace),
            });
            const body = (await response.json()) as { ok?: boolean; error?: string };
            return sendResponse({
              ok: response.ok && body.ok !== false,
              error: body.error ?? null,
            });
          } catch (error) {
            return sendResponse({ ok: false, error: (error as Error).message });
          }
        }

        default:
          return sendResponse({ ok: false, error: 'unknown message' });
      }
    });

    // Keep the message channel open for the async work above.
    return true;
  },
);

function toState(recording: Recording): RecorderState {
  const { events: _events, ...state } = recording;
  return state;
}
