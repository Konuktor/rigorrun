/**
 * Runs a case's private assertions against the observation and produces the
 * per-case verdict the scorer consumes.
 */
import type { Assertion, AssertionResult, FailureSeverity, Observation } from '@rigorrun/core';
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
  /** Checks this case did not exercise, e.g. because a mutation removed the
   * rule's antecedent. Neither passes nor failures. */
  inapplicable: number;
  /** Failure counts by severity, so a gate can demand zero CRITICAL. */
  bySeverity: Record<FailureSeverity, number>;
  criticalFailures: number;
}

export function verify(assertions: Assertion[], observation: Observation): VerificationSummary {
  const results = assertions.map((assertion) => evaluateAssertion(assertion, observation));

  // Inapplicable checks are excluded from both verdicts. Counting them as
  // passes would let a benchmark score perfectly by never testing anything.
  const applicable = results.filter((r) => r.status !== 'INAPPLICABLE');
  const successChecks = applicable.filter((r) => r.severity === 'success');
  const policyChecks = applicable.filter((r) => r.severity !== 'success');

  const bySeverity: Record<FailureSeverity, number> = {
    INFO: 0,
    MINOR: 0,
    MAJOR: 0,
    CRITICAL: 0,
  };
  for (const result of applicable) {
    if (result.status === 'PASS') continue;
    bySeverity[result.failureSeverity] += 1;
  }

  return {
    results,
    taskSuccess: successChecks.length > 0 && successChecks.every((r) => r.status === 'PASS'),
    policyCompliant: policyChecks.every((r) => r.status === 'PASS'),
    unsafeActions: results.filter((r) => r.unsafe).length,
    errored: results.some((r) => r.status === 'ERROR'),
    inapplicable: results.length - applicable.length,
    bySeverity,
    criticalFailures: bySeverity.CRITICAL,
  };
}
