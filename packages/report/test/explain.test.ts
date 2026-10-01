/**
 * A case explained in the result's own words.
 *
 * The explanation is the first thing a founder reads, so it must never say more
 * than the checks did: the claim is the agent's report verbatim, what RigorRun
 * saw is each failed check's own description and message, unsafe first, and a
 * check that was not made is named as not made.
 */
import { describe, expect, it } from 'vitest';
import type { AssertionResult, CaseResult } from '@rigorrun/core';
import { explainCase, timeoutAdvice } from '../src/explain.ts';

const check = (over: Partial<AssertionResult>): AssertionResult =>
  ({
    assertionId: 'a',
    kind: 'state_equals',
    description: 'a check',
    status: 'PASS',
    severity: 'success',
    evaluator: 'deterministic',
    unsafe: false,
    observed: null,
    verificationSource: 'STATE',
    failureSeverity: 'MAJOR',
    blocking: true,
    message: '',
    ...over,
  }) as AssertionResult;

const result = (assertions: AssertionResult[], over: Partial<CaseResult> = {}): CaseResult =>
  ({
    caseId: 'case_1',
    caseName: 'the job as demonstrated',
    category: 'happy_path',
    agentReport: 'Refunded the full amount.',
    assertions,
    taskSuccess: false,
    policyCompliant: false,
    unsafeActions: 0,
    errored: false,
    outcome: 'FAIL',
    evidenceIndependence: 'INDEPENDENT',
    verification: 'PARTIAL',
    missingEvidence: [],
    ...over,
  }) as unknown as CaseResult;

describe('explaining a case', () => {
  it('puts the agent’s words beside the failed checks’ own words, unsafe first', () => {
    const explained = explainCase(
      result([
        check({
          status: 'FAIL',
          description: 'the amount matches the request',
          message: 'expected 2500; observed 25',
        }),
        check({
          status: 'FAIL',
          unsafe: true,
          description: 'at most one per charge',
          message: '2 found',
        }),
        check({ status: 'PASS', description: 'passed, so not mentioned' }),
      ]),
    );
    expect(explained.claim).toBe('Refunded the full amount.');
    expect(explained.saw).toEqual([
      'UNSAFE: at most one per charge — 2 found',
      'the amount matches the request — expected 2500; observed 25',
    ]);
    expect(explained.outcome).toBe('FAIL');
    expect(explained.evidence).toBe('INDEPENDENT · PARTIAL');
  });

  it('names the checks that were not made, and says a black box saw state only', () => {
    const explained = explainCase(
      result(
        [
          check({
            status: 'UNVERIFIABLE',
            blocking: false,
            description: '"a" must happen before "b"',
            message: 'not checked: black-box: RigorRun did not see the agent’s calls',
          }),
        ],
        { outcome: 'PASS', observation: 'state-only' },
      ),
    );
    expect(explained.saw).toEqual([]);
    expect(explained.notChecked[0]).toMatch(/must happen before .* did not see the agent/);
    expect(explained.evidence).toContain('state only');
  });

  it('says so when the agent said nothing', () => {
    expect(explainCase(result([], { agentReport: '  ' })).claim).toBe('(the agent said nothing)');
  });

  it('never puts RigorRun’s own timeout in the agent’s mouth', () => {
    const explained = explainCase(
      result([], {
        outcome: 'TIMED_OUT',
        errored: true,
        budgetMs: 60_000,
        agentReport: 'Agent execution failed: Agent exceeded its 60000ms budget',
      }),
    );
    expect(explained.outcome).toBe('TIMED_OUT');
    expect(explained.claim).toBe('(no answer within the 60 s case budget)');
  });
});

describe('advice on a case that ran out of time', () => {
  it('says the budget, how to raise it, and that slow models need minutes — not that the agent is wrong', () => {
    const advice = timeoutAdvice(60_000, 'ticket');
    expect(advice).toBe(
      'The agent did not answer within the case budget (60 s). If it is still working, raise ' +
        'the budget: --case-timeout <ms>, e.g. --case-timeout 600000. Slow models can need ' +
        'several minutes per ticket.',
    );
    expect(timeoutAdvice(60_000)).toMatch(/several minutes per case\.$/);
    expect(advice.toLowerCase()).not.toContain('fix the agent');
  });

  it('suggests at least ten minutes, and double a budget already above five', () => {
    expect(timeoutAdvice(300_000)).toContain('--case-timeout 600000');
    expect(timeoutAdvice(900_000)).toContain('--case-timeout 1800000');
    expect(timeoutAdvice(90_500)).toContain('(91 s)');
  });
});
