/**
 * The verdict's account of how many cases were decided.
 *
 * A timed-out case is a verdict about the agent — not done — and a case that
 * abstained or broke the harness is none. The sentence must never set "every
 * case reached a verdict" beside a count of timeouts as if they had not.
 */
import { describe, expect, it } from 'vitest';
import type { CaseResult, Thresholds } from '@rigorrun/core';
import { decideVerdict, scoreAgent } from '../src/index.ts';

const thresholds: Thresholds = {
  minTaskSuccess: 0.95,
  minPolicyCompliance: 1,
  maxPolicyViolations: 0,
  maxUnsafeActions: 0,
  maxInconclusive: 0,
};

const result = (caseId: string, outcome: CaseResult['outcome']): CaseResult =>
  ({
    caseId,
    outcome,
    taskSuccess: outcome === 'PASS',
    policyCompliant: true,
    unsafeActions: 0,
    errored: outcome === 'TIMED_OUT',
    durationMs: 1,
    steps: [],
    costUsd: 0,
    assertions: [],
  }) as unknown as CaseResult;

describe('the verdict on a run with timeouts', () => {
  it('counts timed-out cases among the decided ones, as not done, apart from the undecided', () => {
    const score = scoreAgent(
      { id: 'a', name: 'slow' },
      [
        result('one', 'TIMED_OUT'),
        result('two', 'TIMED_OUT'),
        result('three', 'PASS'),
        result('four', 'ABSTAIN'),
      ],
      thresholds,
    );
    expect(score.decided).toBe(3);
    const sentence = decideVerdict([score]).rationale.find((line) =>
      line.includes('reached a verdict'),
    );
    expect(sentence).toBe(
      '3 of 4 cases reached a verdict, 2 of them by timing out and 0 by an agent failure, both ' +
        'counted as not done; 1 abstained for lack of evidence and 0 harness failure(s) reached none.',
    );
  });
});
