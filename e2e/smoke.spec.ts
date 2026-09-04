/**
 * Layer B — production smoke.
 *
 * Deliberately small and fast: it answers "is the deployment catastrophically
 * broken?" and nothing else. It is not evidence that the product works; that is
 * what prod.spec.ts is for.
 */
import { expect, test } from '@playwright/test';

const API = process.env['API_URL'] ?? 'https://rigorrun.takhiroverbol.workers.dev';
const CRM = process.env['CRM_URL'] ?? 'https://rigorrun-crm.pages.dev';

test.describe('production smoke', () => {
  test('the landing page serves and renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Do the job once.');
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

  test('the control plane is healthy', async ({ request }) => {
    const response = await request.get(`${API}/api/health`);
    expect(response.status()).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  test('the API issues a workspace', async ({ request }) => {
    const response = await request.post(`${API}/api/workspaces`);
    expect(response.status()).toBe(201);
    const body = (await response.json()) as { workspaceId: string; token: string };
    expect(body.workspaceId).toMatch(/^ws_[0-9a-z]{16}$/);
    expect(body.token).toHaveLength(64);
  });
});
