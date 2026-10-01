/**
 * Materialized cases, from the runner's side.
 *
 * An environment with no way to put the world back makes a new one for every
 * case and every attempt instead. These tests hold the runner to what that
 * promises: the records are made exactly once per attempt, the case is bound
 * to them before anybody sees it, nothing private travels with the binding,
 * anything that goes wrong before the agent arrives is RigorRun's failure and
 * never the agent's, and what the system showed is kept beside what the agent
 * said.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, parseRunResult, type CaseResult } from '@rigorrun/core';
import { clearEnvironments, registerEnvironment } from '@rigorrun/environment';
import type { AgentRunInput } from '@rigorrun/agents';
import { runBenchmark, type RunProgress } from '../src/index.ts';
import { TEST_FIXTURE, testEnvironment } from '../../environment/test/support.ts';
import {
  CHECK_MARKER,
  PLAN_MARKER,
  RECIPE_MARKER,
  SYSTEM_NAME,
  adder,
  blackBoxAdder,
  fakeBenchmark,
  fakeCase,
  fakeSession,
  registerFakePack,
  type FakeSessionOptions,
} from './fakePack.ts';

afterEach(() => clearEnvironments());

function setUp(options: FakeSessionOptions = {}) {
  const session = fakeSession(options);
  registerFakePack(session);
  return session;
}

const only = (result: { caseResults: CaseResult[] }): CaseResult => {
  expect(result.caseResults).toHaveLength(1);
  return result.caseResults[0]!;
};

describe('creating the records', () => {
  it('materializes exactly once per attempt, with the attempt it is for', async () => {
    const session = setUp();
    const result = await runBenchmark(fakeBenchmark(), [adder('correct', 5)], {
      runId: 'run_m',
      repeats: 3,
    });
    expect(session.made.map((entry) => entry.ctx)).toEqual(
      [0, 1, 2].map((attempt) => ({
        runId: 'run_m',
        caseId: 'case_add_one',
        agentId: 'correct',
        attempt,
      })),
    );
    expect(
      session.made.every((entry) => (entry.recipe as { note: string }).note === RECIPE_MARKER),
    ).toBe(true);
    expect(result.caseResults.map((entry) => entry.attempt)).toEqual([0, 1, 2]);
    // Every attempt worked on records of its own.
    const records = result.caseResults.map((entry) => entry.materialized?.['record']);
    expect(new Set(records).size).toBe(3);
  });

  it('runs every requested repeat, isolated by fresh records rather than a reset', async () => {
    setUp();
    const result = await runBenchmark(fakeBenchmark(), [adder('correct', 5)], { repeats: 3 });
    expect(result.caseResults).toHaveLength(3);
    expect(result.isolation).toBe('FRESH_OBJECTS');
    expect(result.limits.map((limit) => limit.id)).not.toContain('repeats_clamped');
    expect(result.caseResults.every((entry) => entry.outcome === 'PASS')).toBe(true);
    expect(result.scores[0]!.passAtK).toBeDefined();
  });

  it('starts from what was made, labelled as made', async () => {
    setUp();
    const entry = only(await runBenchmark(fakeBenchmark(), [adder('correct', 5)]));
    expect(entry.baseline).toBe('MATERIALIZED');
    expect(entry.initialStateHash).not.toBe('');
    expect(entry.readScope).toBe(`Record ${entry.materialized!['record']} and the items on it.`);
  });

  it('says what the run cannot claim: scoped reads, and a simulated system', async () => {
    setUp({ simulated: true });
    const result = await runBenchmark(fakeBenchmark(), [adder('correct', 5)]);
    expect(result.verification).toBe('PARTIAL');
    expect(result.limits.map((limit) => limit.id)).toEqual(
      expect.arrayContaining(['scoped_state_read', 'simulated']),
    );
  });
});

describe('binding the case', () => {
  it('hands the agent the bound task, and checks the bound checks', async () => {
    const session = setUp();
    const seen: AgentRunInput[] = [];
    const entry = only(await runBenchmark(fakeBenchmark(), [adder('correct', 5, 'Done.', seen)]));
    const record = session.made[0]!.bindings['record']!;
    expect(seen[0]!.task.instruction).toBe(`Add one item of 5 units to record ${record}.`);
    expect(seen[0]!.task.inputs).toEqual({ record, label: `Label of ${record}` });
    expect(entry.outcome).toBe('PASS');
    expect(entry.materialized).toEqual({ record, label: `Label of ${record}` });
    // The checks ran against the bound record: one of them had to find it.
    const added = entry.assertions.find((assertion) => assertion.assertionId === 'added')!;
    expect(added.status).toBe('PASS');
  });

  it('fails an agent that worked on the wrong amount, on the bound record', async () => {
    setUp();
    const entry = only(await runBenchmark(fakeBenchmark(), [adder('wrong', 50)]));
    expect(entry.outcome).toBe('FAIL');
    expect(entry.unsafeActions).toBe(1);
  });

  it('is a harness failure, never the agent’s, when a token is left unbound', async () => {
    setUp({ bindings: ({ record }) => ({ record }) });
    const seen: AgentRunInput[] = [];
    const result = await runBenchmark(fakeBenchmark(), [adder('correct', 5, 'Done.', seen)]);
    const entry = only(result);
    expect(entry.outcome).toBe('HARNESS_FAILURE');
    expect(entry.outcomeReason).toMatch(
      /could not bind the case to its records: .*nothing is bound to "label"/,
    );
    expect(entry.missingEvidence).toEqual(['harness:bind the case to its records']);
    expect(seen).toEqual([]);
    // What was made is still on record, so a person can find it.
    expect(entry.materialized).toEqual({ record: expect.stringMatching(/^rec_/) });
    expect(result.scores[0]!.harnessFailures).toBe(1);
  });

  it('is a harness failure when a bound value could change what a check asks', async () => {
    setUp({ bindings: ({ label }) => ({ record: 'rec_1 & units=5', label }) });
    const seen: AgentRunInput[] = [];
    const entry = only(await runBenchmark(fakeBenchmark(), [adder('correct', 5, 'Done.', seen)]));
    expect(entry.outcome).toBe('HARNESS_FAILURE');
    expect(entry.outcomeReason).toMatch(/not a plain identifier/);
    expect(seen).toEqual([]);
  });
});

describe('when the records cannot be made', () => {
  it('is a harness failure, never scored as the agent’s FAIL, and the agent never runs', async () => {
    setUp({ failMaterialize: true });
    const seen: AgentRunInput[] = [];
    const result = await runBenchmark(fakeBenchmark(), [adder('correct', 5, 'Done.', seen)], {
      repeats: 2,
    });
    expect(seen).toEqual([]);
    for (const entry of result.caseResults) {
      expect(entry.outcome).toBe('HARNESS_FAILURE');
      expect(entry.outcomeReason).toBe(
        "RigorRun could not create the case's records: the system refused to create a record",
      );
      expect(entry.missingEvidence).toEqual(["harness:create the case's records"]);
      expect(entry).not.toHaveProperty('materialized');
      expect(entry.steps).toEqual([]);
    }
    const score = result.scores[0]!;
    expect(score.harnessFailures).toBe(2);
    expect(score.policyViolations).toBe(0);
    expect(score.unsafeActions).toBe(0);
    expect(result.verdict.outcome).not.toBe('FAIL');
  });

  it('abstains when the starting world cannot be read', async () => {
    setUp({ failReadsFrom: 1 });
    const entry = only(await runBenchmark(fakeBenchmark(), [adder('correct', 5)]));
    expect(entry.outcome).toBe('ABSTAIN');
    expect(entry.baseline).toBe('UNAVAILABLE');
    expect(entry.missingEvidence).toContain('initial_state_unavailable:list_items');
    // Nothing is said about the system when it could not be read.
    expect(entry).not.toHaveProperty('reality');
  });
});

describe('what the agent can see', () => {
  it('never includes the recipe, the checks or the reference plan', async () => {
    const session = setUp();
    const seen: AgentRunInput[] = [];
    await runBenchmark(fakeBenchmark(), [adder('correct', 5, 'Done.', seen)]);
    const visible = JSON.stringify(seen);
    for (const marker of [RECIPE_MARKER, CHECK_MARKER, PLAN_MARKER]) {
      expect(visible, `${marker} reached the agent`).not.toContain(marker);
    }
    expect(visible).not.toContain('{{bind:');
    expect(visible).not.toContain('derived.');
    expect(Object.keys(seen[0]!).sort()).toEqual(['caseId', 'maxSteps', 'task']);
    // Not even through the tool channel: the session was asked nothing but the work.
    expect(JSON.stringify(session.executed)).not.toContain(PLAN_MARKER);
  });

  it('gives a black-box agent the same bound task, and judges it on state alone', async () => {
    const session = setUp();
    const seen: AgentRunInput[] = [];
    const result = await runBenchmark(fakeBenchmark(), [blackBoxAdder(session.world, 5, seen)]);
    const entry = only(result);
    const record = session.made[0]!.bindings['record']!;
    expect(seen[0]!.task.inputs['record']).toBe(record);
    expect(JSON.stringify(seen)).not.toContain(RECIPE_MARKER);
    expect(entry.outcome).toBe('PASS');
    expect(entry.observation).toBe('state-only');
    expect(result.limits.map((limit) => limit.id)).toContain('no_call_trace');
  });

  it('catches a black-box agent that did the wrong thing, from state alone', async () => {
    const session = setUp();
    const entry = only(await runBenchmark(fakeBenchmark(), [blackBoxAdder(session.world, 7)]));
    expect(entry.outcome).toBe('FAIL');
    expect(entry.reality?.lines).toEqual([
      expect.stringMatching(
        new RegExp(`^Item itm_\\d+ of 7 units on ${session.made[0]!.bindings['record']}\\.$`),
      ),
    ]);
  });
});

describe("checks on the agent's calls", () => {
  // Until 0.5.0 the verifier was handed no events, so a check on a call the
  // agent made answered as if it had made none: event_occurred always failed
  // and event_not_occurred always passed.
  const callChecks = [
    {
      id: 'called_add',
      kind: 'event_occurred',
      severity: 'success',
      description: 'The agent called addItem',
      target: 'addItem',
    },
    {
      id: 'never_seven',
      kind: 'event_not_occurred',
      severity: 'policy',
      description: 'The agent never asked for 7 units',
      target: 'addItem',
      expected: { units: 7 },
    },
  ];

  it('sees a call the agent made', async () => {
    setUp();
    const entry = only(
      await runBenchmark(fakeBenchmark([fakeCase({ checks: callChecks })]), [adder('correct', 5)]),
    );
    const byId = Object.fromEntries(entry.assertions.map((result) => [result.assertionId, result.status]));
    expect(byId).toEqual({ called_add: 'PASS', never_seven: 'PASS' });
    expect(entry.outcome).toBe('PASS');
  });

  it('fails a call the agent must not have made', async () => {
    setUp();
    const entry = only(
      await runBenchmark(fakeBenchmark([fakeCase({ checks: callChecks })]), [adder('wrong', 7)]),
    );
    const byId = Object.fromEntries(entry.assertions.map((result) => [result.assertionId, result.status]));
    expect(byId['never_seven']).toBe('FAIL');
    expect(entry.outcome).toBe('FAIL');
  });

  it('leaves call checks unmade for a black-box agent, whose calls it never saw', async () => {
    const session = setUp();
    const entry = only(
      await runBenchmark(fakeBenchmark([fakeCase({ checks: callChecks })]), [
        blackBoxAdder(session.world, 7),
      ]),
    );
    expect(entry.assertions.every((result) => result.status === 'UNVERIFIABLE')).toBe(true);
  });
});

describe('production', () => {
  it('still refuses a black-box agent outright', async () => {
    const session = setUp({ safety: 'production' });
    await expect(runBenchmark(fakeBenchmark(), [blackBoxAdder(session.world, 5)])).rejects.toThrow(
      /marked production/,
    );
    expect(session.made).toEqual([]);
  });

  it('creates nothing in it, and fails no agent for that', async () => {
    const session = setUp({ safety: 'production' });
    const entry = only(await runBenchmark(fakeBenchmark(), [adder('correct', 5)]));
    expect(session.made).toEqual([]);
    expect(entry.outcome).toBe('HARNESS_FAILURE');
    expect(entry.outcomeReason).toMatch(/marked production/);
  });
});

describe('what the system showed', () => {
  it('is kept beside the agent’s claim, in the system’s own words', async () => {
    const session = setUp();
    const entry = only(
      await runBenchmark(fakeBenchmark(), [adder('liar', 0, 'Added one item of 5 units.')]),
    );
    const record = session.made[0]!.bindings['record']!;
    expect(entry.outcome).toBe('FAIL');
    expect(entry.agentReport).toBe('Added one item of 5 units.');
    expect(entry.reality).toEqual({ system: SYSTEM_NAME, lines: [`No item on ${record}.`] });
  });

  it('is left out when the system has nothing to say', async () => {
    setUp({ reality: false });
    const entry = only(await runBenchmark(fakeBenchmark(), [adder('correct', 5)]));
    expect(entry).not.toHaveProperty('reality');
    expect(entry.missingEvidence).toEqual([]);
  });

  it('costs only itself when the system fails to say it: the verdict stands', async () => {
    setUp({ failReality: true });
    const entry = only(await runBenchmark(fakeBenchmark(), [adder('correct', 5)]));
    expect(entry.outcome).toBe('PASS');
    expect(entry).not.toHaveProperty('reality');
    expect(entry.missingEvidence).toEqual(['reality_unavailable']);
  });

  it('is never said about a final world that could not be read', async () => {
    // The starting read answers; the final one does not.
    setUp({ failReadsFrom: 2 });
    const entry = only(await runBenchmark(fakeBenchmark(), [adder('correct', 5)]));
    expect(entry.outcome).toBe('ABSTAIN');
    expect(entry.missingEvidence).toContain('final_state_unavailable:list_items');
    expect(entry).not.toHaveProperty('reality');
  });
});

describe('the stored result', () => {
  it('carries the bindings, the scope and the system’s account, and reads back unchanged', async () => {
    setUp();
    const finished: CaseResult[] = [];
    const result = await runBenchmark(fakeBenchmark(), [adder('correct', 5), adder('liar', 0)], {
      onProgress: (event: RunProgress) => {
        if (event.type === 'case_finished') finished.push(event.result);
      },
    });
    // What an after-case program is handed is the same result, bindings included.
    expect(finished.map((entry) => Object.keys(entry.materialized ?? {}).sort())).toEqual([
      ['label', 'record'],
      ['label', 'record'],
    ]);
    const stored = JSON.parse(JSON.stringify(result)) as unknown;
    const parsed = parseRunResult(stored);
    expect(canonicalJson(parsed)).toBe(canonicalJson(result));
    for (const entry of parsed.caseResults) {
      expect(entry.materialized?.['record']).toMatch(/^rec_\d+$/);
      expect(entry.readScope).toMatch(/^Record rec_\d+ and the items on it\.$/);
      expect(entry.reality?.system).toBe(SYSTEM_NAME);
      expect(entry.attempt).toBe(0);
    }
  });

  it('records nothing new for an environment that installs its world', async () => {
    // The ordinary path is unchanged: no bindings, no scope, no account.
    clearEnvironments();
    registerEnvironment(testEnvironment);
    const benchmark = {
      ...fakeBenchmark([
        fakeCase({
          seed: { scenarioId: 'installed', state: TEST_FIXTURE.state },
          task: { instruction: 'Look, and change nothing.' },
          checks: [
            {
              id: 'nothing',
              kind: 'state_not_exists',
              description: 'Nothing was filed',
              target: 'derived.created.Claim',
            },
          ],
          referencePlan: [],
        }),
      ]),
      environment: testEnvironment.id,
    };
    const entry = only(await runBenchmark(benchmark, [adder('nobody', 0)]));
    expect(entry.outcome).toBe('PASS');
    expect(entry.baseline).toBe('INSTALLED_SEED');
    expect(entry.attempt).toBe(0);
    expect(entry).not.toHaveProperty('materialized');
    expect(entry).not.toHaveProperty('readScope');
    expect(entry).not.toHaveProperty('reality');
  });
});
