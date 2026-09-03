/**
 * Assertions — the vocabulary RigorRun uses to check whether work was actually
 * done, by inspecting the system the agent changed.
 *
 * Nothing here reads the agent's own account of what it did. `agentReport` is
 * carried in the observation purely so a human can compare the claim against
 * reality in the evidence view; deterministic assertions never touch it.
 */
import { z } from 'zod';

export const ASSERTION_KINDS = [
  'state_equals',
  'state_exists',
  'state_not_exists',
  'numeric_lte',
  'numeric_gte',
  'contains',
  'not_contains',
  'url_matches',
  'element_exists',
  'element_not_exists',
  'http_status',
  'json_path_equals',
  'event_occurred',
  'event_not_occurred',
] as const;

export const AssertionKindSchema = z.enum(ASSERTION_KINDS);
export type AssertionKind = z.infer<typeof AssertionKindSchema>;

/**
 * How a verdict is produced.
 *
 * `deterministic` is the only kind that can stand alone. A model judge may be
 * added as a *secondary* signal but never silently replaces a deterministic
 * check — the UI renders the three differently on purpose.
 */
export const EvaluatorSchema = z.enum(['deterministic', 'model_judged', 'human_review']);
export type Evaluator = z.infer<typeof EvaluatorSchema>;

/** What a failure means for scoring. */
export const AssertionSeveritySchema = z.enum(['success', 'policy', 'invariant']);
export type AssertionSeverity = z.infer<typeof AssertionSeveritySchema>;

export const AssertionSchema = z.object({
  id: z.string().min(1),
  kind: AssertionKindSchema,
  /** Human-readable statement, e.g. `refund.amount <= 50 OR managerApproval.exists`. */
  description: z.string().min(1),
  /**
   * Path into the observation. Supports `a.b`, `a[0].b`, `a[field=value].b`
   * and the `.length` pseudo-property. For `url_matches` this is unused, for
   * `element_exists` it is a CSS selector, for `event_occurred` an event type.
   */
  target: z.string().min(1),
  expected: z.unknown().optional(),
  severity: AssertionSeveritySchema.default('success'),
  evaluator: EvaluatorSchema.default('deterministic'),
  /**
   * When true, a failure is counted as an *unsafe action* — the agent did
   * something it must never do, as opposed to merely failing to finish.
   */
  unsafeIfFailed: z.boolean().default(false),
  /**
   * Optional alternative assertion: the check passes if either this assertion
   * or the alternative passes. Models `amount <= 50 OR approval exists`.
   */
  orElse: z
    .object({
      kind: AssertionKindSchema,
      target: z.string().min(1),
      expected: z.unknown().optional(),
    })
    .optional(),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export const AssertionStatusSchema = z.enum(['PASS', 'FAIL', 'ERROR']);
export type AssertionStatus = z.infer<typeof AssertionStatusSchema>;

export const AssertionResultSchema = z.object({
  assertionId: z.string(),
  kind: AssertionKindSchema,
  description: z.string(),
  status: AssertionStatusSchema,
  severity: AssertionSeveritySchema,
  evaluator: EvaluatorSchema,
  unsafe: z.boolean().default(false),
  observed: z.unknown().optional(),
  expected: z.unknown().optional(),
  /** Short explanation shown verbatim in the evidence view. */
  message: z.string(),
});
export type AssertionResult = z.infer<typeof AssertionResultSchema>;

/** An action the environment recorded actually happening. */
export const ObservedEventSchema = z.object({
  type: z.string().min(1),
  at: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()).default({}),
  ok: z.boolean().default(true),
  error: z.string().optional(),
});
export type ObservedEvent = z.infer<typeof ObservedEventSchema>;

/**
 * Everything the verifier is allowed to look at. Assembled by the runner from
 * the environment *after* the agent has finished.
 */
export const ObservationSchema = z.object({
  state: z.unknown(),
  /**
   * An environment-specific *projection* of state — joins and rollups computed
   * mechanically from `state`, so assertions can be written declaratively
   * without the verifier knowing anything about the domain.
   */
  derived: z.unknown().optional(),
  events: z.array(ObservedEventSchema).default([]),
  url: z.string().optional(),
  dom: z.object({ selectors: z.array(z.string()) }).optional(),
  http: z.object({ status: z.number().int() }).optional(),
  /** The agent's own claim. Never consulted by deterministic assertions. */
  agentReport: z.string().optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;
