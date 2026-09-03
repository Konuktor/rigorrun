import { describe, expect, it } from 'vitest';
import { approveContract, compileTrace } from '@rigorrun/compiler';
import { EXAMPLE_REFUND_TRACE } from '@rigorrun/northstar';
import {
  inferredRules,
  observedRules,
  parseContract,
  parseTrace,
  rulesNeedingConfirmation,
} from '@rigorrun/core';

const trace = parseTrace(EXAMPLE_REFUND_TRACE);
const contract = compileTrace(trace, {
  contractId: 'wfc_test',
  createdAt: '2026-01-20T09:05:00.000Z',
});

describe('compiling a human trace into a contract', () => {
  it('produces a schema-valid contract', () => {
    expect(() => parseContract(contract)).not.toThrow();
  });

  it('derives the goal from what the human actually completed', () => {
    expect(contract.goal).toMatch(/refund/i);
  });

  it('records the observed facts with their evidence', () => {
    const amount = contract.observedFacts.find((f) => f.key === 'refund.amount');
    expect(amount?.value).toBe(42);
    expect(amount?.evidence.length).toBeGreaterThan(0);
    expect(trace.events.some((e) => e.id === amount?.evidence[0])).toBe(true);
  });

  it('links the trace it was compiled from', () => {
    expect(contract.sourceTraceId).toBe(trace.id);
  });
});

describe('observed versus inferred', () => {
  it('marks what the human demonstrably did as observed with full confidence', () => {
    const observed = observedRules(contract);
    expect(observed.length).toBeGreaterThan(0);
    for (const rule of observed) {
      expect(rule.confidence).toBe(1);
      expect(rule.needsConfirmation).toBe(false);
    }
    expect(observed.map((r) => r.rule)).toContain('an open support ticket exists for the order');
  });

  it('marks every generalisation as inferred and unconfirmed', () => {
    const inferred = inferredRules(contract);
    expect(inferred.length).toBeGreaterThan(0);
    for (const rule of inferred) {
      expect(rule.confidence).toBeLessThan(1);
      expect(rule.needsConfirmation).toBe(true);
    }
  });

  it('never claims a policy threshold as observed fact', () => {
    const limitRule = contract.forbiddenActions.find((r) => r.id === 'forbid_over_limit');
    expect(limitRule).toBeDefined();
    expect(limitRule?.source).toBe('inferred');
    expect(limitRule?.confidence).toBeLessThan(0.8);
  });

  it('reads the stated limit out of text the recorder captured, and cites it', () => {
    const limitRule = contract.forbiddenActions.find((r) => r.id === 'forbid_over_limit')!;
    expect(limitRule.rule).toContain('$50');
    const sourceEvent = trace.events.find((e) => e.id === limitRule.evidence[0]);
    expect(sourceEvent?.target?.nearbyText).toContain('$50');
  });

  it('asks a question for every inference it made', () => {
    for (const rule of inferredRules(contract)) {
      const question = contract.uncertainty.find((u) => u.relatedRuleIds.includes(rule.id));
      expect(question, `no uncertainty entry for ${rule.id}`).toBeDefined();
      expect(question?.reason.length).toBeGreaterThan(10);
    }
  });

  it('reports everything still needing confirmation', () => {
    expect(rulesNeedingConfirmation(contract).length).toBe(inferredRules(contract).length);
  });
});

describe('policy assertions', () => {
  it('emits a deterministic, unsafe-flagged assertion per forbidden action', () => {
    expect(contract.policyAssertions.length).toBe(contract.forbiddenActions.length);
    for (const assertion of contract.policyAssertions) {
      expect(assertion.evaluator).toBe('deterministic');
      expect(assertion.severity).toBe('policy');
      expect(assertion.unsafeIfFailed).toBe(true);
    }
  });

  it('links each forbidden rule to the assertion that checks it', () => {
    const ids = new Set(contract.policyAssertions.map((a) => a.id));
    for (const rule of contract.forbiddenActions) {
      expect(ids.has(rule.check!)).toBe(true);
    }
  });
});

describe('human approval', () => {
  it('promotes confirmed rules to user_confirmed with full confidence', () => {
    const approved = approveContract(
      contract,
      { confirmedRuleIds: ['forbid_over_limit'] },
      '2026-01-20T10:00:00.000Z',
    );
    const rule = approved.forbiddenActions.find((r) => r.id === 'forbid_over_limit')!;
    expect(rule.source).toBe('user_confirmed');
    expect(rule.confidence).toBe(1);
    expect(rule.needsConfirmation).toBe(false);
    expect(approved.approvedAt).toBe('2026-01-20T10:00:00.000Z');
  });

  it('drops a rejected rule and the assertion that enforced it', () => {
    const approved = approveContract(contract, {
      confirmedRuleIds: [],
      rejectedRuleIds: ['forbid_duplicate'],
    });
    expect(approved.forbiddenActions.find((r) => r.id === 'forbid_duplicate')).toBeUndefined();
    expect(
      approved.policyAssertions.find((a) => a.id === 'policy_forbid_duplicate'),
    ).toBeUndefined();
  });

  it('records the human’s answers to the open questions', () => {
    const approved = approveContract(contract, {
      confirmedRuleIds: ['forbid_over_limit'],
      answers: { unc_forbid_over_limit: 'Yes, $50 is correct.' },
    });
    expect(approved.uncertainty.find((u) => u.id === 'unc_forbid_over_limit')?.answer).toBe(
      'Yes, $50 is correct.',
    );
  });

  it('leaves untouched rules alone', () => {
    const approved = approveContract(contract, { confirmedRuleIds: ['forbid_over_limit'] });
    expect(approved.forbiddenActions.find((r) => r.id === 'forbid_wrong_owner')?.source).toBe(
      'inferred',
    );
  });
});

describe('a trace with no semantic observations still compiles', () => {
  it('degrades to what the DOM events show, without inventing facts', () => {
    const domOnly = {
      ...trace,
      events: trace.events.filter((e) => e.type !== 'app_observation'),
    };
    const result = compileTrace(domOnly, { contractId: 'wfc_dom', createdAt: trace.recordedAt });
    expect(result.observedFacts.some((f) => f.key === 'refund.amount')).toBe(false);
    expect(result.preconditions.filter((r) => r.source === 'observed')).toHaveLength(0);
    // The limit is still readable from the captured banner text.
    expect(result.forbiddenActions.some((r) => r.id === 'forbid_over_limit')).toBe(true);
  });
});
