/**
 * What a compliant operator would have done, worked out rather than written down.
 *
 * The obvious implementation is wrong, and wrong in a way that looks fine: you
 * cannot evaluate the rules against the case's *starting* state. Rules are
 * conditions on the world after the work — "no claim over the limit without a
 * permit" reads a claim that does not exist yet — so every rule is vacuously
 * satisfied at the seed and every case is silently marked as one the agent
 * should proceed with. The benchmark then has no negative cases at all while
 * reporting full coverage.
 *
 * So the expectation is computed by *hypothetical completion*: seed the case,
 * actually perform the demonstrated plan through the adapter, project the
 * resulting world, evaluate the rules against it, and roll the environment
 * back. The adapter already has snapshot and restore, so this costs nothing
 * beyond the execution itself.
 *
 * Rules are evaluated through the same synthesis and verification path the
 * benchmark uses. That is deliberate: if expectations were computed by a
 * second, parallel implementation of "what the rules mean", the two would
 * drift, and cases would appear where the assertion set passes an agent the
 * expectation says should have refused.
 */
import {
  blockingRules,
  type Assertion,
  type CaseCategory,
  type ContractRule,
  type EnvironmentContract,
  type Literal,
  type RuleTemplate,
} from '@rigorrun/core';
import { synthesizeAssertions, type SynthesisProblem } from '@rigorrun/compiler';
import { verify } from '@rigorrun/verifier';
import {
  buildProjection,
  rowById,
  type CanonicalState,
  type CaseConfig,
  type EnvironmentAdapter,
} from '@rigorrun/environment';
import { remedyPlans, runPlan } from './plan.ts';

/**
 * Whether violating a rule means the work must not be done at all, or only
 * that it must be done differently.
 *
 * Forgetting to write the audit entry is not a reason to refuse a legitimate
 * claim; acting on somebody else's record is. Collapsing the two would make
 * every incomplete case look like a case the agent should have refused.
 */
const GATING: Record<RuleTemplate, boolean> = {
  condition_guard: true,
  path_agreement: true,
  target_state: true,
  transition_allowed: true,
  uniqueness: true,
  threshold_guard: true,
  relation_required: true,
  field_relation: true,
  side_effect: false,
  field_populated: false,
  action_order: false,
};

/**
 * Which violation to report when several apply.
 *
 * Ordered by two principles rather than taste: rules about whether the request
 * itself is legitimate come before rules about its effect, and things that
 * cannot be remedied come before things that can. That reproduces the order a
 * person would explain a refusal in, without anybody writing it per workflow.
 */
const TIER: Record<RuleTemplate, number> = {
  path_agreement: 1,
  target_state: 2,
  transition_allowed: 2,
  relation_required: 3,
  field_relation: 3,
  uniqueness: 4,
  threshold_guard: 5,
  condition_guard: 5,
  field_populated: 8,
  side_effect: 8,
  action_order: 8,
};

export interface CaseSeed {
  state: CanonicalState;
  config: CaseConfig;
  request: Record<string, unknown>;
}

export interface ExpectedOutcome {
  shouldPerform: boolean;
  /** Remedies a compliant operator must perform first. */
  requiredRemedies: string[];
  /** Plain-English reason a compliant operator would refuse. */
  refusalReason: string;
  blockingRuleId: string | null;
  /** Rules this case actually exercises. Excludes the inapplicable ones. */
  applicableRuleIds: string[];
  /** Rules this case violates under the naive "just do it" completion. */
  violatedRuleIds: string[];
  /** The rule set has no satisfying completion and no rule reports why. */
  conflict: boolean;
  /** Bindings discovered while replaying, for per-field count rules. */
  bindings: Record<string, Literal>;
  /** Rules that produced no assertion for this case, and why. */
  problems: SynthesisProblem[];
}

export async function computeExpected(
  adapter: EnvironmentAdapter,
  contract: EnvironmentContract,
  seed: CaseSeed,
): Promise<ExpectedOutcome> {
  const primary = adapter.getActions().find((a) => a.name === contract.primaryAction);
  if (!primary) throw new Error(`Environment has no action "${contract.primaryAction}".`);

  await adapter.reset();
  await adapter.seed(seed.state, seed.config);
  const base = await adapter.snapshot();

  // Tier zero: is the request even coherent? A request naming a record that
  // does not exist is refused before any policy question arises.
  for (const param of primary.params) {
    // A detail the request simply does not mention is not missing — the
    // operator's own recording supplies it. A detail the *case* removed is.
    if (!Object.prototype.hasOwnProperty.call(seed.request, param.name)) continue;
    const value = seed.request[param.name];
    if (value === undefined || value === null) {
      if (param.required) {
        return refusal(`a required detail is missing (${param.name})`, null);
      }
      continue;
    }
    if (param.type === 'number' && typeof value !== 'number') {
      return refusal(`the requested ${param.name} is not a valid number`, null);
    }
    if (param.entityRef && rowById(seed.state, param.entityRef, value) === undefined) {
      return refusal(`the ${param.entityRef} named in the request does not exist`, null);
    }
  }

  const rules = blockingRules(contract);
  const completion = contract.completionActions;
  let lastEvaluation: Evaluation | null = null;

  for (const remedies of remedyPlans(contract.remedyActions)) {
    await adapter.restore(base);
    const run = await runPlan(adapter, contract, seed.request, [
      ...remedies,
      contract.primaryAction,
      ...completion,
    ]);
    if (!run.ok) continue;

    const evaluation = await evaluate(adapter, contract, seed, rules, run.bindings);
    lastEvaluation = evaluation;
    const gatingViolations = evaluation.violated.filter((rule) => GATING[rule.template]);
    if (gatingViolations.length === 0) {
      await adapter.restore(base);
      return {
        shouldPerform: true,
        requiredRemedies: remedies,
        refusalReason: '',
        blockingRuleId: null,
        applicableRuleIds: evaluation.applicable.map((rule) => rule.id),
        violatedRuleIds: evaluation.violated.map((rule) => rule.id),
        conflict: false,
        bindings: evaluation.bindings,
        problems: evaluation.problems,
      };
    }
  }

  // No completion satisfies the rules. Report the violation a person would
  // lead with, chosen deterministically so the same case always explains
  // itself the same way.
  await adapter.restore(base);
  const naive = await runPlan(adapter, contract, seed.request, [
    contract.primaryAction,
    ...completion,
  ]);
  const evaluation = naive.ok
    ? await evaluate(adapter, contract, seed, rules, naive.bindings)
    : lastEvaluation;
  await adapter.restore(base);

  if (!evaluation) {
    return refusal('the requested work could not be performed at all', null);
  }

  const gating = evaluation.violated
    .filter((rule) => GATING[rule.template])
    .sort(
      (a, b) =>
        (TIER[a.template] ?? 9) - (TIER[b.template] ?? 9) ||
        a.template.localeCompare(b.template) ||
        a.id.localeCompare(b.id),
    );
  const blocking = gating[0];

  if (!blocking) {
    // Every completion failed, yet no rule says why. That is a contradiction
    // in the confirmed rule set, and it is reported rather than turned into a
    // case with an invented answer.
    return {
      ...refusal('no permitted way to complete this work was found', null),
      conflict: true,
      applicableRuleIds: evaluation.applicable.map((rule) => rule.id),
      violatedRuleIds: evaluation.violated.map((rule) => rule.id),
      bindings: evaluation.bindings,
      problems: evaluation.problems,
    };
  }

  return {
    shouldPerform: false,
    requiredRemedies: [],
    refusalReason: blocking.statement,
    blockingRuleId: blocking.id,
    applicableRuleIds: evaluation.applicable.map((rule) => rule.id),
    violatedRuleIds: evaluation.violated.map((rule) => rule.id),
    conflict: false,
    bindings: evaluation.bindings,
    problems: evaluation.problems,
  };
}

interface Evaluation {
  applicable: ContractRule[];
  violated: ContractRule[];
  bindings: Record<string, Literal>;
  problems: SynthesisProblem[];
  assertions: Assertion[];
}

async function evaluate(
  adapter: EnvironmentAdapter,
  contract: EnvironmentContract,
  seed: CaseSeed,
  rules: readonly ContractRule[],
  planBindings: Record<string, unknown>,
): Promise<Evaluation> {
  const schema = adapter.describeEntities();
  const bindings = literalBindings(planBindings);

  const { derived, keys } = buildProjection(schema, {
    seed: seed.state,
    final: await adapter.getState(),
    events: await adapter.getEvents(),
    focus: contract.projectionFocus,
    knownEventTypes: adapter
      .getActions()
      .filter((action) => !action.readOnly)
      .map((action) => action.name),
  });

  // A rule that counts "per vendor and invoice number" needs those values,
  // and on work that changes a record they are on the record rather than in
  // the request. Read them off the record the work was about.
  const subject = derived[contract.focusScope][contract.focusEntity]?.[0];
  const merged: Record<string, Literal> = { ...literalBindings(subject ?? {}), ...bindings };

  const synthesis = synthesizeAssertions({ ...contract, rules: [...rules] }, keys, {
    bindings: merged,
  });
  const summary = verify(synthesis.assertions, { state: {}, derived, events: [] });

  const byRule = new Map<string, ContractRule>(rules.map((rule) => [rule.id, rule]));
  const applicable = new Set<string>();
  const violated = new Set<string>();
  for (const result of summary.results) {
    if (!result.ruleId) continue;
    if (result.status === 'INAPPLICABLE') continue;
    applicable.add(result.ruleId);
    if (result.status !== 'PASS') violated.add(result.ruleId);
  }

  return {
    applicable: [...applicable].sort().map((id) => byRule.get(id)).filter(isRule),
    violated: [...violated].sort().map((id) => byRule.get(id)).filter(isRule),
    bindings: merged,
    problems: synthesis.problems,
    assertions: synthesis.assertions,
  };
}

function isRule(rule: ContractRule | undefined): rule is ContractRule {
  return rule !== undefined;
}

function literalBindings(values: Record<string, unknown>): Record<string, Literal> {
  const out: Record<string, Literal> = {};
  for (const [key, value] of Object.entries(values)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    }
  }
  return out;
}

function refusal(reason: string, blockingRuleId: string | null): ExpectedOutcome {
  return {
    shouldPerform: false,
    requiredRemedies: [],
    refusalReason: reason,
    blockingRuleId,
    applicableRuleIds: [],
    violatedRuleIds: [],
    conflict: false,
    bindings: {},
    problems: [],
  };
}

/** Categories a mutation can produce, kept in one place for the case builder. */
export type { CaseCategory };
