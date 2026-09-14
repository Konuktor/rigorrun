/**
 * Ambiguous retries: the side effect committed, the answer did not arrive.
 *
 * The audit could only measure this class with a direct client, because the
 * case budget died before the retry happened (R-4). Every combination is built
 * here in-process, with the fault injected inside the adapter so the world is
 * the only witness: the transcript an agent sees says the first call failed,
 * and the verdict has to come from how many records actually exist.
 *
 *   never happened + retry          → one record    → PASS
 *   happened + normal response      → one record    → PASS
 *   happened + response lost + retry → two records   → FAIL
 *   happened + error + retry        → two records   → FAIL
 *   happened + delayed response     → one record    → PASS
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearEnvironments,
  registerEnvironment,
  type ActionDefinition,
  type ActionResult,
  type CanonicalState,
  type CaseConfig,
  type EnvironmentAdapter,
} from '@rigorrun/environment';
import { BUDGET_MARGIN_MS, DEFAULT_CASE_TIMEOUT_MS, DEFAULT_TOOL_CALL_TIMEOUT_MS, type Benchmark } from '@rigorrun/core';
import type { AgentAdapter } from '@rigorrun/agents';
import { runBenchmark } from '../src/index.ts';
import { CLEAN_ROWS, LIVE_ID, LiveWorld, happyOnly, liveBenchmark, liveRegistration, scripted, world } from './liveWorld.ts';
import { testEnvironment } from '../../environment/test/support.ts';

afterEach(() => clearEnvironments());

type Fault = 'none' | 'fails_before_commit' | 'response_lost' | 'error_after_commit' | 'delayed';
const ARGS = { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The live stand-in, with one fault on the first `fileClaim` and a read to check with. */
class FaultyWorld implements EnvironmentAdapter {
  readonly id = LIVE_ID;
  readonly name = testEnvironment.name;
  readonly description = testEnvironment.description;
  private claimCalls = 0;

  constructor(
    private readonly live: LiveWorld,
    private readonly fault: Fault,
    private readonly toolTimeoutMs: number,
  ) {}

  capabilities() { return this.live.capabilities(); }
  describeEntities() { return this.live.describeEntities(); }
  describeCaseConfig() { return this.live.describeCaseConfig(); }
  describePresentation() { return this.live.describePresentation(); }
  reset() { return this.live.reset(); }
  seed(state: CanonicalState, config?: CaseConfig) { return this.live.seed(state, config); }
  getState() { return this.live.getState(); }
  getEvents() { return this.live.getEvents(); }
  snapshot() { return this.live.snapshot(); }
  restore(snapshot: Parameters<EnvironmentAdapter['restore']>[0]) { return this.live.restore(snapshot); }

  getActions(): ActionDefinition[] {
    return [
      ...this.live.getActions(),
      { name: 'listClaims', description: 'Every claim.', readOnly: true, mutates: [], enforcement: 'none', params: [] },
    ];
  }

  async executeAction(name: string, args: Record<string, unknown>): Promise<ActionResult> {
    if (name === 'listClaims') {
      return { ok: true, data: Object.values((await this.live.getState()).entities['Claim'] ?? {}) };
    }
    if (name !== 'fileClaim' || this.fault === 'none') return this.live.executeAction(name, args);
    this.claimCalls += 1;
    if (this.claimCalls > 1) return this.live.executeAction(name, args);

    switch (this.fault) {
      case 'fails_before_commit':
        return { ok: false, error: { code: 'UNAVAILABLE', message: 'connection refused before the request was read' } };
      case 'response_lost':
        await this.live.executeAction(name, args); // committed
        await sleep(this.toolTimeoutMs); // the answer never comes
        return { ok: false, error: { code: 'TIMEOUT', message: `no response within ${this.toolTimeoutMs} ms` } };
      case 'error_after_commit':
        await this.live.executeAction(name, args); // committed
        return { ok: false, error: { code: 'INTERNAL', message: 'the server answered 500' } };
      case 'delayed': {
        const result = await this.live.executeAction(name, args);
        await sleep(this.toolTimeoutMs / 2); // slow, but inside the tool timeout
        return result;
      }
    }
  }
}

async function suite(): Promise<Benchmark> {
  const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
  return happyOnly(benchmark);
}

function inject(fault: Fault, toolTimeoutMs = 40): void {
  clearEnvironments();
  registerEnvironment({
    id: LIVE_ID,
    name: testEnvironment.name,
    description: testEnvironment.description,
    fixtures: testEnvironment.fixtures,
    create: () => new FaultyWorld(new LiveWorld(testEnvironment.create(), { resetTo: world(CLEAN_ROWS) }), fault, toolTimeoutMs),
  });
}

/** Retries a failed call once, as most agents and client libraries do. */
const RETRYING: AgentAdapter = scripted('retries-on-error', async (env) => {
  const first = await env.call('fileClaim', ARGS);
  if (!first.ok) await env.call('fileClaim', ARGS);
}, 'Filed one claim.');

/** Reads the world before retrying, which is what an at-least-once server needs. */
const CHECKING: AgentAdapter = scripted('checks-before-retrying', async (env) => {
  const first = await env.call('fileClaim', ARGS);
  if (first.ok) return;
  const listed = await env.call('listClaims');
  const rows = listed.ok ? (listed.data as { accountId: string; itemId: string; amount: number }[]) : [];
  if (!rows.some((row) => row.accountId === 'ACC-1' && row.itemId === 'ITM-1' && row.amount === 30)) {
    await env.call('fileClaim', ARGS);
  }
}, 'Filed one claim.');

async function run(benchmark: Benchmark, agent: AgentAdapter, caseTimeoutMs?: number) {
  const result = await runBenchmark(benchmark, [agent], caseTimeoutMs ? { caseTimeoutMs } : {});
  return result.caseResults[0]!;
}

const claims = (summary: Record<string, unknown>) => (summary['Claim'] as { count: number } | undefined)?.count ?? 0;

describe('the ambiguous-retry matrix, graded by the world', () => {
  const matrix: [Fault, 'PASS' | 'FAIL', number][] = [
    ['none', 'PASS', 1],
    ['fails_before_commit', 'PASS', 1],
    ['response_lost', 'FAIL', 2],
    ['error_after_commit', 'FAIL', 2],
    ['delayed', 'PASS', 1],
  ];
  for (const [fault, expected, records] of matrix) {
    it(`${fault}, agent retries once → ${expected} with ${records} record(s)`, async () => {
      const benchmark = await suite();
      inject(fault);
      const result = await run(benchmark, RETRYING);
      expect(result.outcome, result.outcomeReason).toBe(expected);
      expect(claims(result.finalStateSummary)).toBe(records);
    });
  }

  it('fails the duplicate on the state, even though the transcript shows only one success', async () => {
    const benchmark = await suite();
    inject('response_lost');
    const result = await run(benchmark, RETRYING);
    expect(result.steps.filter((step) => step.tool === 'fileClaim').map((step) => step.ok)).toEqual([false, true]);
    expect(result.agentReport).toBe('Filed one claim.');
    expect(result.assertions.find((a) => a.assertionId === 'success__exactly_as_demonstrated')?.status).toBe('FAIL');
  });

  for (const fault of ['fails_before_commit', 'response_lost', 'error_after_commit'] as const) {
    it(`passes an agent that checks the world before retrying (${fault})`, async () => {
      const benchmark = await suite();
      inject(fault);
      const result = await run(benchmark, CHECKING);
      expect(result.outcome, result.outcomeReason).toBe('PASS');
      expect(claims(result.finalStateSummary)).toBe(1);
    });
  }
});

describe('budgets', () => {
  it('generates cases whose budget outlasts one tool call that never answers', async () => {
    const benchmark = await suite();
    for (const entry of benchmark.cases) {
      expect(entry.timeoutMs).toBe(DEFAULT_CASE_TIMEOUT_MS);
      expect(entry.timeoutMs).toBeGreaterThanOrEqual(DEFAULT_TOOL_CALL_TIMEOUT_MS + BUDGET_MARGIN_MS);
    }
  });

  it('observes the retry when the case budget outlasts the lost response', async () => {
    const benchmark = await suite();
    inject('response_lost', 60);
    const result = await run(benchmark, RETRYING, 1_000);
    expect(result.budgetMs).toBe(1_000);
    expect(result.outcome).toBe('FAIL');
    expect(claims(result.finalStateSummary)).toBe(2);
  });

  it('reports TIMED_OUT, never a detection, when the budget ends inside the lost response', async () => {
    // The audit's shape: the budget is shorter than the call that never answers.
    const benchmark = await suite();
    inject('response_lost', 400);
    const result = await run(benchmark, RETRYING, 60);
    expect(result.budgetMs).toBe(60);
    expect(result.outcome).toBe('TIMED_OUT');
    expect(result.outcome).not.toBe('FAIL');
  });

  it('refuses a budget that is not a positive whole number', async () => {
    const benchmark = await suite();
    inject('none');
    await expect(runBenchmark(benchmark, [RETRYING], { caseTimeoutMs: 0 })).rejects.toThrow(/positive whole number/);
    await expect(runBenchmark(benchmark, [RETRYING], { caseTimeoutMs: 1.5 })).rejects.toThrow(/positive whole number/);
  });
});
