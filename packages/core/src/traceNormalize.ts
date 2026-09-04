/**
 * Three ways in, one trace out.
 *
 * A Chrome extension is a fine way to record a person using a web app, and a
 * terrible way to record work that happens in a terminal, a desktop client or
 * a queue of API calls. Insisting on one producer would quietly restrict
 * RigorRun to workflows that happen to live in a browser tab, so the recorder
 * is treated as one source among several and everything downstream reads only
 * the canonical form.
 */
import { CANONICAL_TRACE_SCHEMA_VERSION } from './versions.ts';
import {
  CanonicalHumanTraceSchema,
  type Actor,
  type CanonicalHumanTrace,
  type StatePayload,
  type TraceStep,
} from './canonicalTrace.ts';
import type { WorkflowTrace } from './trace.ts';

export interface NormalizeOptions {
  environmentId: string;
  actor?: Actor;
  before?: StatePayload;
  after?: StatePayload;
  /**
   * Maps an application's observation names onto environment action names,
   * for recordings made against an instrumented UI. Without it, observations
   * are still carried; they simply are not treated as actions.
   */
  observationToAction?: Record<string, string>;
  name?: string;
  id?: string;
}

const DEFAULT_ACTOR: Actor = { id: 'operator', kind: 'human', label: 'Operator' };

/** The Chrome recorder's output. */
export function fromWorkflowTrace(
  trace: WorkflowTrace,
  options: NormalizeOptions,
): CanonicalHumanTrace {
  const steps: TraceStep[] = trace.events.map((event, index) => {
    const surface = [
      event.target?.nearbyText,
      event.target?.accessibleName,
      event.target?.label,
      event.target?.placeholder,
      typeof event.observation?.data['text'] === 'string'
        ? String(event.observation.data['text'])
        : undefined,
    ].filter((text): text is string => typeof text === 'string' && text.trim().length > 0);

    const actionName =
      event.observation && options.observationToAction
        ? options.observationToAction[event.observation.name]
        : undefined;

    const ui = {
      ...(event.url ? { url: event.url } : {}),
      ...(event.pageTitle ? { pageTitle: event.pageTitle } : {}),
      ...(event.target?.selector ? { selector: event.target.selector } : {}),
      ...(event.target?.role ? { role: event.target.role } : {}),
      ...(event.target?.accessibleName ? { accessibleName: event.target.accessibleName } : {}),
      ...(event.target?.label ? { label: event.target.label } : {}),
      ...(event.value === undefined ? {} : { value: event.value }),
    };

    return {
      id: event.id,
      ordinal: index,
      at: event.at,
      kind: stepKind(event.type),
      ...(actionName
        ? { action: { name: actionName, args: event.observation?.data ?? {}, ok: true } }
        : {}),
      ...(event.observation
        ? { observation: { name: event.observation.name, data: event.observation.data } }
        : {}),
      surfaceText: [...new Set(surface)],
      ...(Object.keys(ui).length > 0 ? { ui } : {}),
    } satisfies TraceStep;
  });

  return finalise(
    {
      id: options.id ?? trace.id,
      name: options.name ?? trace.name,
      recordedAt: trace.recordedAt,
      durationMs: trace.durationMs,
      source: 'browser_recorder',
      app: trace.app,
      steps,
      meta: trace.meta,
    },
    options,
  );
}

export interface ActionLogEntry {
  /** Milliseconds since the work began. */
  at: number;
  action: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  actor?: string;
  /** Policy text the operator was looking at, if the log carries any. */
  surfaceText?: string[];
}

/**
 * An API or action log — the path for workflows where a browser extension
 * would be inappropriate, and the one that needs no UI instrumentation at all.
 */
export function fromActionLog(
  entries: readonly ActionLogEntry[],
  options: NormalizeOptions & { id: string; name: string; recordedAt?: string },
): CanonicalHumanTrace {
  const steps: TraceStep[] = entries.map((entry, index) => ({
    id: `step_${String(index + 1).padStart(3, '0')}`,
    ordinal: index,
    at: entry.at,
    kind: 'action',
    action: { name: entry.action, args: entry.args ?? {}, ok: entry.ok ?? true },
    surfaceText: entry.surfaceText ?? [],
  }));

  const last = entries[entries.length - 1];
  return finalise(
    {
      id: options.id,
      name: options.name,
      recordedAt: options.recordedAt ?? new Date(0).toISOString(),
      durationMs: last?.at ?? 0,
      source: 'action_log',
      steps,
      meta: {
        recorder: 'rigorrun-action-log',
        recorderVersion: '1',
        redaction: 'caller-supplied',
        droppedSensitiveEvents: 0,
      },
    },
    options,
  );
}

/** A trace assembled by hand or exported from another tool. */
export function fromStructuredImport(input: unknown): CanonicalHumanTrace {
  return CanonicalHumanTraceSchema.parse(input);
}

function stepKind(type: string): TraceStep['kind'] {
  switch (type) {
    case 'navigate':
      return 'navigation';
    case 'input':
    case 'change':
    case 'select':
      return 'input';
    case 'app_observation':
      return 'observation';
    default:
      return 'note';
  }
}

function finalise(
  partial: Omit<CanonicalHumanTrace, 'schemaVersion' | 'environmentId' | 'actor'>,
  options: NormalizeOptions,
): CanonicalHumanTrace {
  return CanonicalHumanTraceSchema.parse({
    ...partial,
    schemaVersion: CANONICAL_TRACE_SCHEMA_VERSION,
    environmentId: options.environmentId,
    actor: options.actor ?? DEFAULT_ACTOR,
    ...(options.before ? { before: options.before } : {}),
    ...(options.after ? { after: options.after } : {}),
  });
}
