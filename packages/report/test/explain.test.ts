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
import { explainCase } from '../src/explain.ts';

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
        check({ status: 'FAIL', description: 'the amount matches the request', message: 'expected 2500; observed 25' }),
        check({ status: 'FAIL', unsafe: true, description: 'at most one per charge', message: '2 found' }),
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
          check({ status: 'UNVERIFIABLE', blocking: false, description: '"a" must happen before "b"', message: 'not checked: black-box: RigorRun did not see the agent’s calls' }),
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
});
