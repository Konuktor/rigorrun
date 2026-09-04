/**
 * The reference implementation.
 *
 * It replays, for each case, the plan the expectation engine worked out — and
 * it is therefore an *oracle*, not a candidate. It is given the answer.
 *
 * That is worth stating loudly because it would be easy to present as an agent
 * scoring 100% and let a reader draw the wrong conclusion. What it actually
 * proves is a property of the *benchmark*: that every case is satisfiable, and
 * that a correct actor is not failed by it. A case the reference cannot pass
 * is a broken case, and that is the only thing this file is evidence of.
 *
 * The agents that are actually under test are the generic ones, and anything
 * a team connects from outside.
 */
import type { AgentAdapter, AgentEnvironment, AgentRunInput, AgentRunOutput } from '@rigorrun/agents';
import type { Benchmark } from '@rigorrun/core';
import type { PlanStep } from './plan.ts';

export const REFERENCE_AGENT_ID = 'reference';

/** Built from the benchmark's private reference plans. */
export function createReferenceAgent(benchmark: Benchmark): AgentAdapter {
  const plans = new Map<string, PlanStep[]>(
    benchmark.cases.map((testCase) => [testCase.id, testCase.referencePlan]),
  );
  const refusals = new Map<string, string>(
    benchmark.cases
      .filter((testCase) => testCase.referencePlan.length === 0)
      .map((testCase) => [testCase.id, 'the policy does not permit this work']),
  );

  return {
    id: REFERENCE_AGENT_ID,
    name: 'Reference (oracle)',
    kind: 'demo',
    description:
      'Replays the plan the expectation engine derived for each case. It is given the answer, so it measures whether the benchmark is satisfiable — never whether an agent is good.',

    async execute(input: AgentRunInput, env: AgentEnvironment): Promise<AgentRunOutput> {
      const refusal = refusals.get(input.caseId);
      if (refusal !== undefined) {
        return {
          report: `Declined: ${refusal}`,
          costUsd: 0,
          costNote: 'no model calls — reference implementation',
        };
      }

      const plan = plans.get(input.caseId) ?? [];
      const done: string[] = [];
      for (const step of plan) {
        const result = await env.call(step.action, step.args);
        if (!result.ok) {
          return {
            report: `${step.action} was refused (${result.error.code}). Stopped.`,
            costUsd: 0,
            costNote: 'no model calls — reference implementation',
          };
        }
        done.push(step.action);
      }
      return {
        report: done.length > 0 ? `Completed: ${done.join(', ')}.` : 'Nothing to do.',
        costUsd: 0,
        costNote: 'no model calls — reference implementation',
      };
    },
  };
}
