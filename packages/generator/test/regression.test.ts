/**
 * A failure that already happened, made into a case that runs forever.
 *
 * The property this exists to establish is not "RigorRun can read a trace" —
 * `@rigorrun/trace-import` has its own tests for that. It is that a case built
 * from a real failure is built *the same way a generated one is*: RigorRun
 * takes only the situation from the incident, and works out what should have
 * happened from the confirmed rules.
 *
 * The alternative — record what happened and assert it must not happen again —
 * is the obvious design and the wrong one. A case built that way passes as soon
 * as the agent avoids that exact sequence, which is not the same as the agent
 * being right, and it bakes one incident's details in as the definition of
 * correct.
 */
import { describe, expect, it } from 'vitest';
import { compileWorkflow, workflowByKey } from '@rigorrun/environments';
import { createEnvironment } from '@rigorrun/environment';
import { replayFailure } from '../src/regression.ts';

async function compiled() {
  const definition = workflowByKey('refund')!;
  const result = await compileWorkflow(definition);
  return { ...result, adapter: createEnvironment(definition.registration.id) };
}

describe('a case built from a real failure', () => {
  it('works out what should have happened rather than believing the trace', async () => {
    const { contract, adapter, benchmark } = await compiled();
    // The situation an incident was working on, taken from the first generated
    // case's request so it is one this system genuinely has.
    const request = benchmark.cases[0]!.seed.request;

    const replayed = await replayFailure(
      adapter,
      contract,
      {
        name: 'the one from the 3am page',
        reason: 'An agent did this in production and it should not have.',
        request,
        state: benchmark.cases[0]!.seed.state,
      },
      'case_incident_1',
    );

    // Checks, and a reference plan — the same machinery every generated case
    // gets, so this is satisfiable by construction rather than by hope.
    expect(replayed.testCase.checks.length).toBeGreaterThan(0);
    expect(replayed.testCase.id).toBe('case_incident_1');
    expect(replayed.testCase.seed.scenarioId).toBe('from-a-real-failure');

    // And an expectation that came from the rules. Nothing in the input said
    // whether this should be performed or refused.
    expect(typeof replayed.shouldPerform).toBe('boolean');
  }, 60_000);

  it('categorises by what the rules say, not by what the incident was called', async () => {
    const { contract, adapter, benchmark } = await compiled();
    // A case the generator itself decided must be refused.
    const refused = benchmark.cases.find((entry) => entry.category === 'policy_violation');
    expect(refused).toBeDefined();

    const replayed = await replayFailure(
      adapter,
      contract,
      {
        // Somebody's incident report calls it whatever they called it.
        name: 'ticket #4021, "agent did something odd"',
        reason: 'Reported by support.',
        request: refused!.seed.request,
        state: refused!.seed.state,
        // A situation is state *and* config *and* request. Leaving the config
        // out is how a case that should refuse quietly becomes one that should
        // proceed — the manager approves instead of rejecting, and the whole
        // point of the case evaporates.
        config: refused!.seed.config,
      },
      'case_incident_2',
    );

    // RigorRun says what it actually is.
    expect(replayed.shouldPerform).toBe(false);
    expect(replayed.testCase.category).toBe('policy_violation');
    expect(replayed.refusalReason.length).toBeGreaterThan(0);
  }, 60_000);

  it('carries the reason it exists, without letting it decide anything', async () => {
    const { contract, adapter, benchmark } = await compiled();
    const replayed = await replayFailure(
      adapter,
      contract,
      {
        name: 'a name',
        reason: 'Because a customer complained on a Tuesday.',
        request: benchmark.cases[0]!.seed.request,
        state: benchmark.cases[0]!.seed.state,
      },
      'case_incident_3',
    );

    // Shown beside the case so somebody in a year knows why it is there — and
    // absent from the checks, which are derived from rules alone.
    expect(replayed.testCase.description).toContain('Tuesday');
    expect(JSON.stringify(replayed.testCase.checks)).not.toContain('Tuesday');
  }, 60_000);
});
