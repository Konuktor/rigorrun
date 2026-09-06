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

/**
 * Where the answer came from, in descending order of confidence.
 *
 * `STATE` is the system of record after the agent finished. `EVENT` is a
 * deterministic action log. `OUTPUT` is a deterministic check on what the
 * agent produced. `HUMAN` is a person. `MODEL` is a model judge, which is
 * rendered as such — a report must never mix a model's opinion in with
 * authoritative state and let a reader assume they carry equal weight.
 *
 * `DECLARED` is weaker than all of them, and is last for that reason. It is
 * the system under test describing itself: a tool's name, its description, an
 * annotation like `readOnlyHint`. MCP's own specification tells clients not to
 * act on these when the server is untrusted, so a `DECLARED` source is never
 * evidence of anything — it is the claim we go and check. Naming it is what
 * lets a record say "the server said this, and here is what it did instead"
 * without quietly promoting the server's word to a finding.
 *
 * Nothing with a `DECLARED` source may ever block, and there is a test for it.
 */
export const VERIFICATION_SOURCES = [
  'STATE',
  'EVENT',
  'OUTPUT',
  'HUMAN',
  'MODEL',
  'DECLARED',
] as const;
export const VerificationSourceSchema = z.enum(VERIFICATION_SOURCES);
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

/**
 * How much a failure matters.
 *
 * A release gate can demand zero CRITICAL failures while tolerating a high
 * overall success rate, because "got the format wrong" and "paid a stranger"
 * are not the same event.
 */
export const FAILURE_SEVERITIES = ['INFO', 'MINOR', 'MAJOR', 'CRITICAL'] as const;
export const FailureSeveritySchema = z.enum(FAILURE_SEVERITIES);
export type FailureSeverity = z.infer<typeof FailureSeveritySchema>;

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
  /**
   * A precondition for the check being meaningful at all.
   *
   * When it does not hold, the result is `INAPPLICABLE` rather than a pass.
   * This matters most on exactly the cases that matter most: a mutation that
   * removes a rule's antecedent leaves a check that is neither satisfied nor
   * violated, and scoring it as a pass silently inflates every coverage number
   * in the product.
   */
  applicableWhen: z
    .object({
      kind: AssertionKindSchema,
      target: z.string().min(1),
      expected: z.unknown().optional(),
    })
    .optional(),
  /** Defaults to `STATE`: authoritative system state is the normal answer. */
  verificationSource: VerificationSourceSchema.optional(),
  failureSeverity: FailureSeveritySchema.optional(),
  /**
   * Whether failing this may block a release. Set false for checks generated
   * from rules a person has not confirmed: those explore, they do not gate.
   * Absent means blocking.
   */
  blocking: z.boolean().optional(),
  /** The contract rule this was synthesised from, for the evidence chain. */
  ruleId: z.string().optional(),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export function verificationSourceOf(assertion: Assertion): VerificationSource {
  if (assertion.verificationSource) return assertion.verificationSource;
  if (assertion.evaluator === 'model_judged') return 'MODEL';
  if (assertion.evaluator === 'human_review') return 'HUMAN';
  if (assertion.kind === 'event_occurred' || assertion.kind === 'event_not_occurred') return 'EVENT';
  return 'STATE';
}

export function failureSeverityOf(assertion: Assertion): FailureSeverity {
  if (assertion.failureSeverity) return assertion.failureSeverity;
  // An unsafe action is, by definition, the thing that must never happen.
  return assertion.unsafeIfFailed ? 'CRITICAL' : assertion.severity === 'success' ? 'MAJOR' : 'MAJOR';
}

export function isBlocking(assertion: Assertion): boolean {
  return assertion.blocking !== false;
}

/**
 * `INAPPLICABLE` is not a pass. It means the case does not exercise this rule
 * — usually because a mutation removed whatever the rule was about.
 */
export const AssertionStatusSchema = z.enum(['PASS', 'FAIL', 'ERROR', 'INAPPLICABLE']);
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
  verificationSource: VerificationSourceSchema.default('STATE'),
  failureSeverity: FailureSeveritySchema.default('MAJOR'),
  blocking: z.boolean().default(true),
  ruleId: z.string().optional(),
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

/**
 * The sources a failure may be gated on.
 *
 * Everything except `DECLARED`. A declaration is the system under test
 * describing itself, so allowing it to block would let a server decide its own
 * verdict by asserting one. The exclusion is here, in one function, rather
 * than spread across the callers that would each have to remember it.
 */
export function blockingVerificationSources(): readonly VerificationSource[] {
  return VERIFICATION_SOURCES.filter((source) => source !== 'DECLARED');
}
