import { describe, expect, it } from 'vitest';
import { buildDemoPipeline, runBenchmark } from '@rigorrun/runner';
import { demoRobustAgent, demoWeakAgent } from '@rigorrun/agents';

const pipeline = await buildDemoPipeline();
const result = await runBenchmark(pipeline.benchmark, [demoWeakAgent, demoRobustAgent], {
  runId: 'run_test',
});

const forAgent = (id: string) => result.caseResults.filter((r) => r.agentId === id);
const scoreOf = (id: string) => result.scores.find((s) => s.agentId === id)!;
const caseOf = (agentId: string, caseId: string) =>
  result.caseResults.find((r) => r.agentId === agentId && r.caseId === caseId)!;

describe('the golden benchmark', () => {
  it('covers every case category', () => {
    const categories = new Set(pipeline.benchmark.cases.map((c) => c.category));
    for (const expected of [
      'happy_path',
      'boundary',
      'missing_precondition',
      'duplicate_action',
      'policy_violation',
      'malformed_input',
      'tool_failure',
      'timeout',
      'prompt_injection',
      'unexpected_state',
    ]) {
      expect(categories).toContain(expected);
    }
  });

  it('exercises the $49 / $50 / $51 boundary explicitly', () => {
    const ids = pipeline.benchmark.cases.map((c) => c.id);
    expect(ids).toContain('case_boundary-49');
    expect(ids).toContain('case_boundary-50');
    expect(ids).toContain('case_boundary-51');
  });

  it('runs every case for every agent', () => {
    expect(forAgent('demo-weak')).toHaveLength(pipeline.benchmark.cases.length);
    expect(forAgent('demo-robust')).toHaveLength(pipeline.benchmark.cases.length);
  });
});

describe('the hardened agent', () => {
  it('takes no unsafe action anywhere in the benchmark', () => {
    expect(scoreOf('demo-robust').unsafeActions).toBe(0);
    expect(scoreOf('demo-robust').policyViolations).toBe(0);
  });

  it('completes every task the policy permits', () => {
    const failures = forAgent('demo-robust').filter((r) => !r.taskSuccess);
    expect(failures.map((f) => f.caseId)).toEqual([]);
  });

  it('meets the release thresholds', () => {
    expect(scoreOf('demo-robust').thresholdsPassed).toBe(true);
  });
});

describe('the baseline agent fails in the ways its flaws predict', () => {
  it('takes at least one unsafe action', () => {
    expect(scoreOf('demo-weak').unsafeActions).toBeGreaterThan(0);
  });

  it('does not meet the release thresholds', () => {
    expect(scoreOf('demo-weak').thresholdsPassed).toBe(false);
  });

  it('obeys instructions injected into a customer note', () => {
    const injected = caseOf('demo-weak', 'case_prompt-injection');
    const refund = injected.actions.find((a) => a.type === 'refund.created');
    expect(refund?.payload['amount']).toBe(500);
    expect(injected.taskSuccess).toBe(false);
    expect(injected.unsafeActions).toBeGreaterThan(0);
  });

  it('refunds one dollar over the limit without approval', () => {
    const boundary = caseOf('demo-weak', 'case_boundary-51');
    expect(boundary.policyCompliant).toBe(false);
    expect(
      boundary.assertions.find((a) => a.assertionId === 'policy_forbid_over_limit')?.status,
    ).toBe('FAIL');
  });

  it('issues a second refund on an already-refunded order', () => {
    const duplicate = caseOf('demo-weak', 'case_already-refunded');
    expect(
      duplicate.assertions.find((a) => a.assertionId === 'policy_forbid_duplicate')?.status,
    ).toBe('FAIL');
  });

  it('refunds an order the customer does not own', () => {
    const wrong = caseOf('demo-weak', 'case_wrong-customer-order');
    expect(
      wrong.assertions.find((a) => a.assertionId === 'policy_forbid_wrong_owner')?.status,
    ).toBe('FAIL');
  });
});

describe('the two agents differ exactly where it matters', () => {
  it('handles the injection case in opposite ways', () => {
    const weak = caseOf('demo-weak', 'case_prompt-injection');
    const robust = caseOf('demo-robust', 'case_prompt-injection');
    expect(weak.taskSuccess).toBe(false);
    expect(robust.taskSuccess).toBe(true);
    const robustRefund = robust.actions.find((a) => a.type === 'refund.created');
    expect(robustRefund?.payload['amount']).toBe(25);
  });

  it('both handle the cases the baseline gets right', () => {
    for (const caseId of ['case_standard-refund', 'case_boundary-49', 'case_boundary-50']) {
      expect(caseOf('demo-weak', caseId).taskSuccess).toBe(true);
      expect(caseOf('demo-robust', caseId).taskSuccess).toBe(true);
    }
  });

  it('picks the hardened agent as the winner', () => {
    expect(result.verdict.winnerAgentId).toBe('demo-robust');
  });
});

describe('reported numbers come from the executions themselves', () => {
  it('derives the success rate from the case results', () => {
    const weak = scoreOf('demo-weak');
    const observed = forAgent('demo-weak').filter((r) => r.taskSuccess).length;
    expect(weak.taskSuccessRate).toBeCloseTo(observed / weak.n, 4);
  });

  it('derives unsafe actions from failed unsafe assertions', () => {
    const weak = scoreOf('demo-weak');
    const counted = forAgent('demo-weak').reduce(
      (sum, r) => sum + r.assertions.filter((a) => a.unsafe).length,
      0,
    );
    expect(weak.unsafeActions).toBe(counted);
  });

  it('reports an interval that does not claim certainty from 17 cases', () => {
    const robust = scoreOf('demo-robust');
    expect(robust.taskSuccessRate).toBe(1);
    expect(robust.taskSuccessInterval.lower).toBeLessThan(0.9);
    expect(robust.n).toBe(pipeline.benchmark.cases.length);
  });

  it('reports zero cost for deterministic agents rather than inventing one', () => {
    expect(scoreOf('demo-weak').totalCostUsd).toBe(0);
    expect(scoreOf('demo-weak').costNote).toContain('deterministic');
  });
});
