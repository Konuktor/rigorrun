/**
 * The environment contract — what RigorRun learned about the job, and how sure
 * it is about each part of it.
 *
 * The distinction this file exists to enforce is the product's whole claim to
 * honesty. Watching somebody do a task once tells you what they *did*. It does
 * not tell you what they are *required* to do. So every rule carries where it
 * came from, and a rule that was generalised rather than observed cannot fail
 * an agent until a person has said yes to it.
 *
 *   observed   — the demonstration literally shows this. Deterministic.
 *   inferred   — RigorRun generalised. Non-blocking until confirmed.
 *   confirmed  — a person said yes. Blocking.
 *   rejected   — a person said no. Removed, and its assertions with it.
 *
 * `observed` and `confirmed` are the only statuses that may produce a
 * release-blocking assertion. That is asserted by test, not left to the UI.
 */
import { z } from 'zod';
import { ENVIRONMENT_CONTRACT_SCHEMA_VERSION } from './versions.ts';
import { AssertionSchema } from './assertion.ts';
import { RulePredicateSchema } from './predicate.ts';

export { ENVIRONMENT_CONTRACT_SCHEMA_VERSION } from './versions.ts';

export const RULE_STATUSES = ['observed', 'inferred', 'confirmed', 'rejected'] as const;
export const RuleStatusSchema = z.enum(RULE_STATUSES);
export type RuleStatus = z.infer<typeof RuleStatusSchema>;

/**
 * Where a claim came from.
 *
 * Strength matters as much as presence. Every rule has *some* provenance by
 * construction, so counting rules-with-provenance measures nothing; what is
 * worth reporting is how many rules rest on something the operator actually
 * did versus on a number scraped out of page text.
 */
export const PROVENANCE_KINDS = [
  'recorded_action',
  'state_delta',
  'env_schema',
  'ui_text',
  'user_confirmation',
  'imported_policy',
  'generated_counterfactual',
  'developer_rule',
] as const;
export const ProvenanceKindSchema = z.enum(PROVENANCE_KINDS);
export type ProvenanceKind = z.infer<typeof ProvenanceKindSchema>;

export const PROVENANCE_STRENGTH: Record<ProvenanceKind, 'strong' | 'moderate' | 'weak'> = {
  recorded_action: 'strong',
  state_delta: 'strong',
  user_confirmation: 'strong',
  developer_rule: 'strong',
  imported_policy: 'moderate',
  env_schema: 'moderate',
  generated_counterfactual: 'moderate',
  // A regular expression reading a number off a page is the weakest thing in
  // the system, and is labelled as such rather than quietly averaged in.
  ui_text: 'weak',
};

export const ProvenanceSchema = z.object({
  kind: ProvenanceKindSchema,
  /** Trace step id, delta index, schema path or reviewer id. */
  ref: z.string().default(''),
  /** What was actually seen, quoted where possible. */
  detail: z.string().default(''),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const RULE_TEMPLATES = [
  'threshold_guard',
  'relation_required',
  'path_agreement',
  'uniqueness',
  'target_state',
  'side_effect',
  'field_populated',
  'field_relation',
  'transition_allowed',
  'action_order',
] as const;
export const RuleTemplateSchema = z.enum(RULE_TEMPLATES);
export type RuleTemplate = z.infer<typeof RuleTemplateSchema>;

export const OpenQuestionSchema = z.object({
  /** Plain English. No eval vocabulary; a person answers yes, edit or no. */
  text: z.string().min(1),
  /** Why one recording cannot settle it. */
  reason: z.string().min(1),
  /** A concrete case that would make the rule wrong, when one is known. */
  counterexample: z.string().optional(),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

export const ContractRuleSchema = z.object({
  id: z.string().min(1),
  /** Plain-English statement shown to the reviewer. */
  statement: z.string().min(1),
  template: RuleTemplateSchema,
  status: RuleStatusSchema,
  confidence: z.number().min(0).max(1),
  provenance: z.array(ProvenanceSchema).min(1),
  /** What this rule means in practice, in the reviewer's language. */
  implications: z.array(z.string()).default([]),
  /** Assertion ids compiled from this rule. */
  generatedAssertions: z.array(z.string()).default([]),
  /** Benchmark case ids this rule caused to exist. */
  generatedCases: z.array(z.string()).default([]),
  question: OpenQuestionSchema.optional(),
  predicate: RulePredicateSchema,
  /**
   * Set when the environment itself refuses the violation, so no agent can
   * ever fail this check. Such a rule is dropped from the blocking set: a
   * benchmark full of untestable rules looks excellent and measures nothing.
   */
  untestable: z.object({ reason: z.string() }).optional(),
});
export type ContractRule = z.infer<typeof ContractRuleSchema>;

export const ObservedFactSchema = z.object({
  id: z.string().min(1),
  /** Plain-English restatement of a single delta or recorded action. */
  statement: z.string().min(1),
  /** Machine form, e.g. `Claim.amount` or `Permit.state`. */
  key: z.string().min(1),
  value: z.unknown(),
  provenance: z.array(ProvenanceSchema).default([]),
});
export type ObservedFact = z.infer<typeof ObservedFactSchema>;

export const EnvironmentContractSchema = z.object({
  schemaVersion: z.literal(ENVIRONMENT_CONTRACT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  goal: z.string().min(1),
  environmentId: z.string().min(1),
  sourceTraceId: z.string().optional(),
  /** The action the job exists to perform, induced from the demonstration. */
  primaryAction: z.string().min(1),
  /** The record the job is about. */
  focusEntity: z.string().min(1),
  /** Whether the job creates that record or changes an existing one. */
  focusScope: z.enum(['created', 'changed']).default('created'),
  /** Mutating actions the operator took *before* the job — asking for an
   * approval, opening a record. These are the ways a blocked case can be
   * unblocked, and the expectation engine searches over subsets of them. */
  remedyActions: z.array(z.string()).default([]),
  /** Mutating actions taken *after* the job, such as writing to an audit log.
   * Not permissions, so they never make the work impermissible — they are
   * extra steps a compliant operator also performs. */
  completionActions: z.array(z.string()).default([]),
  /**
   * The arguments the operator actually used, per action.
   *
   * This is what lets RigorRun replay the demonstrated job against a mutated
   * world without a human writing a script per workflow: free-form parameters
   * come from here, identifiers are substituted for the current case.
   */
  demonstratedArgs: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /**
   * Entities the projection is rooted at, fixed at compile time.
   *
   * This has to be pinned rather than recomputed per case. If the focus were
   * derived from whatever a given run happened to touch, an agent that did
   * nothing would produce a projection with no rows to check, every assertion
   * would resolve to nothing, and the case would pass. The benchmark must ask
   * the same questions of every agent.
   */
  projectionFocus: z.array(z.string()).default([]),
  observedFacts: z.array(ObservedFactSchema).default([]),
  rules: z.array(ContractRuleSchema).default([]),
  successAssertions: z.array(AssertionSchema).default([]),
  policyAssertions: z.array(AssertionSchema).default([]),
  createdAt: z.string(),
  approvedAt: z.string().optional(),
});
export type EnvironmentContract = z.infer<typeof EnvironmentContractSchema>;

export function parseEnvironmentContract(input: unknown): EnvironmentContract {
  return EnvironmentContractSchema.parse(input);
}

/**
 * Rules allowed to fail an agent.
 *
 * Observed facts and confirmed rules only, and never one the environment
 * already enforces. Everything else is exploratory.
 */
export function blockingRules(contract: EnvironmentContract): ContractRule[] {
  return contract.rules.filter(
    (rule) =>
      (rule.status === 'observed' || rule.status === 'confirmed') && rule.untestable === undefined,
  );
}

/** Rules RigorRun generalised and a person has not yet ruled on. */
export function rulesAwaitingReview(contract: EnvironmentContract): ContractRule[] {
  return contract.rules.filter((rule) => rule.status === 'inferred');
}

export function rejectedRules(contract: EnvironmentContract): ContractRule[] {
  return contract.rules.filter((rule) => rule.status === 'rejected');
}

/** Share of rules still waiting on a human. The one honest debt metric. */
export function unconfirmedRuleRatio(contract: EnvironmentContract): number {
  const live = contract.rules.filter((rule) => rule.status !== 'rejected');
  if (live.length === 0) return 0;
  return rulesAwaitingReview(contract).length / live.length;
}

/**
 * How well grounded the contract is.
 *
 * Reported as a distribution rather than a percentage, because "every rule has
 * provenance" is true by construction and therefore says nothing.
 */
export function provenanceStrength(contract: EnvironmentContract): {
  strong: number;
  moderate: number;
  weak: number;
} {
  const counts = { strong: 0, moderate: 0, weak: 0 };
  for (const rule of contract.rules) {
    if (rule.status === 'rejected') continue;
    const best = rule.provenance
      .map((node) => PROVENANCE_STRENGTH[node.kind])
      .sort((a, b) => rank(b) - rank(a))[0];
    if (best) counts[best] += 1;
  }
  return counts;
}

function rank(strength: 'strong' | 'moderate' | 'weak'): number {
  return strength === 'strong' ? 2 : strength === 'moderate' ? 1 : 0;
}

export interface ReviewDecisions {
  confirmedRuleIds: string[];
  rejectedRuleIds?: string[];
  /** Edited statements or thresholds, keyed by rule id. */
  edits?: Record<string, { statement?: string; predicate?: ContractRule['predicate'] }>;
}

/**
 * Applies a reviewer's answers.
 *
 * Confirming promotes a rule to full confidence. Rejecting keeps the rule, but
 * marks it `rejected` and strips its assertions — kept rather than deleted
 * because a rejected rule is the cheapest honest control RigorRun has: a
 * defect that violates it *must* survive the benchmark, and a benchmark that
 * kills it is failing agents for behaviour the reviewer explicitly allowed.
 */
export function applyReview(
  contract: EnvironmentContract,
  decisions: ReviewDecisions,
  approvedAt = new Date().toISOString(),
): EnvironmentContract {
  const confirmed = new Set(decisions.confirmedRuleIds);
  const rejected = new Set(decisions.rejectedRuleIds ?? []);

  const rules = contract.rules.map((rule): ContractRule => {
    const edit = decisions.edits?.[rule.id];
    const edited: ContractRule = {
      ...rule,
      ...(edit?.statement ? { statement: edit.statement } : {}),
      ...(edit?.predicate ? { predicate: edit.predicate } : {}),
    };
    if (rejected.has(rule.id)) {
      return { ...edited, status: 'rejected', confidence: 0, generatedAssertions: [] };
    }
    if (confirmed.has(rule.id) && rule.status === 'inferred') {
      return {
        ...edited,
        status: 'confirmed',
        confidence: 1,
        provenance: [
          ...rule.provenance,
          {
            kind: 'user_confirmation',
            ref: 'review',
            detail: edit?.statement
              ? 'confirmed by the reviewer, with an edit'
              : 'confirmed by the reviewer',
          },
        ],
      };
    }
    return edited;
  });

  const droppedAssertions = new Set(
    contract.rules
      .filter((rule) => rejected.has(rule.id))
      .flatMap((rule) => rule.generatedAssertions),
  );

  return {
    ...contract,
    rules,
    successAssertions: contract.successAssertions.filter((a) => !droppedAssertions.has(a.id)),
    policyAssertions: contract.policyAssertions.filter((a) => !droppedAssertions.has(a.id)),
    approvedAt,
  };
}
