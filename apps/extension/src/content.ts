/**
 * The recorder.
 *
 * This is the most safety-critical code in RigorRun: it watches a person doing
 * real work inside a real business application. Two rules govern everything
 * here.
 *
 *  1. Capture *meaning*, not the page. Role, accessible name, label, a ranked
 *     selector and a short slice of nearby text — never the DOM, never a
 *     screenshot, never innerHTML.
 *
 *  2. Redact before anything leaves this function. Credential-like fields never
 *     have their value read at all; every value and URL that is read passes
 *     through the shared redactor first.
 */
// Imported from leaf modules on purpose: a content script must stay small, and
// nothing here needs the schema validation library that `@rigorrun/core`'s
// entry point pulls in.
import {
  isSensitiveField,
  redactFieldValue,
  redactText,
  sanitizeUrl,
} from '@rigorrun/core/redaction.ts';
import { bestSelector, type ElementFacts } from '@rigorrun/core/selector.ts';
import type { ElementDescriptor, TraceEvent, TraceEventType } from '@rigorrun/core/trace.ts';
import type { ContentMessage } from './messages.ts';

const NEARBY_TEXT_LIMIT = 240;

let recording = false;
/** Unknown until the worker answers; observations are buffered until then. */
let recordingKnown = false;
let sequence = 0;
let lastUrl = location.href;

/**
 * A page emits its first semantic observations the moment it mounts, which can
 * be before the worker has told us a recording is in progress. Those events are
 * held here and flushed once the answer arrives, so a workflow does not lose
 * its opening step to a round-trip.
 */
const pending: { type: TraceEventType; extra: Record<string, unknown> }[] = [];
const PENDING_LIMIT = 20;

function send(message: ContentMessage): void {
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    // The extension was reloaded or the context is gone. Recording simply stops.
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string; recording?: boolean }) => {
  if (message?.type === 'recorder:setRecording') {
    recording = Boolean(message.recording);
    recordingKnown = true;
    if (recording) {
      flushPending();
      send({ type: 'recorder:pageInfo', origin: location.origin, title: document.title });
      emit('navigate', {});
    }
  }
});

// Announce ourselves so the popup knows a recordable page is present.
send({ type: 'recorder:pageInfo', origin: location.origin, title: document.title });

/**
 * A recorded workflow crosses pages, and every navigation loads a fresh copy of
 * this script. Ask the worker whether a recording is in progress rather than
 * waiting for a broadcast that already happened.
 */
void (async () => {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'recorder:getState' })) as {
      state?: { status?: string };
    };
    recordingKnown = true;
    if (response?.state?.status === 'recording') {
      recording = true;
      send({ type: 'recorder:pageInfo', origin: location.origin, title: document.title });
      emit('navigate', {});
      flushPending();
    } else {
      pending.length = 0;
    }
  } catch {
    // No worker yet, or the extension is reloading. Recording stays off.
    recordingKnown = true;
    pending.length = 0;
  }
})();

function flushPending(): void {
  const buffered = pending.splice(0, pending.length);
  for (const item of buffered) emit(item.type, item.extra);
}

/* ------------------------------------------------------------ element facts */

function accessibleName(element: Element): string | undefined {
  const aria = element.getAttribute('aria-label');
  if (aria) return clean(aria);

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (parts.trim()) return clean(parts);
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const labels = (element as HTMLInputElement).labels;
    if (labels && labels.length > 0) return clean(labels[0]?.textContent ?? '');
  }

  const text = element.textContent ?? '';
  return text.trim() ? clean(text) : undefined;
}

function implicitRole(element: Element): string | undefined {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;

  const tag = element.tagName.toLowerCase();
  if (tag === 'a') return element.hasAttribute('href') ? 'link' : undefined;
  if (tag === 'button') return 'button';
  if (tag === 'form') return 'form';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const type = (element as HTMLInputElement).type;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'number') return 'spinbutton';
    if (type === 'submit' || type === 'button') return 'button';
    return 'textbox';
  }
  return undefined;
}

/** A short CSS path, used only when nothing more durable exists. */
function domPath(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  let depth = 0;
  while (node && depth < 4 && node.tagName !== 'BODY') {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const index = [...parent.children].filter((c) => c.tagName === node!.tagName).indexOf(node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
    node = parent;
    depth += 1;
  }
  return parts.join(' > ');
}

/**
 * A little context around the interaction — a policy banner above a field, the
 * row a button sits in. Bounded and redacted; this is not a page snapshot.
 */
function nearbyText(element: Element): string | undefined {
  const container = element.closest('form, section, article, li, tr, fieldset, div');
  if (!container) return undefined;
  const text = clean(container.textContent ?? '');
  if (!text) return undefined;
  return redactText(text.slice(0, NEARBY_TEXT_LIMIT));
}

function labelText(element: Element): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const labels = element.labels;
    if (labels && labels.length > 0) return clean(labels[0]?.textContent ?? '');
  }
  const wrapping = element.closest('label');
  return wrapping ? clean(wrapping.textContent ?? '') : undefined;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function describe(element: Element): ElementDescriptor {
  const input = element as HTMLInputElement;
  const facts: ElementFacts = {
    tagName: element.tagName.toLowerCase(),
    testId: element.getAttribute('data-testid') ?? undefined,
    id: element.id || undefined,
    name: input.name || undefined,
    role: implicitRole(element),
    accessibleName: accessibleName(element),
    label: labelText(element),
    placeholder: element.getAttribute('placeholder') ?? undefined,
    inputType: input.type || undefined,
    domPath: domPath(element),
  };

  const { selector, strategy, candidates } = bestSelector(facts);
  const nearby = nearbyText(element);

  return {
    tagName: facts.tagName,
    ...(facts.role ? { role: facts.role } : {}),
    ...(facts.accessibleName ? { accessibleName: facts.accessibleName } : {}),
    ...(facts.testId ? { testId: facts.testId } : {}),
    ...(facts.id ? { elementId: facts.id } : {}),
    ...(facts.name ? { name: facts.name } : {}),
    ...(facts.label ? { label: facts.label } : {}),
    ...(facts.placeholder ? { placeholder: facts.placeholder } : {}),
    ...(facts.inputType ? { inputType: facts.inputType } : {}),
    ...(nearby ? { nearbyText: nearby } : {}),
    selector,
    selectorStrategy: strategy,
    candidates,
  };
}

/* -------------------------------------------------------------- event emit */

function emit(
  type: TraceEventType,
  extra: Partial<Omit<TraceEvent, 'id' | 'index' | 'at' | 'type' | 'url' | 'pageTitle'>>,
): void {
  if (!recordingKnown) {
    if (pending.length < PENDING_LIMIT) pending.push({ type, extra });
    return;
  }
  if (!recording) return;
  sequence += 1;
  const event: Omit<TraceEvent, 'index'> = {
    id: `ev_${String(sequence).padStart(3, '0')}`,
    type,
    at: 0, // the background worker stamps this against the recording start
    url: sanitizeUrl(location.href),
    pageTitle: redactText(document.title).slice(0, 160),
    ...extra,
  };
  send({ type: 'recorder:event', event });
}

document.addEventListener(
  'click',
  (event) => {
    if (!recording) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionable = target.closest(
      'a, button, [role="button"], [role="link"], [data-testid], input, select',
    );
    if (!actionable) return;
    emit('click', { target: describe(actionable) });
  },
  true,
);

document.addEventListener(
  'change',
  (event) => {
    if (!recording) return;
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement) &&
      !(target instanceof HTMLSelectElement)
    )
      return;

    const field = {
      name: target.getAttribute('name') ?? undefined,
      id: target.id || undefined,
      type: (target as HTMLInputElement).type || undefined,
      autocomplete: target.getAttribute('autocomplete') ?? undefined,
      label: labelText(target),
      placeholder: target.getAttribute('placeholder') ?? undefined,
    };

    // A credential-like field's value is never read, not even to redact it.
    if (isSensitiveField(field)) {
      send({ type: 'recorder:dropped' });
      emit(target instanceof HTMLSelectElement ? 'select' : 'input', { target: describe(target) });
      return;
    }

    const raw = target instanceof HTMLSelectElement ? target.value : target.value;
    emit(target instanceof HTMLSelectElement ? 'select' : 'input', {
      target: describe(target),
      value: redactFieldValue(raw, field).slice(0, 200),
    });
  },
  true,
);

document.addEventListener(
  'submit',
  (event) => {
    if (!recording) return;
    const target = event.target;
    if (target instanceof Element) emit('submit', { target: describe(target) });
  },
  true,
);

/**
 * Optional semantic instrumentation. An application that emits these gives the
 * compiler far more to work with; nothing depends on them existing.
 */
window.addEventListener('rigorrun:observation', (event) => {
  const detail = (event as CustomEvent).detail as { name?: string; data?: Record<string, unknown> };
  if (!detail?.name) return;
  emit('app_observation', {
    observation: {
      name: String(detail.name).slice(0, 80),
      data: sanitizeObservation(detail.data ?? {}),
    },
  });
});

function sanitizeObservation(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data).slice(0, 20)) {
    if (typeof value === 'string') out[key] = redactFieldValue(value, { name: key }).slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      out[key] = value;
  }
  return out;
}

/** SPA navigation: the URL changes without a page load. */
setInterval(() => {
  if (!recording) return;
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    emit('navigate', {});
  }
}, 300);
