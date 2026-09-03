/**
 * Workflow trace — the recorder's output, and the raw material the whole
 * product is built on.
 *
 * A trace is a *sanitised semantic* record of a human doing real work. It is
 * deliberately not a DOM dump: it stores the meaning of each interaction
 * (role, accessible name, label, stable selector) so the workflow can be
 * understood and replayed without hoarding page content.
 */
import { z } from 'zod';

export const TRACE_SCHEMA_VERSION = 1;

export const SELECTOR_STRATEGIES = [
  'test_id',
  'stable_id',
  'role_name',
  'label',
  'placeholder',
  'text',
  'css',
] as const;
export const SelectorStrategySchema = z.enum(SELECTOR_STRATEGIES);
export type SelectorStrategy = z.infer<typeof SelectorStrategySchema>;

export const SelectorCandidateSchema = z.object({
  strategy: SelectorStrategySchema,
  value: z.string().min(1),
  /** Higher is more durable. Used to rank fallbacks at replay time. */
  score: z.number().min(0).max(100),
});
export type SelectorCandidate = z.infer<typeof SelectorCandidateSchema>;

export const ElementDescriptorSchema = z.object({
  tagName: z.string(),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  testId: z.string().optional(),
  elementId: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  inputType: z.string().optional(),
  /** Short surrounding text, truncated — enough context, not a page snapshot. */
  nearbyText: z.string().max(240).optional(),
  /** Best selector, i.e. `candidates[0].value`. */
  selector: z.string(),
  selectorStrategy: SelectorStrategySchema,
  candidates: z.array(SelectorCandidateSchema).max(8).default([]),
});
export type ElementDescriptor = z.infer<typeof ElementDescriptorSchema>;

export const TRACE_EVENT_TYPES = [
  'navigate',
  'click',
  'input',
  'change',
  'select',
  'submit',
  'keypress',
  /**
   * A semantic observation emitted by an instrumented application (the demo CRM
   * does this). Optional everywhere: the compiler works without them and simply
   * reports lower confidence.
   */
  'app_observation',
] as const;
export const TraceEventTypeSchema = z.enum(TRACE_EVENT_TYPES);
export type TraceEventType = z.infer<typeof TraceEventTypeSchema>;

export const TraceEventSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  type: TraceEventTypeSchema,
  /** Milliseconds since the recording started. */
  at: z.number().int().nonnegative(),
  /** Already sanitised by the redactor before it reaches this schema. */
  url: z.string(),
  pageTitle: z.string().default(''),
  target: ElementDescriptorSchema.optional(),
  /** Redacted input value. Absent when the field was credential-like. */
  value: z.string().optional(),
  /** Payload of an `app_observation` event. */
  observation: z
    .object({
      name: z.string(),
      data: z.record(z.string(), z.unknown()).default({}),
    })
    .optional(),
});
export type TraceEvent = z.infer<typeof TraceEventSchema>;

export const WorkflowTraceSchema = z.object({
  schemaVersion: z.literal(TRACE_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  recordedAt: z.string(),
  durationMs: z.number().int().nonnegative().default(0),
  app: z.object({
    origin: z.string(),
    title: z.string().default(''),
  }),
  events: z.array(TraceEventSchema),
  meta: z
    .object({
      recorder: z.string().default('unknown'),
      recorderVersion: z.string().default('0.0.0'),
      redaction: z.string().default('rigorrun-redaction-v1'),
      /** Number of events the recorder dropped entirely for safety. */
      droppedSensitiveEvents: z.number().int().nonnegative().default(0),
    })
    .default({
      recorder: 'unknown',
      recorderVersion: '0.0.0',
      redaction: 'rigorrun-redaction-v1',
      droppedSensitiveEvents: 0,
    }),
});
export type WorkflowTrace = z.infer<typeof WorkflowTraceSchema>;

/** Parse and validate untrusted trace JSON (a file, an upload, an extension POST). */
export function parseTrace(input: unknown): WorkflowTrace {
  return WorkflowTraceSchema.parse(input);
}
