/**
 * Comparing two runs.
 *
 * The judgements being locked down here are the ones somebody could reasonably
 * disagree with, which is exactly why they belong in tests rather than in a
 * comment: a mixed result counts as a regression, and two runs of different
 * suites are not compared at all.
 */
import { describe, expect, it } from 'vitest';
import type { CaseResult, RunResult } from '@rigorrun/core';
import { compareRuns } from '../src/compare.ts';

function caseResult(input: {
  caseId: string;
  taskSuccess: boolean;
  policyCompliant: boolean;
  unsafe?: number;
}): CaseResult {
  return {
    caseId: input.caseId,
    caseName: input.caseId.replace('case_', ''),
    category: 'happy_path',
    agentId: 'a',
    agentName: 'A',
    attempt: 0,
    startedAt: '2026-02-01T09:00:00.000Z',
    durationMs: 1,
    steps: [],
    agentReport: '',
    usage: null,
    costUsd: null,
    costNote: '',
    assertions: [],
    taskSuccess: input.taskSuccess,
    policyCompliant: input.policyCompliant,
    unsafeActions: input.unsafe ?? 0,
    criticalFailures: 0,
    errored: false,
  } as unknown as CaseResult;
}

function run(runId: string, results: CaseResult[], benchmarkHash = 'same'): RunResult {
  return {
    runId,
    benchmarkHash,
    caseResults: results,
  } as unknown as RunResult;
}

describe('a case that got worse', () => {
  it('is reported with what specifically moved', () => {
    const before = run('r1', [caseResult({ caseId: 'c1', taskSuccess: true, policyCompliant: true })]);
    const after = run('r2', [caseResult({ caseId: 'c1', taskSuccess: true, policyCompliant: false })]);

    const comparison = compareRuns(before, after);
    expect(comparison.regressed).toHaveLength(1);
    expect(comparison.regressed[0]?.detail).toBe('a policy is now broken');
    expect(comparison.headline).toMatch(/1 case regressed/);
  });

  it('counts more unsafe actions as worse even when the job still gets done', () => {
    const before = run('r1', [caseResult({ caseId: 'c1', taskSuccess: true, policyCompliant: true, unsafe: 0 })]);
    const after = run('r2', [caseResult({ caseId: 'c1', taskSuccess: true, policyCompliant: true, unsafe: 2 })]);
    expect(compareRuns(before, after).regressed[0]?.detail).toMatch(/unsafe actions rose from 0 to 2/);
  });
});

describe('a mixed result', () => {
  it('counts as a regression, not as a wash', () => {
    // The asymmetry is deliberate. Finishing the job while breaking a policy is
    // not a draw: the policy is the half somebody gets fired over.
    const before = run('r1', [caseResult({ caseId: 'c1', taskSuccess: false, policyCompliant: true })]);
    const after = run('r2', [caseResult({ caseId: 'c1', taskSuccess: true, policyCompliant: false })]);

    const comparison = compareRuns(before, after);
    expect(comparison.regressed).toHaveLength(1);
    expect(comparison.improved).toHaveLength(0);
  });
});

describe('a case that got better', () => {
  it('is reported without being called a regression', () => {
    const before = run('r1', [caseResult({ caseId: 'c1', taskSuccess: false, policyCompliant: false })]);
    const after = run('r2', [caseResult({ caseId: 'c1', taskSuccess: true, policyCompliant: true })]);
    const comparison = compareRuns(before, after);
    expect(comparison.improved).toHaveLength(1);
    expect(comparison.regressed).toHaveLength(0);
    expect(comparison.headline).toMatch(/improved, none regressed/);
  });
});

describe('a suite that changed shape', () => {
  it('reports added and removed cases rather than pretending they moved', () => {
    const before = run('r1', [
      caseResult({ caseId: 'kept', taskSuccess: true, policyCompliant: true }),
      caseResult({ caseId: 'dropped', taskSuccess: true, policyCompliant: true }),
    ]);
    const after = run('r2', [
      caseResult({ caseId: 'kept', taskSuccess: true, policyCompliant: true }),
      caseResult({ caseId: 'brand_new', taskSuccess: false, policyCompliant: true }),
    ]);

    const comparison = compareRuns(before, after);
    expect(comparison.added.map((entry) => entry.caseId)).toEqual(['brand_new']);
    expect(comparison.removed.map((entry) => entry.caseId)).toEqual(['dropped']);
    expect(comparison.unchanged.map((entry) => entry.caseId)).toEqual(['kept']);
    // A case that only just appeared cannot have regressed.
    expect(comparison.regressed).toHaveLength(0);
  });
});

describe('two runs of different suites', () => {
  it('refuses to compare them, and says why', () => {
    const before = run('r1', [caseResult({ caseId: 'c1', taskSuccess: true, policyCompliant: true })], 'hash-a');
    const after = run('r2', [caseResult({ caseId: 'c1', taskSuccess: false, policyCompliant: false })], 'hash-b');

    const comparison = compareRuns(before, after);
    expect(comparison.comparable).toBe(false);
    expect(comparison.headline).toBe('These two runs are not comparable.');
    expect(comparison.incomparableReason).toMatch(/different benchmarks/);
  });
});

describe('nothing happening', () => {
  it('says so plainly rather than showing an empty diff', () => {
    const results = [caseResult({ caseId: 'c1', taskSuccess: true, policyCompliant: true })];
    const comparison = compareRuns(run('r1', results), run('r2', results));
    expect(comparison.headline).toBe('Nothing changed across 1 case(s).');
  });
});
