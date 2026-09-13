/**
 * Four things that are not a wrong answer, kept apart from one.
 *
 * The audit's injected retry case died at the case budget and was recorded as
 * a FAIL — which the report then counted as a detection. A timeout, an agent
 * crash, a harness failure and missing evidence are findings about the run,
 * and each is named as one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearEnvironments } from '@rigorrun/environment';
import { decideVerdict } from '@rigorrun/scoring';
import { runBenchmark } from '../src/index.ts';
import { CLEAN_ROWS, CORRECT, FALSE_CLAIM, happyOnly, liveBenchmark, liveRegistration, scripted, world } from './liveWorld.ts';

afterEach(() => clearEnvironments());

async function happyOf(result: Awaited<ReturnType<typeof runBenchmark>>) {
  return result.caseResults.find((r) => r.category === 'happy_path')!;
}

describe('how a case ended', () => {
  it('TIMED_OUT when the agent does not finish inside the case budget', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    const slow = scripted('slow', () => new Promise(() => undefined));
    const budgeted = { ...benchmark, cases: benchmark.cases.map((c) => ({ ...c, timeoutMs: 40 })) };
    const happy = await happyOf(await runBenchmark(budgeted, [slow]));
    expect(happy.outcome).toBe('TIMED_OUT');
    expect(happy.outcomeReason).toMatch(/40 ms case budget/);
    expect(happy.taskSuccess).toBe(false);
    expect(happy.errored).toBe(true);
  });

  it('FAIL, not TIMED_OUT, when a check failed on what the agent did before the budget ran out', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    // Writing to a record the job is not about breaks a rule the environment
    // declares; that is a finding about the agent whatever happened next.
    const wrongThenHang = scripted('wrong-then-hang', async (env) => {
      await env.call('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 });
      await env.call('writeLog', { action: 'oops', detail: 'not part of the job' });
      await new Promise(() => undefined);
    });
    const budgeted = { ...benchmark, cases: benchmark.cases.map((c) => ({ ...c, timeoutMs: 40 })) };
    const happy = await happyOf(await runBenchmark(budgeted, [wrongThenHang]));
    expect(happy.outcome).toBe('FAIL');
    expect(happy.outcomeReason).toMatch(/log entry/i);
  });

  it('AGENT_FAILURE when the agent throws', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    const crashing = scripted('crashing', async () => {
      throw new Error('protocol violation: no final message');
    });
    const happy = await happyOf(await runBenchmark(benchmark, [crashing]));
    expect(happy.outcome).toBe('AGENT_FAILURE');
    expect(happy.error).toMatch(/protocol violation/);
  });

  it('HARNESS_FAILURE when the environment cannot be reset', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    clearEnvironments();
    const { registerEnvironment } = await import('@rigorrun/environment');
    registerEnvironment(liveRegistration({ resetTo: world(CLEAN_ROWS), failReset: true }));
    const happy = await happyOf(await runBenchmark(benchmark, [CORRECT]));
    expect(happy.outcome).toBe('HARNESS_FAILURE');
    expect(happy.steps).toEqual([]);
    expect(happy.missingEvidence).toContain('harness:reset the environment');
  });

  it('ABSTAIN when the starting world could not be read', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    clearEnvironments();
    const { registerEnvironment } = await import('@rigorrun/environment');
    registerEnvironment(liveRegistration({ resetTo: world(CLEAN_ROWS), failReadsFrom: 1 }));
    const happy = await happyOf(await runBenchmark(benchmark, [CORRECT]));
    expect(happy.outcome).toBe('ABSTAIN');
    expect(happy.baseline).toBe('UNAVAILABLE');
    expect(happy.missingEvidence).toContain('initial_state_unavailable:list_claims');
    expect(happy.assertions.every((a) => a.status === 'UNVERIFIABLE' || a.verificationSource !== 'STATE')).toBe(true);
    expect(happy.taskSuccess).toBe(false);
  });

  it('ABSTAIN when the final world could not be read', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    clearEnvironments();
    const { registerEnvironment } = await import('@rigorrun/environment');
    registerEnvironment(liveRegistration({ resetTo: world(CLEAN_ROWS), failReadsFrom: 2 }));
    const happy = await happyOf(await runBenchmark(benchmark, [CORRECT]));
    expect(happy.outcome).toBe('ABSTAIN');
    expect(happy.baseline).toBe('OBSERVED_AT_START');
    expect(happy.missingEvidence).toContain('final_state_unavailable:list_claims');
  });

  it('ABSTAIN, never PASS or FAIL, when nothing can be read back at all', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    clearEnvironments();
    const { registerEnvironment } = await import('@rigorrun/environment');
    registerEnvironment(liveRegistration({ resetTo: world(CLEAN_ROWS), caps: { stateRead: 'none' } }));
    for (const agent of [CORRECT, FALSE_CLAIM]) {
      const result = await runBenchmark(benchmark, [agent]);
      const happy = await happyOf(result);
      expect(happy.outcome).toBe('ABSTAIN');
      expect(happy.missingEvidence).toContain('no_state_read');
      expect(happy.verification).toBe('OBSERVATIONAL');
      expect(happy.evidenceIndependence).toBe('NONE');
      expect(result.verification).toBe('OBSERVATIONAL');
    }
  });

  it('labels a decided verdict with where its evidence came from', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    const happy = await happyOf(await runBenchmark(benchmark, [CORRECT]));
    expect(happy.verification).toBe('PARTIAL');
    expect(happy.evidenceIndependence).toBe('SELF_REPORTED');
    expect(happy.outcomeReason).toMatch(/every applicable check passed/);
  });
});

describe('what a score does with cases that reached no verdict', () => {
  it('excludes them from the rates, counts them, and refuses to gate on them', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    clearEnvironments();
    const { registerEnvironment } = await import('@rigorrun/environment');
    registerEnvironment(liveRegistration({ resetTo: world(CLEAN_ROWS), caps: { stateRead: 'none' } }));
    const result = await runBenchmark(benchmark, [CORRECT]);
    const score = result.scores[0]!;
    expect(score.abstained).toBe(result.caseResults.length);
    expect(score.decided).toBe(0);
    expect(score.inconclusiveRate).toBe(1);
    expect(score.thresholdsPassed).toBe(false);
    expect(score.inconclusive).toBe(true);
    expect(score.failedThresholds.join(' ')).toMatch(/reached no verdict/);
    expect(result.verdict.outcome).toBe('INCONCLUSIVE');
    expect(result.verdict.winnerAgentId).toBeNull();
  });

  it('still fails an agent that got a decided case wrong', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    const result = await runBenchmark(happyOnly(benchmark), [FALSE_CLAIM]);
    const score = result.scores[0]!;
    expect(score.inconclusive).toBe(false);
    expect(score.thresholdsPassed).toBe(false);
    expect(decideVerdict(result.scores).outcome).toBe('FAIL');
  });

  it('passes a correct agent on decided cases', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: world(CLEAN_ROWS) }));
    const result = await runBenchmark(happyOnly(benchmark), [CORRECT]);
    expect(result.verdict.outcome).toBe('PASS');
  });
});
