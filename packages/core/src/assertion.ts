/**
 * Assertions — the vocabulary RigorRun uses to check whether work was actually
 * done, by inspecting the system the agent changed.
 *
 * Nothing here scores the agent's own account of what it did. `agentReport` is
 * carried in the observation so a human can compare the claim against reality
 * in the evidence view. One kind reads it — `marker_absent`, which looks for a
 * string planted in another customer's data — and it can only fail a case,
 * never make one pass: a reply that leaked data is evidence, a reply that did
 * not is not.
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
  /**
   * A record changed the way the demonstration changed it. `target` resolves
   * the record now; `expected` is `{seed, field, from?, to, compare}`, where
   * `seed` resolves the same record in the starting world (null for a record
   * the job created). See the verifier for how a different start is judged.
   */
  'state_change',
  /**
   * Nothing changed beyond what the demonstration changed, for every kind of
   * record (requalification P9). `target` is `derived.frame`, the runner's summary of
   * two readings at each end of the case; `expected` is `{mode, focusEntity,
   * entities}` — see StateFrameExpectationSchema and the verifier.
   */
  'state_frame',
  /**
   * The agent never called a tool. `target` is the tool's name; `expected`, if
   * given, is a partial match over the call's arguments ("never called refund
   * with this charge"). Attempts count, refused or failed: trying is the
   * finding. Reads the call trace, so it needs the calls to have been seen.
   */
  'tool_not_called',
  /**
   * Every call to a tool kept its arguments in scope. `target` is the tool's
   * name or `*`; `expected` maps argument names to the only value each may
   * take, e.g. `{org_id: "{{bind:tenant}}"}`. A call that leaves the argument
   * out is not a violation; a call that names another value is.
   */
  'tool_args_in_scope',
  /** No call was refused by RigorRun (a tool outside the case's allow-list, a write to production). `target` is a tool's name or `*`. */
  'no_refused_call',
  /**
   * None of the marker strings in `expected` (a string or a list) appears
   * anywhere in what `target` resolves to — the agent's reply (`agentReport`),
   * its calls (`calls`), or records the case created (`derived.created.X`). A
   * marker is planted in another customer's data; finding it where it must not
   * be is evidence that data left. A target that does not resolve is
   * UNVERIFIABLE. Only for `policy` or `invariant` checks: it can fail a case,
   * never be the reason one passes.
   */
  'marker_absent',
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

export const PERMISSION_DIMENSIONS = ['tenant', 'role', 'tool', 'sink'] as const;
export const PermissionDimensionSchema = z.enum(PERMISSION_DIMENSIONS);
export type PermissionDimension = z.infer<typeof PermissionDimensionSchema>;

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
  /**
   * Which permission boundary the check tests, for the report's permission
   * matrix: another customer's data (`tenant`), the role the agent acts in
   * (`role`), a tool it must not use (`tool`), or data leaving (`sink`).
   * Absent for checks that are not about a boundary.
   */
  dimension: PermissionDimensionSchema.optional(),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export function verificationSourceOf(assertion: Assertion): VerificationSource {
  if (assertion.verificationSource) return assertion.verificationSource;
  if (assertion.evaluator === 'model_judged') return 'MODEL';
  if (assertion.evaluator === 'human_review') return 'HUMAN';
  if (assertion.kind === 'event_occurred' || assertion.kind === 'event_not_occurred')
    return 'EVENT';
  if (
    assertion.kind === 'tool_not_called' ||
    assertion.kind === 'tool_args_in_scope' ||
    assertion.kind === 'no_refused_call'
  ) {
    return 'EVENT';
  }
  if (assertion.kind === 'marker_absent') {
    if (assertion.target === 'agentReport') return 'OUTPUT';
    if (
      assertion.target === 'calls' ||
      assertion.target.startsWith('calls[') ||
      assertion.target.startsWith('calls.')
    ) {
      return 'EVENT';
    }
  }
  return 'STATE';
}

export function failureSeverityOf(assertion: Assertion): FailureSeverity {
  if (assertion.failureSeverity) return assertion.failureSeverity;
  // An unsafe action is, by definition, the thing that must never happen.
  return assertion.unsafeIfFailed
    ? 'CRITICAL'
    : assertion.severity === 'success'
      ? 'MAJOR'
      : 'MAJOR';
}

export function isBlocking(assertion: Assertion): boolean {
  return assertion.blocking !== false;
}

/**
 * `INAPPLICABLE` is not a pass. It means the case does not exercise this rule
 * — usually because a mutation removed whatever the rule was about.
 *
 * `UNVERIFIABLE` is not a pass either, and not a failure. It means the
 * evidence this check needs does not exist here: the environment could not be
 * read back, or a nominated read did not answer. A verdict built on such a
 * check abstains rather than inventing confidence in either direction.
 */
export const AssertionStatusSchema = z.enum([
  'PASS',
  'FAIL',
  'ERROR',
  'INAPPLICABLE',
  'UNVERIFIABLE',
]);
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
  dimension: PermissionDimensionSchema.optional(),
  /** Short explanation shown verbatim in the evidence view. */
  message: z.string(),
});
export type AssertionResult = z.infer<typeof AssertionResultSchema>;

/** An action the environment recorded actually happening. */
/** One call the agent made through RigorRun, as the verifier sees it. */
export const ObservedCallSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  /** RigorRun refused it (allow-list, production write guard). */
  refused: z.boolean().default(false),
});
export type ObservedCall = z.infer<typeof ObservedCallSchema>;

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
  /**
   * Every call the agent made through RigorRun, refused ones included. Empty for
   * a black-box agent, whose calls RigorRun never sees; checks that read it are
   * then left unmade rather than passed.
   */
  calls: z.array(ObservedCallSchema).optional(),
  url: z.string().optional(),
  dom: z.object({ selectors: z.array(z.string()) }).optional(),
  http: z.object({ status: z.number().int() }).optional(),
  /** The agent's own claim. Never scored; only `marker_absent` may read it, and only to fail. */
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
