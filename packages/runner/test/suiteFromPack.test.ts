/**
 * A pack's suite is not an unassessed suite.
 *
 * The suite check measures suites induced from a demonstration, and it is
 * refused for a pack's suite, which is written and qualified with the pack.
 * Before this, every pack run carried the unassessed-suite limit, whose remedy
 * was to run that check: advice somebody could only follow into a refusal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SuiteQuality } from '@rigorrun/core';
import { clearEnvironments } from '@rigorrun/environment';
import { runBenchmark } from '../src/index.ts';
import { adder, fakeBenchmark, fakeSession, registerFakePack } from './fakePack.ts';

afterEach(() => clearEnvironments());

const unassessed: SuiteQuality = {
  assessed: false,
  mutantKillRate: null,
  independentKillRate: null,
  falsePositiveRate: null,
  replayStable: null,
  hiddenAnswerIsolated: null,
  deadRules: 0,
  warnings: [],
};

describe('the limit a suite carries', () => {
  it('says a pack’s suite was qualified with the pack, and sends nobody to the suite check', async () => {
    registerFakePack(fakeSession());
    const result = await runBenchmark(fakeBenchmark(), [adder('correct', 5)], {
      suiteQuality: unassessed,
      suiteFromPack: 'The fake pack',
    });
    const ids = result.limits.map((limit) => limit.id);
    expect(ids).toContain('suite_from_pack');
    expect(ids).not.toContain('suite_quality_unassessed');
    const limit = result.limits.find((entry) => entry.id === 'suite_from_pack')!;
    expect(limit.limit).toContain('written and qualified with the The fake pack pack');
    expect(limit.limit).toContain('not induced from a demonstration');
    expect(limit.remedy).toMatch(/pre-registered qualification/);
    expect(limit.remedy).not.toMatch(/run the suite check/i);
  });

  it('still calls a suite nobody checked unassessed when it is not a pack’s', async () => {
    registerFakePack(fakeSession());
    const result = await runBenchmark(fakeBenchmark(), [adder('correct', 5)], {
      suiteQuality: unassessed,
    });
    const ids = result.limits.map((limit) => limit.id);
    expect(ids).toContain('suite_quality_unassessed');
    expect(ids).not.toContain('suite_from_pack');
  });

  it('adds nothing about the pack once a suite has been assessed', async () => {
    registerFakePack(fakeSession());
    const result = await runBenchmark(fakeBenchmark(), [adder('correct', 5)], {
      suiteQuality: { ...unassessed, assessed: true },
      suiteFromPack: 'The fake pack',
    });
    const ids = result.limits.map((limit) => limit.id);
    expect(ids).not.toContain('suite_from_pack');
    expect(ids).not.toContain('suite_quality_unassessed');
  });
});
