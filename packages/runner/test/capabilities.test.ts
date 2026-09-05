/**
 * The runner refusing to overstate a run.
 *
 * `packages/runner/test` was empty until now, which is its own small finding:
 * the component that decides what a verdict says had no tests of its own. These
 * cover the part that matters most — what happens when the environment is worse
 * than the in-memory one everything else was built against.
 *
 * The technique throughout is to change only the *declaration*. The wrapper
 * below behaves exactly like the in-memory environment; it simply claims less.
 * That isolates what the capability model is responsible for from what the
 * environment actually does, which is the only way to be sure the honesty is
 * coming from the model rather than from a coincidence.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FULL_CAPABILITIES,
  clearEnvironments,
  registerEnvironment,
  type ActionResult,
  type CanonicalState,
  type CaseConfig,
  type EnvironmentAdapter,
  type EnvironmentCapabilities,
  type EnvironmentRegistration,
} from '@rigorrun/environment';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { applyReview, fromActionLog, rulesAwaitingReview } from '@rigorrun/core';
import { naiveAgent } from '@rigorrun/agents';
import { runBenchmark } from '../src/index.ts';
import { TEST_FIXTURE, testEnvironment } from '../../environment/test/support.ts';

const CONSTRAINED_ID = 'constrained';

/** Delegates everything and answers `capabilities()` differently. */
class Claiming implements EnvironmentAdapter {
  readonly id = CONSTRAINED_ID;
  readonly name: string;
  readonly description: string;

  constructor(
    private readonly inner: EnvironmentAdapter,
    private readonly claim: EnvironmentCapabilities,
  ) {
    this.name = inner.name;
    this.description = inner.description;
  }

  capabilities(): EnvironmentCapabilities {
    return this.claim;
  }

  describeEntities() {
    return this.inner.describeEntities();
  }
  getActions() {
    return this.inner.getActions();
  }
  describeCaseConfig() {
    return this.inner.describeCaseConfig();
  }
  describePresentation() {
    return this.inner.describePresentation();
  }
  reset() {
    return this.inner.reset();
  }
  seed(state: CanonicalState, config?: CaseConfig) {
    return this.inner.seed(state, config);
  }
  getState() {
    return this.inner.getState();
  }
  getEvents() {
    return this.inner.getEvents();
  }
  executeAction(name: string, args: Record<string, unknown>): Promise<ActionResult> | ActionResult {
    return this.inner.executeAction(name, args);
  }
  snapshot() {
    return this.inner.snapshot();
  }
  restore(snapshot: Parameters<EnvironmentAdapter['restore']>[0]) {
    return this.inner.restore(snapshot);
  }
}

function claiming(caps: Partial<EnvironmentCapabilities>): EnvironmentRegistration {
  return {
    id: CONSTRAINED_ID,
    name: testEnvironment.name,
    description: testEnvironment.description,
    fixtures: testEnvironment.fixtures,
    create: () => new Claiming(testEnvironment.create(), { ...FULL_CAPABILITIES, ...caps }),
  };
}

/** One demonstrated job against the constrained environment, compiled. */
async function benchmarkFor(registration: EnvironmentRegistration) {
  clearEnvironments();
  registerEnvironment(registration);

  const recorder = registration.create();
  await recorder.reset();
  await recorder.seed(TEST_FIXTURE.state, TEST_FIXTURE.config);
  const before = await recorder.getState();
  await recorder.executeAction('requestPermit', { itemId: 'ITM-1' });
  await recorder.executeAction('fileClaim', {
    accountId: 'ACC-1',
    itemId: 'ITM-1',
    amount: 30,
    permitId: 'PRM-9001',
  });

  const trace = fromActionLog(
    [
      { at: 0, action: 'requestPermit', args: { itemId: 'ITM-1' } },
      {
        at: 1000,
        action: 'fileClaim',
        args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30, permitId: 'PRM-9001' },
      },
    ],
    {
      environmentId: registration.id,
      id: 'trace_constrained',
      name: 'A demonstrated claim',
      before,
      after: await recorder.getState(),
    },
  );

  const draft = induceContract(registration.create(), trace, {
    contractId: 'ec_constrained',
    createdAt: '2026-01-20T09:00:00.000Z',
  }).contract;
  const contract = applyReview(draft, {
    confirmedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id),
  });

  return generateBenchmark(registration.create(), contract, [TEST_FIXTURE]);
}

afterEach(() => {
  clearEnvironments();
});

describe('a run against a constrained environment', () => {
  it('labels the verdict by how it was actually established', async () => {
    const { benchmark } = await benchmarkFor(claiming({ stateRead: 'designated-reads' }));
    const result = await runBenchmark(benchmark, [naiveAgent]);
    expect(result.verification).toBe('PARTIAL');
  });

  it('says so when nothing could be read back at all', async () => {
    const { benchmark } = await benchmarkFor(claiming({ stateRead: 'none' }));
    const result = await runBenchmark(benchmark, [naiveAgent]);
    expect(result.verification).toBe('OBSERVATIONAL');
  });

  it('refuses to repeat mutating cases without a reset, and records why', async () => {
    const { benchmark } = await benchmarkFor(claiming({ reset: 'none' }));
    const result = await runBenchmark(benchmark, [naiveAgent], { repeats: 5 });

    expect(result.isolation).toBe('NONE');
    // The clamp is the point: five attempts without a reset would have measured
    // the leftovers of the previous four.
    expect(result.caseResults).toHaveLength(benchmark.cases.length);

    const clamped = result.limits.find((limit) => limit.id === 'repeats_clamped');
    expect(clamped?.limit).toMatch(/Asked for 5 attempts/);
    expect(clamped?.remedy).toMatch(/Configure a reset/);
  });

  it('carries every limit into the artefact, not just into a log line', async () => {
    const { benchmark } = await benchmarkFor(
      claiming({ stateRead: 'none', reset: 'none', seed: 'none', discovery: 'tools-only' }),
    );
    const result = await runBenchmark(benchmark, [naiveAgent]);
    const ids = result.limits.map((limit) => limit.id);
    expect(ids).toEqual(
      expect.arrayContaining(['no_state_read', 'no_reset', 'no_seed', 'induced_schema']),
    );
  });

  it('refuses every write on a production system, and shows what was refused', async () => {
    const { benchmark } = await benchmarkFor(claiming({ safety: 'production' }));
    const result = await runBenchmark(benchmark, [naiveAgent]);

    const steps = result.caseResults.flatMap((entry) => entry.steps);
    const refused = steps.filter((step) => step.error === 'WRITE_REFUSED');
    expect(refused.length).toBeGreaterThan(0);
    // Refused at the channel and still recorded, so the evidence shows what the
    // agent would have done rather than a case that quietly never ran.
    for (const step of refused) expect(step.ok).toBe(false);
  });

  it('keeps the full claim when the environment genuinely earns it', async () => {
    const { benchmark } = await benchmarkFor(claiming({}));
    const result = await runBenchmark(benchmark, [naiveAgent]);
    expect(result.verification).toBe('AUTHORITATIVE');
    expect(result.isolation).toBe('RESET');
    expect(result.limits).toEqual([]);
  });

  it('records what the suite could not cover on the benchmark itself', async () => {
    const { benchmark } = await benchmarkFor(claiming({ seed: 'none', reset: 'none' }));
    const reasons = benchmark.notTestable.map((entry) => entry.rule);
    expect(reasons).toEqual(expect.arrayContaining(['no_seed', 'no_reset']));
  });
});
