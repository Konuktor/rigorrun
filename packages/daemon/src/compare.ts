/**
 * What changed between two runs.
 *
 * The single most valuable thing this product can say, and the answer to "why
 * would anyone open this again tomorrow". A score that moved from 91% to 88% is
 * a fact nobody can act on. "These two cases used to pass and now do not, and
 * here is the tool call that differs" is a bug report.
 *
 * Comparison is by case id, which is why case ids are derived from the fixture
 * and the mutation rather than from an index: a suite that grew by one case in
 * the middle must not report every case after it as changed.
 */
import type { CaseResult, RunResult } from '@rigorrun/core';

export type CaseMovement = 'improved' | 'regressed' | 'unchanged' | 'added' | 'removed';

export interface CaseComparison {
  caseId: string;
  caseName: string;
  movement: CaseMovement;
  /** What specifically moved, in words. Empty when nothing did. */
  detail: string;
  before?: { taskSuccess: boolean; policyCompliant: boolean; unsafeActions: number };
  after?: { taskSuccess: boolean; policyCompliant: boolean; unsafeActions: number };
}

export interface RunComparison {
  baselineRunId: string;
  currentRunId: string;
  improved: CaseComparison[];
  regressed: CaseComparison[];
  unchanged: CaseComparison[];
  added: CaseComparison[];
  removed: CaseComparison[];
  /** One line a person can read without opening anything. */
  headline: string;
  /**
   * Whether the two runs are actually comparable.
   *
   * A different benchmark means a different question was asked, and the honest
   * answer to "did this get worse" is then "that cannot be known from these
   * two", not a diff computed anyway.
   */
  comparable: boolean;
  incomparableReason: string;
}

function outcome(result: CaseResult) {
  return {
    taskSuccess: result.taskSuccess,
    policyCompliant: result.policyCompliant,
    unsafeActions: result.unsafeActions,
  };
}

/** Worse in any dimension is a regression, even if another improved. */
function movementOf(before: CaseResult, after: CaseResult): { movement: CaseMovement; detail: string } {
  const worse: string[] = [];
  const better: string[] = [];

  if (before.taskSuccess && !after.taskSuccess) worse.push('the job is no longer done');
  if (!before.taskSuccess && after.taskSuccess) better.push('the job is now done');
  if (before.policyCompliant && !after.policyCompliant) worse.push('a policy is now broken');
  if (!before.policyCompliant && after.policyCompliant) better.push('the policy is now kept');
  if (after.unsafeActions > before.unsafeActions) {
    worse.push(`unsafe actions rose from ${before.unsafeActions} to ${after.unsafeActions}`);
  }
  if (after.unsafeActions < before.unsafeActions) {
    better.push(`unsafe actions fell from ${before.unsafeActions} to ${after.unsafeActions}`);
  }

  // Deliberately asymmetric. A change that broke a policy and fixed a task is a
  // regression, because the policy is the half somebody gets fired over.
  if (worse.length > 0) return { movement: 'regressed', detail: worse.join('; ') };
  if (better.length > 0) return { movement: 'improved', detail: better.join('; ') };
  return { movement: 'unchanged', detail: '' };
}

export function compareRuns(baseline: RunResult, current: RunResult): RunComparison {
  const comparable = baseline.benchmarkHash === current.benchmarkHash;
  const incomparableReason = comparable
    ? ''
    : 'These runs used different benchmarks, so a difference between them is not ' +
      'necessarily a difference in the agent. Re-run the baseline against the current suite.';

  const byId = new Map<string, CaseResult>();
  for (const result of baseline.caseResults) byId.set(result.caseId, result);

  const improved: CaseComparison[] = [];
  const regressed: CaseComparison[] = [];
  const unchanged: CaseComparison[] = [];
  const added: CaseComparison[] = [];
  const removed: CaseComparison[] = [];

  const seen = new Set<string>();
  for (const after of current.caseResults) {
    seen.add(after.caseId);
    const before = byId.get(after.caseId);
    if (!before) {
      added.push({
        caseId: after.caseId,
        caseName: after.caseName,
        movement: 'added',
        detail: 'this case did not exist in the baseline',
        after: outcome(after),
      });
      continue;
    }
    const { movement, detail } = movementOf(before, after);
    const entry: CaseComparison = {
      caseId: after.caseId,
      caseName: after.caseName,
      movement,
      detail,
      before: outcome(before),
      after: outcome(after),
    };
    if (movement === 'regressed') regressed.push(entry);
    else if (movement === 'improved') improved.push(entry);
    else unchanged.push(entry);
  }

  for (const before of baseline.caseResults) {
    if (seen.has(before.caseId)) continue;
    removed.push({
      caseId: before.caseId,
      caseName: before.caseName,
      movement: 'removed',
      detail: 'this case is no longer in the suite',
      before: outcome(before),
    });
  }

  return {
    baselineRunId: baseline.runId,
    currentRunId: current.runId,
    improved,
    regressed,
    unchanged,
    added,
    removed,
    headline: headlineFor({ comparable, regressed, improved, unchanged }),
    comparable,
    incomparableReason,
  };
}

function headlineFor(input: {
  comparable: boolean;
  regressed: CaseComparison[];
  improved: CaseComparison[];
  unchanged: CaseComparison[];
}): string {
  if (!input.comparable) return 'These two runs are not comparable.';
  if (input.regressed.length > 0) {
    const [first] = input.regressed;
    return input.regressed.length === 1
      ? `1 case regressed: ${first!.caseName} — ${first!.detail}.`
      : `${input.regressed.length} cases regressed, starting with ${first!.caseName}.`;
  }
  if (input.improved.length > 0) {
    return `${input.improved.length} case(s) improved, none regressed.`;
  }
  return `Nothing changed across ${input.unchanged.length} case(s).`;
}
