/**
 * Is the rule testable at all?
 *
 * A benchmark can only measure what an agent is *able* to get wrong. If the
 * environment itself refuses the violation — the staging system will not let
 * you approve an invoice without sign-off, whatever you ask it — then every
 * agent passes that check, and the rule contributes a green tick that means
 * nothing.
 *
 * This is the failure that surfaces first on somebody else's adapter, where it
 * cannot be debugged, and it looks like excellent results. So each rule's
 * violation is attempted against the real adapter and the answer is recorded
 * rather than assumed.
 *
 * The distinction that matters: a refusal because a named record does not
 * exist is *integrity*, and is expected. A refusal for any other reason is the
 * environment enforcing policy, and the rule is dropped from the blocking set
 * with a warning rather than left in to flatter the result.
 */
import type { ContractRule, EnvironmentContract } from '@rigorrun/core';
import type { EnvironmentAdapter } from '@rigorrun/environment';
import type { Mutation } from './mutations.ts';

/** Refusals that mean "that request was nonsense", not "that is not allowed". */
const INTEGRITY_CODES = new Set([
  'NOT_FOUND',
  'MISSING_PARAM',
  'BAD_PARAM_TYPE',
  'BAD_PARAM_VALUE',
  'UNKNOWN_ACTION',
]);

export interface UntestableRule {
  ruleId: string;
  statement: string;
  reason: string;
}

export async function findUntestableRules(
  adapter: EnvironmentAdapter,
  contract: EnvironmentContract,
  mutations: readonly Mutation[],
  rules: readonly ContractRule[],
): Promise<UntestableRule[]> {
  const untestable: UntestableRule[] = [];

  for (const rule of rules) {
    const probe = mutations.find((mutation) => mutation.targetRuleIds.includes(rule.id));
    if (!probe) continue;

    await adapter.reset();
    await adapter.seed(probe.state, probe.config);

    const primary = adapter.getActions().find((a) => a.name === contract.primaryAction);
    if (!primary) continue;

    const args: Record<string, unknown> = {};
    for (const param of primary.params) {
      const value =
        probe.request[param.name] ?? contract.demonstratedArgs[contract.primaryAction]?.[param.name];
      if (value !== undefined) args[param.name] = value;
    }

    const result = await adapter.executeAction(primary.name, args);
    if (result.ok) continue;

    const code = result.error?.code ?? 'FAILED';
    if (INTEGRITY_CODES.has(code)) continue;

    untestable.push({
      ruleId: rule.id,
      statement: rule.statement,
      reason: `${adapter.name} refuses the violation itself (${code}), so no agent can be caught breaking this rule`,
    });
  }

  return untestable;
}

/** Marks the rules so they cannot produce a blocking assertion. */
export function markUntestable(
  contract: EnvironmentContract,
  untestable: readonly UntestableRule[],
): EnvironmentContract {
  if (untestable.length === 0) return contract;
  const byId = new Map(untestable.map((entry) => [entry.ruleId, entry.reason]));
  return {
    ...contract,
    rules: contract.rules.map((rule) => {
      const reason = byId.get(rule.id);
      return reason ? { ...rule, untestable: { reason } } : rule;
    }),
  };
}
