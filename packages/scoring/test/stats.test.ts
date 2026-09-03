import { describe, expect, it } from 'vitest';
import { mean, median, passAtK, percentile, wilsonInterval } from '@rigorrun/scoring';

describe('wilsonInterval', () => {
  // Reference values for the 95% Wilson score interval.
  it('matches the published interval for 5/10', () => {
    const ci = wilsonInterval(5, 10);
    expect(ci.point).toBe(0.5);
    expect(ci.lower).toBeCloseTo(0.2366, 3);
    expect(ci.upper).toBeCloseTo(0.7634, 3);
  });

  it('matches the published interval for 0/10 and never goes below zero', () => {
    const ci = wilsonInterval(0, 10);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBeCloseTo(0.2775, 3);
  });

  it('does not claim certainty from a perfect small sample', () => {
    const ci = wilsonInterval(17, 17);
    expect(ci.point).toBe(1);
    expect(ci.upper).toBe(1);
    // 17/17 supports "at least ~81%", not "100% reliable".
    expect(ci.lower).toBeCloseTo(0.8157, 3);
    expect(ci.lower).toBeLessThan(0.85);
  });

  it('narrows as n grows', () => {
    const small = wilsonInterval(9, 10);
    const large = wilsonInterval(900, 1000);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it('handles an empty sample without pretending to know anything', () => {
    expect(wilsonInterval(0, 0)).toEqual({ point: 0, lower: 0, upper: 1, n: 0 });
  });
});

describe('percentile / median / mean', () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it('uses nearest-rank for percentiles', () => {
    expect(percentile(values, 0.95)).toBe(100);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0)).toBe(10);
  });

  it('averages the two middle values for an even-length sample', () => {
    expect(median(values)).toBe(55);
    expect(median([1, 2, 3])).toBe(2);
  });

  it('returns zero for empty inputs rather than NaN', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(median([])).toBe(0);
    expect(mean([])).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = [3, 1, 2];
    percentile(input, 0.5);
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('passAtK', () => {
  it('is the success rate when k = 1', () => {
    expect(passAtK([{ total: 4, successes: 2 }], 1)).toBe(0.5);
  });

  it('rises with k when at least one attempt succeeded', () => {
    const at1 = passAtK([{ total: 4, successes: 1 }], 1)!;
    const at2 = passAtK([{ total: 4, successes: 1 }], 2)!;
    expect(at2).toBeGreaterThan(at1);
    expect(at2).toBeCloseTo(0.5, 5);
  });

  it('is 1 when every attempt succeeded and 0 when none did', () => {
    expect(passAtK([{ total: 3, successes: 3 }], 2)).toBe(1);
    expect(passAtK([{ total: 3, successes: 0 }], 2)).toBe(0);
  });

  it('returns null rather than guessing when there are too few attempts', () => {
    expect(passAtK([{ total: 1, successes: 1 }], 2)).toBeNull();
    expect(passAtK([], 1)).toBeNull();
  });

  it('averages across cases', () => {
    expect(
      passAtK(
        [
          { total: 2, successes: 2 },
          { total: 2, successes: 0 },
        ],
        1,
      ),
    ).toBe(0.5);
  });
});
