/**
 * The critical path, run on every engine.
 *
 * Kept deliberately small so it can run on Chromium, Firefox and WebKit without
 * the suite becoming slow. If this passes on an engine, the product's core
 * promise works there; anything beyond it is covered by the Chromium suites.
 */
import { expect, test } from '@playwright/test';
import {
  REFERENCE,
  WEAK,
  expectClean,
  expectNoOverflow,
  goToBenchmark,
  goToContract,
  openDemo,
  runBenchmarkAndWait,
  watchPage,
} from './support/journeys.ts';

test.describe('critical path', () => {
  test('the whole pipeline runs and reaches a verdict', async ({ page }) => {
    const watchers = watchPage(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Acceptance tests');

    await openDemo(page);
    await goToContract(page);
    // The rule read out of a number on the page, still a guess at this point.
    await expect(page.getByText(/above \$50/).first()).toBeVisible();

    await goToBenchmark(page);
    const cases = await page.locator('[data-testid^="case-row-"]').count();
    expect(cases).toBeGreaterThan(8);

    await runBenchmarkAndWait(page);
    await expect(page.getByTestId('verdict')).toBeVisible();
    await expect(page.getByTestId(`score-${WEAK}`)).toContainText('Gate failed');
    await expect(page.getByTestId(`score-${REFERENCE}`)).toContainText('Gate passed');

    await expectNoOverflow(page);
    expectClean(watchers);
  });

  test('the evidence rests on state, and the agent is not asked', async ({ page }) => {
    await page.goto('/#/demo/verdict');
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });

    await page.locator(`[data-testid^="cell-${WEAK}-"]`).first().click();
    const evidence = page.getByRole('dialog');
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText('Not used to decide a verdict');
  });

  test('the evidence dialog closes with Escape', async ({ page }) => {
    await page.goto('/#/demo/verdict');
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });
    await page.locator(`[data-testid^="cell-${WEAK}-"]`).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('evidence-drawer')).toHaveCount(0);
  });
});
