/**
 * The canonical human trace.
 *
 * A recording of a person doing real work, in a form that does not care how it
 * was captured. A Chrome extension is one producer; an API action log is
 * another; a hand-written import is a third. They normalise to this, and
 * everything downstream reads only this.
 *
 * DOM fields are optional throughout, on purpose. The moment a browser
 * selector is mandatory, half of the workflows a company actually cares about
 * become unrecordable.
 */
import { z } from 'zod';
import { CANONICAL_TRACE_SCHEMA_VERSION } from './versions.ts';

export { CANONICAL_TRACE_SCHEMA_VERSION } from './versions.ts';

export const ActorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['human', 'agent', 'system']),
  label: z.string().default(''),
});
export type Actor = z.infer<typeof ActorSchema>;

/**
 * A state of the world as reported by the environment. Typed loosely here
 * because `@rigorrun/core` must not depend on the environment SDK — the shape
 * is `{ entities: { EntityName: { id: row } } }`.
 */
export const StatePayloadSchema = z.object({
  entities: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))),
});
export type StatePayload = z.infer<typeof StatePayloadSchema>;

export const TRACE_STEP_KINDS = [
  'action',
  'observation',
  'navigation',
  'input',
  'note',
] as const;
export const TraceStepKindSchema = z.enum(TRACE_STEP_KINDS);
export type TraceStepKind = z.infer<typeof TraceStepKindSchema>;

/**
 * Where a step happened in a user interface.
 *
 * Every field is optional. An API-sourced trace carries none of them and
 * compiles exactly as well; it simply has no UI text for the compiler to read
 * a stated threshold out of.
 */
export const UiLocusSchema = z.object({
  url: z.string().optional(),
  pageTitle: z.string().optional(),
  selector: z.string().optional(),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
});
export type UiLocus = z.infer<typeof UiLocusSchema>;

export const TraceStepSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  /** Milliseconds since the recording started. */
  at: z.number().int().nonnegative(),
  kind: TraceStepKindSchema,
  /** The environment action performed, when this step was one. */
  action: z
    .object({
      name: z.string().min(1),
      args: z.record(z.string(), z.unknown()).default({}),
      ok: z.boolean().default(true),
    })
    .optional(),
  /** A semantic event the application emitted. */
  observation: z
    .object({ name: z.string().min(1), data: z.record(z.string(), z.unknown()).default({}) })
    .optional(),
  /**
   * Text that was visible to the operator at this moment. The compiler mines
   * it for stated thresholds, and files anything it finds as *inferred* with a
   * question attached — a number read off a page is a lead, never a policy.
   */
  surfaceText: z.array(z.string().max(400)).default([]),
  ui: UiLocusSchema.optional(),
  note: z.string().max(2000).optional(),
});
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const TRACE_SOURCES = ['browser_recorder', 'action_log', 'structured_import'] as const;
export const TraceSourceSchema = z.enum(TRACE_SOURCES);
export type TraceSource = z.infer<typeof TraceSourceSchema>;

export const CanonicalHumanTraceSchema = z.object({
  schemaVersion: z.literal(CANONICAL_TRACE_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  environmentId: z.string().min(1),
  recordedAt: z.string(),
  durationMs: z.number().int().nonnegative().default(0),
  actor: ActorSchema,
  source: TraceSourceSchema,
  app: z.object({ origin: z.string().default(''), title: z.string().default('') }).optional(),
  /** Authoritative state before the work began. */
  before: StatePayloadSchema.optional(),
  /** Authoritative state after the work finished. */
  after: StatePayloadSchema.optional(),
  steps: z.array(TraceStepSchema),
  meta: z
    .object({
      recorder: z.string().default('unknown'),
      recorderVersion: z.string().default('0.0.0'),
      redaction: z.string().default('rigorrun-redaction-v1'),
      droppedSensitiveEvents: z.number().int().nonnegative().default(0),
    })
    .default({
      recorder: 'unknown',
      recorderVersion: '0.0.0',
      redaction: 'rigorrun-redaction-v1',
      droppedSensitiveEvents: 0,
    }),
});
export type CanonicalHumanTrace = z.infer<typeof CanonicalHumanTraceSchema>;

export function parseCanonicalTrace(input: unknown): CanonicalHumanTrace {
  return CanonicalHumanTraceSchema.parse(input);
}

/** Actions the operator performed, in order. */
export function actionSteps(trace: CanonicalHumanTrace): TraceStep[] {
  return trace.steps.filter((step) => step.action !== undefined && step.action.ok);
}

/** Every piece of text the operator could see, deduplicated, in order. */
export function surfaceText(trace: CanonicalHumanTrace): { text: string; stepId: string }[] {
  const seen = new Set<string>();
  const out: { text: string; stepId: string }[] = [];
  for (const step of trace.steps) {
    const candidates = [
      ...step.surfaceText,
      step.ui?.accessibleName ?? '',
      step.ui?.label ?? '',
    ].filter((text) => text.trim().length > 0);
    for (const text of candidates) {
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ text, stepId: step.id });
    }
  }
  return out;
}

/** The last mutating action of the recording — what the job was *for*. */
export function primaryAction(trace: CanonicalHumanTrace): TraceStep | undefined {
  const actions = actionSteps(trace);
  return actions[actions.length - 1];
}
