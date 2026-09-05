/**
 * Turning a failure that already happened into a case that runs forever.
 *
 * The lifecycle this closes: a person teaches RigorRun a job before there is
 * any traffic, and then traffic arrives and something goes wrong in a way
 * nobody thought to generate. That failure should stop being a bug report
 * somebody closes and start being a case in the suite.
 *
 * The temptation is to record what happened and assert it must not happen
 * again — and that is the wrong shape, because it bakes in one incident's
 * details as the definition of correct. A case built that way passes as soon as
 * the agent avoids that exact sequence, which is not the same as the agent
 * being right.
 *
 * So a regression case is built the way every generated case is: RigorRun takes
 * the *request* the failure was working on, and computes what should have
 * happened by hypothetical completion — reset, install the starting position,
 * execute the plan the confirmed rules imply, look at what that produced, roll
 * back. The trace supplies the situation. The rules supply the answer.
 *
 * Which means an imported failure inherits every property a generated case has:
 * its expected outcome is derived rather than asserted, its checks are the same
 * synthesised assertions, and it is satisfiable by construction.
 */
import type { BenchmarkCase, CaseCategory } from '@rigorrun/core';
import type { EnvironmentContract } from '@rigorrun/core';
import type { EnvironmentAdapter } from '@rigorrun/environment';
import { buildProjection, emptyState } from '@rigorrun/environment';
import { synthesizeAssertions } from '@rigorrun/compiler';
import { computeExpected } from './expectation.ts';

export interface FailureToReplay {
  /** What a person would call it, in a list of cases, in a year. */
  name: string;
  /** Why it is here. Shown beside the case; never used to decide anything. */
  reason: string;
  /**
   * What the agent was working on: the arguments of the job it got wrong.
   *
   * Taken from the trace, and it is the *only* thing taken from the trace. What
   * should have happened is worked out from the confirmed rules.
   */
  request: Record<string, unknown>;
  /**
   * Where it starts. Absent means "wherever a reset leaves this system", which
   * is the only honest answer for a system RigorRun cannot seed.
   */
  state?: BenchmarkCase['seed']['state'];
  config?: Record<string, string>;
  category?: CaseCategory;
}

export interface ReplayedFailure {
  testCase: BenchmarkCase;
  /** What the rules say should happen — computed, not taken from the trace. */
  shouldPerform: boolean;
  /** Why not, when not. */
  refusalReason: string;
}

/**
 * Builds one case from one failure.
 *
 * Throws when the confirmed rules cannot say what should have happened. That is
 * the honest outcome rather than a case with a guessed expectation in it: a
 * failure RigorRun cannot reason about is a failure it should refuse to grade,
 * and the person should hear that rather than get a case that passes for the
 * wrong reason.
 */
export async function replayFailure(
  adapter: EnvironmentAdapter,
  contract: EnvironmentContract,
  failure: FailureToReplay,
  caseId: string,
): Promise<ReplayedFailure> {
  // No starting position means "wherever a reset leaves this system", which is
  // the only honest answer for a system RigorRun cannot seed — and the common
  // case, since most real systems cannot have a world installed into them.
  const seed = {
    state: failure.state ?? emptyState(adapter.describeEntities()),
    config: failure.config ?? {},
    request: failure.request,
  };

  const expected = await computeExpected(adapter, contract, seed);
  if (expected.conflict) {
    throw new Error(
      `RigorRun cannot work out what should have happened here: the confirmed rules admit no ` +
        `way to complete this request, and no single rule explains why. Rather than guess at an ` +
        `expected outcome, it will not build the case — the rules need reviewing first.`,
    );
  }

  // The same projection the generator builds, so a regression case's checks
  // are validated against exactly the paths a generated one's are.
  await adapter.reset();
  await adapter.seed(seed.state, seed.config);
  const keys = buildProjection(adapter.describeEntities(), {
    seed: seed.state,
    final: await adapter.getState(),
    focus: contract.projectionFocus,
    knownEventTypes: adapter
      .getActions()
      .filter((action) => !action.readOnly)
      .map((action) => action.name),
  }).keys;
  const policy = synthesizeAssertions(contract, keys, { bindings: expected.bindings });

  return {
    testCase: {
      id: caseId,
      name: failure.name,
      // Categorised by what the rules say, not by what the trace looked like.
      // A failure where the work should have been refused is a policy
      // violation whatever the incident report called it.
      category: failure.category ?? (expected.shouldPerform ? 'happy_path' : 'policy_violation'),
      description: failure.reason,
      seed: {
        scenarioId: 'from-a-real-failure',
        mutations: [],
        state: seed.state,
        config: seed.config,
        request: seed.request,
      },
      task: {
        instruction: contract.name,
        inputs: seed.request,
        policyBrief: '',
        allowedTools: adapter.getActions().map((action) => action.name),
        tools: adapter.getActions().map((action) => ({
          name: action.name,
          description: action.description,
          readOnly: action.readOnly,
          params: action.params.map((param) => ({
            name: param.name,
            type: param.type,
            required: param.required,
            ...(param.enumValues ? { enumValues: [...param.enumValues] } : {}),
            ...(param.entityRef ? { entityRef: param.entityRef } : {}),
            description: param.description ?? '',
          })),
        })),
      },
      checks: policy.assertions,
      referencePlan: expected.plan,
      maxSteps: 24,
      timeoutMs: 60_000,
    },
    shouldPerform: expected.shouldPerform,
    refusalReason: expected.refusalReason,
  };
}
