/**
 * Turning a record into an exit code.
 *
 * The rule inherited from v1 and now load-bearing for a second command: an
 * infrastructure problem must never look like a behavioural finding, and a
 * behavioural finding must never look like an infrastructure problem. CI reads
 * these numbers and cannot ask a follow-up question.
 *
 *   0  verified, nothing blocking
 *   1  a declaration was contradicted
 *   2  configuration or runtime failure — never produced by a verdict
 *   3  verified, but too much of it came back UNDETERMINED
 *
 * Code 3 exists because "we could not tell" is a real outcome that deserves to
 * be distinguishable from both success and failure. A team that would rather
 * treat it as failure sets the threshold to zero; a team exploring an unknown
 * server sets it higher. Neither has to pretend.
 *
 * `untested` is counted separately from `undetermined` on purpose. A tool
 * RigorRun deliberately declined to touch, because the server declared it
 * destructive, is not an inconclusive result — it is a decision, and folding
 * the two together would make every honest run look uncertain.
 */
import type { VerificationRecord } from '@rigorrun/core';

export interface ExitThresholds {
  /** Undetermined verdicts tolerated before exit 3. Default 0. */
  maxUndetermined: number;
  /** Tools that must have been exercised for the run to mean anything. */
  minExercised: number;
  /** Treat MINOR contradictions as blocking too. */
  strict: boolean;
}

export const DEFAULT_THRESHOLDS: ExitThresholds = {
  maxUndetermined: 0,
  minExercised: 1,
  strict: false,
};

export type ExitCode = 0 | 1 | 2 | 3;

const BLOCKING = new Set(['MAJOR', 'CRITICAL']);

/**
 * Precedence is 2 > 1 > 3 > 0, and the order of these checks is the policy.
 *
 * Runtime failure outranks everything: if the container never started, we know
 * nothing, and reporting "no contradictions found" would be true and useless.
 */
export function exitCodeFor(
  record: VerificationRecord,
  thresholds: ExitThresholds = DEFAULT_THRESHOLDS,
): ExitCode {
  const contradicted = record.tools.flatMap((tool) =>
    tool.conformance.filter((c) => c.verdict === 'CONTRADICTED'),
  );

  const blocking = contradicted.filter(
    (c) => BLOCKING.has(c.severity) || (thresholds.strict && c.severity === 'MINOR'),
  );
  if (blocking.length > 0) return 1;

  if (record.summary.toolsExercised < thresholds.minExercised) return 3;
  if (record.summary.undetermined > thresholds.maxUndetermined) return 3;

  return 0;
}

/** One line saying why, so the number never has to be looked up. */
export function exitReason(code: ExitCode, record: VerificationRecord): string {
  switch (code) {
    case 0:
      return `${record.summary.toolsExercised} tool(s) exercised, no declaration contradicted.`;
    case 1: {
      const n = record.tools.flatMap((t) =>
        t.conformance.filter((c) => c.verdict === 'CONTRADICTED'),
      ).length;
      return `${n} declaration(s) contradicted by observed behaviour.`;
    }
    case 3:
      return (
        `${record.summary.undetermined} finding(s) undetermined and ` +
        `${record.summary.toolsExercised} tool(s) exercised. Verification completed but ` +
        'did not establish enough to be worth much.'
      );
    default:
      return 'The verification could not be run.';
  }
}
