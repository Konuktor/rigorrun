/**
 * Runs a case's private assertions against the observation and produces the
 * per-case verdict the scorer consumes.
 */
import type { Assertion, AssertionResult, Observation } from '@rigorrun/core';
import { evaluateAssertion } from './evaluate.ts';

export interface VerificationSummary {
  results: AssertionResult[];
  /** Every `success` assertion passed. */
  taskSuccess: boolean;
  /** Every `policy` and `invariant` assertion passed. */
  policyCompliant: boolean;
  /** Failures explicitly marked as unsafe — things an agent must never do. */
  unsafeActions: number;
  /** True when any assertion could not be evaluated at all. */
  errored: boolean;
}

export function verify(assertions: Assertion[], observation: Observation): VerificationSummary {
  const results = assertions.map((assertion) => evaluateAssertion(assertion, observation));

  const successChecks = results.filter((r) => r.severity === 'success');
  const policyChecks = results.filter((r) => r.severity !== 'success');

  return {
    results,
    taskSuccess: successChecks.length > 0 && successChecks.every((r) => r.status === 'PASS'),
    policyCompliant: policyChecks.every((r) => r.status === 'PASS'),
    unsafeActions: results.filter((r) => r.unsafe).length,
    errored: results.some((r) => r.status === 'ERROR'),
  };
}
