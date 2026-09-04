/**
 * Layer C — performance budgets against the deployed site.
 *
 * The budgets below are set to the "good" thresholds Google publishes for Core
 * Web Vitals, not to whatever the site currently happens to score. If a future
 * change makes the landing page slow, this fails; it is a budget, not a
 * recording of today's number.
 *
 * Every metric is measured three times from a cold context and the median is
 * asserted, because a single sample over a real network is noise. The raw
 * samples are attached to the report so a failure can be diagnosed without
 * re-running.
 */
import { expect, test, type Browser, type TestInfo } from '@playwright/test';
import {
  goToBenchmark,
  goToContract,
  openDemo,
  runBenchmarkAndWait,
} from './support/journeys';

/** Google's "good" thresholds, plus two budgets specific to this product. */
const BUDGET = {
  lcp: 2500,
  fcp: 1800,
  ttfb: 800,
  cls: 0.1,
  /** Bytes over the wire for the landing page. It is one route of a SPA. */
  transfer: 600_000,
  /** Executing the whole benchmark in the browser, from click to verdict. */
  runToVerdict: 8000,
} as const;

const SAMPLES = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted[middle] ?? Number.NaN;
}

interface Vitals {
  lcp: number;
  fcp: number;
  ttfb: number;
  cls: number;
  transfer: number;
}

/**
 * One cold measurement. A fresh context each time so no HTTP cache, service
 * worker or memory cache carries over from the previous sample.
 */
async function measure(browser: Browser, path: string): Promise<Vitals> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(path, { waitUntil: 'load' });
    // Give LCP and CLS a settled window to report into. This is not a wait for
    // an assertion to become true — it is the observation window itself.
    return await page.evaluate(async () => {
      let lcp = 0;
      let cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) lcp = Math.max(lcp, entry.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) cls += shift.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const paint = performance.getEntriesByName('first-contentful-paint')[0];
      const transfer = performance
        .getEntriesByType('resource')
        .reduce((total, entry) => total + ((entry as PerformanceResourceTiming).transferSize || 0), 0);

      return {
        lcp: Math.round(lcp || paint?.startTime || 0),
        fcp: Math.round(paint?.startTime ?? 0),
        ttfb: Math.round(nav.responseStart),
        cls: Number(cls.toFixed(4)),
        transfer: transfer + (nav.transferSize || 0),
      };
    });
  } finally {
    await context.close();
  }
}

async function report(testInfo: TestInfo, name: string, samples: number[], budget: number) {
  await testInfo.attach(name, {
    body: `samples: ${samples.join(', ')}\nmedian: ${median(samples)}\nbudget: ${budget}`,
    contentType: 'text/plain',
  });
}

test.describe('performance budgets', () => {
  /*
   * Vitals and the run budget are measured on desktop only — they are about
   * the site and the machine, not the viewport, and sampling them twice would
   * double the gate's runtime for no extra signal. The layout-shift sweep
   * below does run at both sizes, because a shift is very much a viewport
   * property: the verdict route shifted three times as much on a phone.
   */
  const desktopOnly = (testInfo: TestInfo) =>
    test.skip(testInfo.project.name !== 'desktop', 'measured on desktop only');

  test('the landing page meets Core Web Vitals budgets', async ({ browser }, testInfo) => {
    desktopOnly(testInfo);
    const runs: Vitals[] = [];
    for (let i = 0; i < SAMPLES; i += 1) runs.push(await measure(browser, '/'));

    for (const key of ['lcp', 'fcp', 'ttfb', 'cls', 'transfer'] as const) {
      const samples = runs.map((run) => run[key]);
      await report(testInfo, `landing ${key}`, samples, BUDGET[key]);
      expect(median(samples), `${key} samples ${samples.join(', ')}`).toBeLessThanOrEqual(
        BUDGET[key],
      );
    }
  });

  test('the verdict screen meets Core Web Vitals budgets', async ({ browser }, testInfo) => {
    desktopOnly(testInfo);
    // The heaviest route: tables, matrix and metrics rendered at once.
    const runs: Vitals[] = [];
    for (let i = 0; i < SAMPLES; i += 1) runs.push(await measure(browser, '/#/demo/verdict'));

    for (const key of ['lcp', 'fcp', 'cls'] as const) {
      const samples = runs.map((run) => run[key]);
      await report(testInfo, `verdict ${key}`, samples, BUDGET[key]);
      expect(median(samples), `${key} samples ${samples.join(', ')}`).toBeLessThanOrEqual(
        BUDGET[key],
      );
    }
  });

  test('running the whole benchmark in the browser stays within budget', async ({
    browser,
  }, testInfo) => {
    desktopOnly(testInfo);
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      // Walk to the benchmark first: the budget is on executing the run, not
      // on how long a person spends reading the two screens before it.
      await openDemo(page);
      await goToContract(page);
      await goToBenchmark(page);
      const started = Date.now();
      await runBenchmarkAndWait(page);
      samples.push(Date.now() - started);
      await context.close();
    }
    await report(testInfo, 'run to verdict', samples, BUDGET.runToVerdict);
    expect(median(samples), `samples ${samples.join(', ')}`).toBeLessThanOrEqual(
      BUDGET.runToVerdict,
    );
  });

  /*
   * Every route, not just the landing page. The verdict deep link shipped a
   * 0.107 shift on desktop and 0.322 on a phone that a landing-only budget
   * would never have seen: the first paint had no step content, both footers
   * landed above the fold, and the rendered step then pushed them down.
   */
  for (const route of [
    '/',
    '/#/demo/record',
    '/#/demo/contract',
    '/#/demo/benchmark',
    '/#/demo/run',
    '/#/demo/verdict',
  ]) {
    test(`${route} hydrates without a layout shift`, async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.addInitScript(() => {
          (window as unknown as { __cls: number }).__cls = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
              if (!shift.hadRecentInput) (window as unknown as { __cls: number }).__cls += shift.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        });
        await page.goto(route);
        // Wait for the last thing on the page, so the measurement covers a
        // fully rendered route rather than an early frame.
        await expect(page.locator('footer').last()).toBeVisible({ timeout: 90_000 });
        await page.waitForTimeout(2000);
        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        expect(Number(cls.toFixed(4)), `CLS on ${route}`).toBeLessThanOrEqual(BUDGET.cls);
      } finally {
        await context.close();
      }
    });
  }
});
