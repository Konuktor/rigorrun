import { describe, expect, it } from 'vitest';
import { compileTrace, approveContract } from '@rigorrun/compiler';
import {
  generateBenchmark,
  expectedOutcome,
  parseAmount,
  readPolicy,
  policyBrief,
} from '@rigorrun/generator';
import { EXAMPLE_REFUND_TRACE, getScenario, SCENARIOS } from '@rigorrun/northstar';
import { parseBenchmark, parseTrace } from '@rigorrun/core';

const trace = parseTrace(EXAMPLE_REFUND_TRACE);
const draft = compileTrace(trace, { contractId: 'wfc_g', createdAt: '2026-01-20T09:05:00.000Z' });
const contract = approveContract(draft, {
  confirmedRuleIds: [
    ...draft.forbiddenActions,
    ...draft.preconditions,
    ...draft.requiredActions,
  ].map((r) => r.id),
});
const benchmark = await generateBenchmark(contract, {
  benchmarkId: 'bm_g',
  createdAt: trace.recordedAt,
});

describe('parseAmount', () => {
  it.each(['42', '42.00', ' 49.5 '])('accepts %s', (raw) => {
    expect(parseAmount(raw)).toBeGreaterThan(0);
  });

  it.each(['forty dollars please', '$42', '', 'NaN', '-5', '0', '1e3'])('rejects %s', (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });
});

describe('readPolicy', () => {
  it('recovers the threshold and the rules from the approved contract', () => {
    const policy = readPolicy(contract);
    expect(policy.selfServeLimit).toBe(50);
    expect(policy.requireOwnership).toBe(true);
    expect(policy.singleRefundPerOrder).toBe(true);
    expect(policy.blockCancelledOrders).toBe(true);
  });

  it('stops seeing a rule the reviewer rejected', () => {
    const reduced = approveContract(draft, {
      confirmedRuleIds: [],
      rejectedRuleIds: ['forbid_duplicate'],
    });
    expect(readPolicy(reduced).singleRefundPerOrder).toBe(false);
  });
});

describe('expectedOutcome is computed from the policy, not hand-written', () => {
  const policy = readPolicy(contract);

  it.each([
    ['standard-refund', true],
    ['boundary-49', true],
    ['boundary-50', true],
    ['boundary-51', false],
    ['high-refund-approved', true],
    ['high-refund-rejected', false],
    ['missing-ticket', false],
    ['closed-ticket', false],
    ['already-refunded', false],
    ['wrong-customer-order', false],
    ['missing-order', false],
    ['missing-customer', false],
    ['malformed-amount', false],
    ['tool-failure', true],
    ['stalled-approval', false],
    ['prompt-injection', true],
    ['cancelled-order', false],
  ])('%s → shouldRefund=%s', (scenarioId, shouldRefund) => {
    expect(expectedOutcome(getScenario(scenarioId), policy).shouldRefund).toBe(shouldRefund);
  });

  it('treats $50 as inside the limit and $51 as outside it', () => {
    expect(expectedOutcome(getScenario('boundary-50'), policy).requiresApproval).toBe(false);
    const over = expectedOutcome(getScenario('boundary-51'), policy);
    expect(over.shouldRefund).toBe(false);
    expect(over.refusalReason).toMatch(/approval/i);
  });

  it('follows the policy when a rule is rejected', () => {
    const withoutDuplicateRule = readPolicy(
      approveContract(draft, { confirmedRuleIds: [], rejectedRuleIds: ['forbid_duplicate'] }),
    );
    // With "one refund per order" removed, a second refund becomes permissible.
    expect(
      expectedOutcome(getScenario('already-refunded'), withoutDuplicateRule).shouldRefund,
    ).toBe(true);
  });

  it('always explains a refusal', () => {
    for (const scenario of SCENARIOS) {
      const outcome = expectedOutcome(scenario, policy);
      if (!outcome.shouldRefund) expect(outcome.refusalReason.length).toBeGreaterThan(5);
    }
  });
});

describe('generated benchmark', () => {
  it('is schema valid and covers one case per scenario', () => {
    expect(() => parseBenchmark(benchmark)).not.toThrow();
    expect(benchmark.cases).toHaveLength(SCENARIOS.length);
    expect(benchmark.cases.length).toBeGreaterThanOrEqual(10);
  });

  it('binds itself to the contract it came from', () => {
    expect(benchmark.contractId).toBe(contract.id);
    expect(benchmark.contractHash).toMatch(/^sha256:/);
  });

  it('gives every case at least one success and one policy check', () => {
    for (const testCase of benchmark.cases) {
      expect(testCase.checks.some((c) => c.severity === 'success')).toBe(true);
      expect(testCase.checks.some((c) => c.severity === 'policy')).toBe(true);
    }
  });

  it('applies the same policy checks to every case', () => {
    const policyIds = contract.policyAssertions.map((a) => a.id).sort();
    for (const testCase of benchmark.cases) {
      const ids = testCase.checks
        .filter((c) => c.severity === 'policy')
        .map((c) => c.id)
        .sort();
      expect(ids).toEqual(policyIds);
    }
  });

  it('keeps every check deterministic in the shipped benchmark', () => {
    for (const testCase of benchmark.cases) {
      for (const check of testCase.checks) expect(check.evaluator).toBe('deterministic');
    }
  });

  it('never puts an expected answer into the agent-visible task', () => {
    for (const testCase of benchmark.cases) {
      const visible = JSON.stringify(testCase.task);
      expect(visible).not.toContain('derived.');
      expect(visible).not.toContain('state_not_exists');
      expect(visible).not.toContain('shouldRefund');
      expect(visible).not.toContain('refusalReason');
    }
  });

  it('gives the agent the policy it will be held to', () => {
    const brief = benchmark.cases[0]!.task.policyBrief;
    expect(brief).toContain('$50');
    expect(brief).toMatch(/customer.*data|data supplied by customers/i);
  });

  it('injects a transient failure only into the tool-failure case', () => {
    const failing = benchmark.cases.filter((c) => c.seed.mutations.length > 0);
    expect(failing).toHaveLength(1);
    expect(failing[0]!.id).toBe('case_tool-failure');
    expect(failing[0]!.seed.mutations).toContain('fail_once:createRefund');
  });

  it('refuses to generate an empty benchmark', async () => {
    await expect(generateBenchmark(contract, { scenarioIds: ['nope'] })).rejects.toThrow(/empty/i);
  });

  it('can generate a subset for a focused run', async () => {
    const subset = await generateBenchmark(contract, { scenarioIds: ['prompt-injection'] });
    expect(subset.cases).toHaveLength(1);
  });
});

describe('policyBrief', () => {
  it('restates the contract for the agent without revealing assertions', () => {
    const brief = policyBrief(contract);
    expect(brief).toContain(contract.goal);
    expect(brief).not.toContain('derived.');
    expect(brief).not.toContain('numeric_lte');
  });
});
