/**
 * Automated accessibility scanning.
 *
 * Automated checks catch roughly a third of real barriers, so this is a floor
 * rather than a ceiling — the manual keyboard journeys in prod.spec.ts and the
 * dialog tests cover what axe cannot see.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  firstCaseId,
  WEAK,
  goToBenchmark,
  goToContract,
  openDemo,
  openEvidence,
  runBenchmarkAndWait,
} from './support/journeys.ts';

const CRM = process.env['CRM_URL'] ?? 'http://127.0.0.1:5174';

async function scan(page: Page, context?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (context) builder.include(context);
  return builder.analyze();
}

function describeViolations(violations: Awaited<ReturnType<typeof scan>>['violations']): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join('\n    ')}`,
    )
    .join('\n  ');
}

test.describe('accessibility', () => {
  test('landing page has no WCAG A/AA violations', async ({ page }) => {
    await page.goto('/');
    const { violations } = await scan(page);
    expect(violations, `\n  ${describeViolations(violations)}`).toEqual([]);
  });

  test('record step has no violations', async ({ page }) => {
    await openDemo(page);
    const { violations } = await scan(page);
    expect(violations, `\n  ${describeViolations(violations)}`).toEqual([]);
  });

  test('contract step has no violations', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    const { violations } = await scan(page);
    expect(violations, `\n  ${describeViolations(violations)}`).toEqual([]);
  });

  test('benchmark step has no violations, including an expanded case', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await goToBenchmark(page);
    await page.locator('[data-testid^="case-row-"]').first().click();
    const { violations } = await scan(page);
    expect(violations, `\n  ${describeViolations(violations)}`).toEqual([]);
  });

  test('verdict has no violations', async ({ page }) => {
    await openDemo(page);
    await goToContract(page);
    await goToBenchmark(page);
    await runBenchmarkAndWait(page);
    const { violations } = await scan(page);
    expect(violations, `\n  ${describeViolations(violations)}`).toEqual([]);
  });

  test('evidence dialog has no violations', async ({ page }) => {
    await page.goto('/#/demo/verdict');
    await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 90_000 });
    await openEvidence(page, WEAK, await firstCaseId(page, WEAK));
    const { violations } = await scan(page);
    expect(violations, `\n  ${describeViolations(violations)}`).toEqual([]);
  });

  test('Northstar workflow has no violations', async ({ page }) => {
    await page.goto(`${CRM}/orders/ORD-3001`);
    await expect(page.getByRole('heading', { name: 'Aurora headphones' })).toBeVisible();
    const beforeForm = await scan(page);
    expect(beforeForm.violations, `\n  ${describeViolations(beforeForm.violations)}`).toEqual([]);

    await page.getByTestId('open-refund-form').click();
    const withForm = await scan(page);
    expect(withForm.violations, `\n  ${describeViolations(withForm.violations)}`).toEqual([]);
  });

  test('Northstar customer page with the injected note has no violations', async ({ page }) => {
    await page.goto(`${CRM}/customers/CUST-2016`);
    const { violations } = await scan(page);
    expect(violations, `\n  ${describeViolations(violations)}`).toEqual([]);
  });
});
