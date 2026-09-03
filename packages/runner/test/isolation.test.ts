import { describe, expect, it } from 'vitest';
import { buildDemoPipeline, runBenchmark, type RunProgress } from '@rigorrun/runner';
import { demoRobustAgent, demoWeakAgent } from '@rigorrun/agents';
import type { AgentAdapter } from '@rigorrun/agents';
import { publicCaseView } from '@rigorrun/core';

const pipeline = await buildDemoPipeline();

describe('case isolation', () => {
  it('starts every case from the seeded state', async () => {
    // The duplicate-refund case must still see exactly one seeded refund even
    // though an earlier case created refunds in its own world.
    const result = await runBenchmark(pipeline.benchmark, [demoWeakAgent], { runId: 'r1' });
    const duplicate = result.caseResults.find((r) => r.caseId === 'case_already-refunded')!;
    const seededPlusNew = (duplicate.finalStateSummary['refunds'] as unknown[]).length;
    expect(seededPlusNew).toBe(2);

    const standard = result.caseResults.find((r) => r.caseId === 'case_standard-refund')!;
    expect((standard.finalStateSummary['refunds'] as unknown[]).length).toBe(1);
  });

  it('produces identical results on repeated runs of the same benchmark', async () => {
    const a = await runBenchmark(pipeline.benchmark, [demoWeakAgent, demoRobustAgent], {
      runId: 'x',
    });
    const b = await runBenchmark(pipeline.benchmark, [demoWeakAgent, demoRobustAgent], {
      runId: 'x',
    });
    const shape = (r: typeof a) =>
      r.caseResults.map((c) => [
        c.agentId,
        c.caseId,
        c.taskSuccess,
        c.policyCompliant,
        c.unsafeActions,
        c.finalStateHash,
      ]);
    expect(shape(a)).toEqual(shape(b));
  });

  it('gives every case its own final state hash where state differs', async () => {
    const result = await runBenchmark(pipeline.benchmark, [demoRobustAgent], { runId: 'r2' });
    const hashes = result.caseResults.map((r) => r.finalStateHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe('benchmark integrity', () => {
  it('never hands the agent its own assertions', async () => {
    const seen: unknown[] = [];
    const spy: AgentAdapter = {
      id: 'spy',
      name: 'Spy',
      kind: 'demo',
      description: 'records everything it is given',
      async execute(runInput) {
        seen.push(runInput);
        return { report: 'observed', costUsd: null, costNote: 'cost unavailable' };
      },
    };

    await runBenchmark(pipeline.benchmark, [spy], { runId: 'r3' });

    const serialised = JSON.stringify(seen);
    expect(serialised).not.toContain('checks');
    expect(serialised).not.toContain('state_not_exists');
    expect(serialised).not.toContain('derived.createdRefunds');
    expect(serialised).not.toContain('unsafeIfFailed');
    expect(serialised).not.toContain('success_refund_amount');
  });

  it('publicCaseView exposes only the public half of a case', () => {
    const view = publicCaseView(pipeline.benchmark.cases[0]!);
    expect(Object.keys(view).sort()).toEqual(['id', 'maxSteps', 'name', 'task']);
    expect('checks' in view).toBe(false);
  });

  it('hashes the benchmark before execution and seals the result afterwards', async () => {
    const result = await runBenchmark(pipeline.benchmark, [demoRobustAgent], { runId: 'r4' });
    expect(result.benchmarkHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.contractHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.resultHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('step budget and failure handling', () => {
  it('stops an agent that will not stop calling tools', async () => {
    const greedy: AgentAdapter = {
      id: 'greedy',
      name: 'Greedy',
      kind: 'demo',
      description: 'calls a tool forever',
      async execute(_input, env) {
        let calls = 0;
        while (calls < 1000) {
          const result = await env.call('getCustomer', { customerId: 'CUST-2001' });
          calls += 1;
          if (!result.ok && result.error.message.includes('Step budget')) break;
        }
        return { report: `made ${calls} calls`, costUsd: null, costNote: 'cost unavailable' };
      },
    };
    const result = await runBenchmark(
      { ...pipeline.benchmark, cases: [pipeline.benchmark.cases[0]!] },
      [greedy],
      { runId: 'r5' },
    );
    expect(result.caseResults[0]!.steps.length).toBeLessThanOrEqual(
      pipeline.benchmark.cases[0]!.maxSteps,
    );
  });

  it('records a thrown agent as an error without losing the case', async () => {
    const broken: AgentAdapter = {
      id: 'broken',
      name: 'Broken',
      kind: 'demo',
      description: 'throws',
      async execute() {
        throw new Error('adapter exploded');
      },
    };
    const result = await runBenchmark(
      { ...pipeline.benchmark, cases: [pipeline.benchmark.cases[0]!] },
      [broken],
      { runId: 'r6' },
    );
    const only = result.caseResults[0]!;
    expect(only.errored).toBe(true);
    expect(only.error).toContain('adapter exploded');
    expect(only.taskSuccess).toBe(false);
  });

  it('rejects a run with no agents', async () => {
    await expect(runBenchmark(pipeline.benchmark, [])).rejects.toThrow(/at least one agent/i);
  });
});

describe('progress reporting', () => {
  it('emits a start, a finish per case, and a final result', async () => {
    const events: RunProgress[] = [];
    const small = { ...pipeline.benchmark, cases: pipeline.benchmark.cases.slice(0, 3) };
    await runBenchmark(small, [demoRobustAgent], {
      runId: 'r7',
      onProgress: (e) => void events.push(e),
    });

    expect(events[0]?.type).toBe('run_started');
    expect(events.filter((e) => e.type === 'case_started')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'case_finished')).toHaveLength(3);
    expect(events.at(-1)?.type).toBe('run_finished');
  });
});

describe('progress callbacks can be awaited', () => {
  it('waits for an async listener before running the next case', async () => {
    const order: string[] = [];
    const small = { ...pipeline.benchmark, cases: pipeline.benchmark.cases.slice(0, 3) };
    await runBenchmark(small, [demoRobustAgent], {
      runId: 'r9',
      onProgress: async (event) => {
        if (event.type !== 'case_finished') return;
        order.push(`start:${event.result.caseId}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`end:${event.result.caseId}`);
      },
    });
    // Every listener finished before the next one began.
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i]?.startsWith('start:')).toBe(true);
      expect(order[i + 1]?.startsWith('end:')).toBe(true);
    }
    expect(order).toHaveLength(6);
  });
});

describe('repeats enable pass@k', () => {
  it('records every attempt and reports pass@k', async () => {
    const small = { ...pipeline.benchmark, cases: pipeline.benchmark.cases.slice(0, 2) };
    const result = await runBenchmark(small, [demoRobustAgent], { runId: 'r8', repeats: 3 });
    expect(result.caseResults).toHaveLength(6);
    const score = result.scores[0]!;
    expect(score.passAtK['pass@1']).toBeDefined();
    expect(score.passAtK['pass@3']).toBeDefined();
  });
});
