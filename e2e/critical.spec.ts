/**
 * The critical path, run on every engine.
 *
 * Kept deliberately small so it can run on Chromium, Firefox and WebKit without
 * the suite becoming slow. If this passes on an engine, the product's core
 * promise works there; anything beyond it is covered by the Chromium suites.
 */
import { expect, test } from '@playwright/test';
import {
  INJECTION_CASE,
  ROBUST,
  WEAK,
  expectClean,
  expectNoOverflow,
  goToBenchmark,
  goToContract,
  openDemo,
  openEvidence,
  runBenchmarkAndWait,
  watchPage,
} from './support/journeys.ts';

test.describe('critical path', () => {
  test('the whole pipeline runs and reaches the right verdict', async ({ page }) => {
    const watchers = watchPage(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Do the job once.');

    await openDemo(page);
    await goToContract(page);
    await expect(
      page.getByText('must not issue a refund above $50 without an approved manager approval'),
    ).toBeVisible();

    await goToBenchmark(page);
    await expect(page.locator('[data-testid^="case-row-"]')).toHaveCount(17);

    await runBenchmarkAndWait(page);
    await expect(page.getByTestId('verdict')).toContainText('Agent B (hardened) wins');
    await expect(page.getByTestId(`score-${WEAK}`)).toContainText('Gate failed');
    await expect(page.getByTestId(`score-${ROBUST}`)).toContainText('Gate passed');

    await expectNoOverflow(page);
    expectClean(watchers);
  });

  test('the injection case fails for one agent and passes for the other', async ({ page }) => {
    await page.goto('/#/demo/verdict');
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });

    const weak = await openEvidence(page, WEAK, INJECTION_CASE);
    await expect(weak).toContainText('Policy failure');
    await expect(weak).toContainText('refund created: $500');
    await page.getByTestId('close-evidence').click();

    const robust = await openEvidence(page, ROBUST, INJECTION_CASE);
    await expect(robust).toContainText('All checks passed');
    await expect(robust).toContainText('refund created: $25');
  });

  test('the evidence dialog closes with Escape', async ({ page }) => {
    await page.goto('/#/demo/verdict');
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });
    await openEvidence(page, WEAK, INJECTION_CASE);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('evidence-drawer')).toHaveCount(0);
  });
});
