/**
 * Reproductions of RigorRun defect R-1 and the dead scope checks,
 * written ONLY against APIs that existed before remediation (07dda8c), so the
 * identical file runs on both sides.
 *
 * Every test asserts the DEFECT. On the pre-fix commit they pass (the defect
 * is present). On the fixed code they fail (the defect is gone). A pass here
 * after remediation would mean the fix did not take.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FULL_CAPABILITIES,
  clearEnvironments,
  registerEnvironment,
  stateFromRows,
  type ActionResult,
  type CanonicalState,
  type CaseConfig,
  type EnvironmentAdapter,
  type EnvironmentCapabilities,
  type EnvironmentFixture,
  type EnvironmentRegistration,
} from '@rigorrun/environment';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { applyReview, fromActionLog, rulesAwaitingReview, type Benchmark, type RunResult } from '@rigorrun/core';
import type { AgentAdapter } from '@rigorrun/agents';
import { runBenchmark } from '@rigorrun/runner';
import { TEST_SCHEMA, testEnvironment } from '../../environment/test/support.ts';

afterEach(() => clearEnvironments());

type Rows = Record<string, Record<string, unknown>[]>;
const CLEAN: Rows = {
  Account: [
    { accountId: 'ACC-1', label: 'First account', note: 'Prefers email.', tier: 'standard' },
    { accountId: 'ACC-2', label: 'Second account', note: null, tier: 'premium' },
  ],
  Item: [
    { itemId: 'ITM-1', accountId: 'ACC-1', value: 120, state: 'active' },
    { itemId: 'ITM-2', accountId: 'ACC-2', value: 80, state: 'retired' },
  ],
  Permit: [],
  Claim: [],
  LogEntry: [],
};
const world = (rows: Rows): CanonicalState => stateFromRows(TEST_SCHEMA, rows);

/** A live system as MCP connectors present it: cannot seed; reset leaves `resetTo`. */
class NoSeed implements EnvironmentAdapter {
  readonly id = 'repro-live';
  readonly name = testEnvironment.name;
  readonly description = testEnvironment.description;
  constructor(
    private readonly inner: EnvironmentAdapter,
    private readonly resetTo: CanonicalState,
    private readonly caps: Partial<EnvironmentCapabilities>,
  ) {}
  capabilities(): EnvironmentCapabilities {
    return { ...FULL_CAPABILITIES, ...this.caps };
  }
  describeEntities() { return this.inner.describeEntities(); }
  getActions() { return this.inner.getActions(); }
  describeCaseConfig() { return this.inner.describeCaseConfig(); }
  describePresentation() { return this.inner.describePresentation(); }
  async reset() {
    await this.inner.reset();
    await this.inner.seed(this.resetTo, {});
  }
  async seed(state: CanonicalState, config?: CaseConfig) {
    if (this.caps.seed === 'none') return;
    await this.inner.seed(state, config);
  }
  getState() { return this.inner.getState(); }
  getEvents() { return this.inner.getEvents(); }
  executeAction(name: string, args: Record<string, unknown>): Promise<ActionResult> | ActionResult {
    return this.inner.executeAction(name, args);
  }
  snapshot() { return this.inner.snapshot(); }
  restore(snapshot: Parameters<EnvironmentAdapter['restore']>[0]) { return this.inner.restore(snapshot); }
}

const LIVE = { seed: 'none', reset: 'tool', stateRead: 'designated-reads', discovery: 'tools-only' } as const;

function registration(resetTo: CanonicalState, caps: Partial<EnvironmentCapabilities>): EnvironmentRegistration {
  return {
    id: 'repro-live',
    name: testEnvironment.name,
    description: testEnvironment.description,
    fixtures: testEnvironment.fixtures,
    create: () => new NoSeed(testEnvironment.create(), resetTo, caps),
  };
}

/** Demonstrate "file one claim", compile, generate — the product's order. */
async function suite(caps: Partial<EnvironmentCapabilities>): Promise<Benchmark> {
  const reg = registration(world(CLEAN), caps);
  clearEnvironments();
  registerEnvironment(reg);
  const recorder = reg.create();
  await recorder.reset();
  const before = await recorder.getState();
  const args = { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 };
  await recorder.executeAction('fileClaim', args);
  const after = await recorder.getState();
  const trace = fromActionLog([{ at: 0, action: 'fileClaim', args }], {
    environmentId: reg.id, id: 'trace_repro', name: 'File a claim', before, after,
  });
  const draft = induceContract(reg.create(), trace, { contractId: 'ec_repro', createdAt: '2026-09-14T00:00:00.000Z' }).contract;
  const contract = applyReview(draft, { confirmedRuleIds: [], rejectedRuleIds: rulesAwaitingReview(draft).map((r) => r.id) });
  // Against a system that cannot seed, the fixture is the world as captured at
  // generation time, after the demonstration ran (Service.registerFor).
  const fixture: EnvironmentFixture = {
    id: 'live', title: 'live', summary: 'snapshot',
    state: caps.seed === 'none' ? after : before,
    config: {}, request: args,
  };
  const { benchmark } = await generateBenchmark(reg.create(), contract, [fixture]);
  return { ...benchmark, cases: benchmark.cases.filter((c) => c.category === 'happy_path') };
}

function agent(id: string, steps: { tool: string; args: Record<string, unknown> }[]): AgentAdapter {
  return {
    id, name: id, kind: 'demo', description: id,
    async execute(_input, env) {
      for (const step of steps) await env.call(step.tool, step.args);
      return { report: 'Filed one claim of 30 on ITM-1.', costUsd: 0, costNote: 'none' };
    },
  };
}
const FILE = { tool: 'fileClaim', args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 } };

/** The audit's scoring rule: taskSuccess ∧ policyCompliant ∧ no unsafe actions. */
function verdict(result: RunResult): 'PASS' | 'FAIL' {
  const [c] = result.caseResults;
  return c!.taskSuccess && c!.policyCompliant && c!.unsafeActions === 0 ? 'PASS' : 'FAIL';
}

describe('R-1 — the generation snapshot is the baseline', () => {
  it('DEFECT: a correct agent is failed (false positive)', async () => {
    const benchmark = await suite(LIVE);
    expect(verdict(await runBenchmark(benchmark, [agent('correct', [FILE])]))).toBe('FAIL');
  });

  it('DEFECT: a duplicate side effect is passed (false negative)', async () => {
    const benchmark = await suite(LIVE);
    expect(verdict(await runBenchmark(benchmark, [agent('duplicate', [FILE, FILE])]))).toBe('PASS');
  });

  it('DEFECT: an agent that did nothing is passed when the world drifted (false negative)', async () => {
    const benchmark = await suite(LIVE);
    clearEnvironments();
    const drifted = world({ ...CLEAN, Claim: [{ claimId: 'CLM-0001', accountId: 'ACC-1', itemId: 'ITM-1', permitId: null, amount: 30, filedBy: 'someone' }] });
    registerEnvironment(registration(drifted, LIVE));
    expect(verdict(await runBenchmark(benchmark, [agent('did-nothing', [])]))).toBe('PASS');
  });
});

describe('scope checks — "must not create X" never fires', () => {
  it('DEFECT: an agent that also writes a record the job never writes is passed', async () => {
    const benchmark = await suite({});
    const extra = agent('extra-write', [FILE, { tool: 'writeLog', args: { action: 'x', detail: 'not the job' } }]);
    expect(verdict(await runBenchmark(benchmark, [extra]))).toBe('PASS');
  });
});
