/**
 * Statistics that refuse to overstate what a small sample can support.
 *
 * A benchmark of a few dozen cases is a small sample. Reporting "100% success" without
 * an interval invites exactly the false confidence this product exists to
 * prevent, so every proportion is reported with a Wilson score interval and an
 * explicit `n`.
 */
import type { WilsonInterval } from '@rigorrun/core';

/** 95% by default (z = 1.96). */
export function wilsonInterval(successes: number, n: number, z = 1.96): WilsonInterval {
  if (n <= 0) return { point: 0, lower: 0, upper: 1, n: 0 };

  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

  return {
    point: round4(p),
    lower: round4(Math.max(0, centre - margin)),
    upper: round4(Math.min(1, centre + margin)),
    n,
  };
}

/** Nearest-rank percentile. `p` is a fraction, e.g. 0.95. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index]!;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Unbiased pass@k over cases that were attempted multiple times.
 *
 * For a case with `n` attempts of which `c` succeeded, the chance that a random
 * sample of k attempts contains no success is C(n-c, k)/C(n, k); pass@k is one
 * minus that. Cases with fewer than k attempts are skipped rather than guessed
 * at, and `null` is returned when nothing supports the estimate.
 */
export function passAtK(
  attempts: { total: number; successes: number }[],
  k: number,
): number | null {
  const usable = attempts.filter((a) => a.total >= k);
  if (usable.length === 0) return null;

  const perCase = usable.map(({ total, successes }) => {
    const failures = total - successes;
    if (failures < k) return 1;
    return 1 - combination(failures, k) / combination(total, k);
  });
  return round4(mean(perCase));
}

function combination(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
