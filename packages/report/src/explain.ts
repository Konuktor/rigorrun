/**
 * One case, in the sentences a person reads first: what the agent said, what
 * the system itself shows, what RigorRun saw, and what it could not check.
 *
 * Every word comes from the result itself — the agent's own report, the
 * system's own account of how the case ended, the description and message of
 * each check that failed, and the reason a check was not made. Nothing is
 * inferred, summarised by a model or reworded into a domain: a report that
 * explained a failure in words the checks never used would be a second verdict
 * nobody measured.
 */
import { caseOutcome, type AssertionResult, type CaseResult } from '@rigorrun/core';

export interface CaseExplanation {
  /** PASS, FAIL, ABSTAIN, … — the case's own outcome. */
  outcome: string;
  /** The agent's account of what it did, verbatim; never scored. */
  claim: string;
  /**
   * The system's own account of how the case ended, verbatim, for setting
   * beside the claim: whose account (`system`) and its sentences. Absent when
   * the system gave none. Never scored; the checks judged the same state.
   */
  reality?: { system: string; lines: string[] };
  /** What the reads behind this verdict covered, when that was less than everything. */
  readScope?: string;
  /** The checks that failed, each as "what should hold — what was seen". */
  saw: string[];
  /** Checks that could not be made, and why, so a PASS is never read as more than it is. */
  notChecked: string[];
  /** How the verdict was read: INDEPENDENT, SELF_REPORTED, … and state-only for a black box. */
  evidence: string;
}

const MAX_LINES = 4;

export function explainCase(result: CaseResult): CaseExplanation {
  const failed = result.assertions.filter((a) => a.status === 'FAIL' || a.status === 'ERROR');
  const unverifiable = result.assertions.filter((a) => a.status === 'UNVERIFIABLE');
  const evidence = [
    result.evidenceIndependence ?? '',
    result.verification ?? '',
    result.observation === 'state-only' ? 'state only' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    outcome: caseOutcome(result),
    claim: result.agentReport.trim() || '(the agent said nothing)',
    ...(result.reality
      ? { reality: { system: result.reality.system, lines: [...result.reality.lines] } }
      : {}),
    ...(result.readScope ? { readScope: result.readScope } : {}),
    // Unsafe first: they are what a reader has to see before anything else.
    saw: [...failed.filter((a) => a.unsafe), ...failed.filter((a) => !a.unsafe)]
      .slice(0, MAX_LINES)
      .map(sentence),
    notChecked: dedupe(
      unverifiable.map((a) => `${a.description} — ${a.message ?? 'not checked'}`),
    ).slice(0, MAX_LINES),
    evidence,
  };
}

function sentence(assertion: AssertionResult): string {
  const seen = assertion.message ? ` — ${assertion.message}` : '';
  return `${assertion.unsafe ? 'UNSAFE: ' : ''}${assertion.description}${seen}`;
}

function dedupe(lines: string[]): string[] {
  return [...new Set(lines)];
}
