/**
 * The suite's quality check travels with the verdict.
 *
 * The audit found RigorRun's own quality gate warning, in every journey, that
 * the suite could not separate a good agent from a bad one — in a file nobody
 * opened, while the run printed a clean-looking verdict. A warning now sits in
 * the verdict's rationale and on the artefact, and a suite nobody checked is a
 * limit of the run.
 */
import { describe, expect, it } from 'vitest';
import type { BenchmarkQuality } from '@rigorrun/quality';
import { suiteQualityOf } from '../src/service.ts';

function quality(overrides: Partial<BenchmarkQuality>): BenchmarkQuality {
  return {
    benchmarkId: 'bm_x',
    cases: 3,
    measures: [
      { id: 'false_positive_rate', label: 'fp', meaning: '', value: 0, kind: 'rate', discriminating: true },
    ],
    mutants: [],
    mutantKillRate: 1,
    independentKillRate: 1,
    replayStable: true,
    hiddenAnswerIsolated: true,
    deadRules: [],
    nonDiscriminatingRules: [],
    wallClockMs: 1,
    ...overrides,
  };
}

describe('suiteQualityOf', () => {
  it('says a suite nobody checked has not been checked', () => {
    const summary = suiteQualityOf(undefined);
    expect(summary.assessed).toBe(false);
    expect(summary.warnings.join(' ')).toMatch(/not been quality-checked/);
  });

  it('carries no warning for a suite that passed its own check', () => {
    expect(suiteQualityOf(quality({})).warnings).toEqual([]);
  });

  it('names every reason a PASS from this suite is worth less than it looks', () => {
    const summary = suiteQualityOf(
      quality({
        // The audit's two sqlite journeys: false positive rate 1, kill rate 0.
        measures: [{ id: 'false_positive_rate', label: 'fp', meaning: '', value: 1, kind: 'rate', discriminating: true }],
        mutantKillRate: 0,
        independentKillRate: 0,
        replayStable: false,
        hiddenAnswerIsolated: false,
        deadRules: ['rule_a', 'rule_b'],
      }),
    );
    expect(summary.assessed).toBe(true);
    expect(summary.falsePositiveRate).toBe(1);
    expect(summary.warnings).toHaveLength(6);
    expect(summary.warnings[0]).toMatch(/reference implementation fails 100%/);
    expect(summary.warnings.join(' ')).toMatch(/caught 0% of deliberately broken agents/);
    expect(summary.warnings.join(' ')).toMatch(/2 confirmed rule\(s\) are never exercised/);
  });
});
