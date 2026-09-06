/**
 * Layer B — production smoke.
 *
 * Deliberately small and fast: it answers "is the deployment catastrophically
 * broken?" and nothing else. It is not evidence that the product works; that is
 * what prod.spec.ts is for.
 */
import { expect, test } from '@playwright/test';

const CRM = process.env['CRM_URL'] ?? 'https://rigorrun-crm.pages.dev';

test.describe('production smoke', () => {
  test('the landing page serves and renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Acceptance tests');
    // The primary action is testing your own agent; the demo is secondary and
    // still has to be there, because the site is what somebody sees before
    // they are willing to run anything locally.
    await expect(page.getByTestId('cta-test-your-agent')).toBeVisible();
    await expect(page.getByTestId('cta-run-demo')).toBeVisible();
  });

  test('the demo starts', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('cta-run-demo').click();
    await expect(page.getByRole('heading', { name: 'A person did the job once' })).toBeVisible();
  });

  test('the Northstar demo app serves', async ({ page }) => {
    const response = await page.goto(CRM);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
  });
});
