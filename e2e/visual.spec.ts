/**
 * Visual regression.
 *
 * Golden screenshots for the states that should not change without someone
 * deciding they should. Volatile content is neutralised precisely — run ids,
 * hashes and measured latencies — rather than by masking large regions, so a
 * real layout or styling change still fails the test.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  INJECTION_CASE,
  WEAK,
  goToBenchmark,
  goToContract,
  openDemo,
  openEvidence,
  runBenchmarkAndWait,
} from './support/journeys.ts';

const CRM = process.env['CRM_URL'] ?? 'http://127.0.0.1:5174';

/**
 * Replaces only the values that legitimately differ between runs. Everything
 * else — layout, spacing, colour, copy — is still compared pixel for pixel.
 */
async function stabilise(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }`,
  });
  await page.evaluate(() => {
    const replacements: [RegExp, string][] = [
      [/run_[0-9a-z]{10,}/g, 'run_000000000000'],
      [/sha256:[0-9a-f]{64}/g, `sha256:${'0'.repeat(64)}`],
      [/\d+(\.\d+)?\s?(µs|ms|s)\b/g, '000µs'],
      [/\b\d+ ms\b/g, '0 ms'],
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      let value = node.nodeValue ?? '';
      for (const [pattern, replacement] of replacements)
        value = value.replace(pattern, replacement);
      node.nodeValue = value;
    }
  });
  await page.waitForTimeout(120);
}

test.describe('visual regression', () => {
  test('landing', async ({ page }) => {
    await page.goto('/');
    await stabilise(page);
    await expect(page).toHaveScreenshot('landing.png', { fullPage: true });
  });

  test('record step', async ({ page }) => {
    await openDemo(page);
    await stabilise(page);
    await expect(page).toHaveScreenshot('record.png', { fullPage: true });
  });

  test('contract step', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await stabilise(page);
    await expect(page).toHaveScreenshot('contract.png', { fullPage: true });
  });

  test('benchmark step', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await goToBenchmark(page);
    await stabilise(page);
    await expect(page).toHaveScreenshot('benchmark.png', { fullPage: true });
  });

  test('verdict', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await goToBenchmark(page);
    await runBenchmarkAndWait(page);
    await stabilise(page);
    await expect(page).toHaveScreenshot('verdict.png', { fullPage: true });
  });

  test('evidence dialog', async ({ page }) => {
    await page.goto('/#/demo/verdict');
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });
    await openEvidence(page, WEAK, INJECTION_CASE);
    await stabilise(page);
    await expect(page.getByRole('dialog')).toHaveScreenshot('evidence.png');
  });

  test('Northstar workflow', async ({ page }) => {
    await page.goto(`${CRM}/orders/ORD-3001`);
    await expect(page.getByRole('heading', { name: 'Aurora headphones' })).toBeVisible();
    await page.getByTestId('open-refund-form').click();
    await stabilise(page);
    await expect(page).toHaveScreenshot('northstar.png', { fullPage: true });
  });
});
