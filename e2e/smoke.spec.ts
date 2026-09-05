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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Acceptance testing');
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

  test('the control plane is healthy', async ({ request }) => {
    const response = await request.get(`${API}/api/health`);
    expect(response.status()).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  /*
   * Workspace creation is capped at 10/hour per address on purpose, so running
   * the gate a few times in one hour exhausts it. A 429 is then the correct
   * behaviour of a healthy control plane, not an outage — so both answers pass,
   * and both are checked properly. Anything else (a 500, a timeout, a body that
   * does not match) still fails.
   */
  test('the API issues a workspace, or correctly refuses to', async ({ request }) => {
    const response = await request.post(`${API}/api/workspaces`);
    expect([201, 429]).toContain(response.status());

    if (response.status() === 429) {
      const body = (await response.json()) as { error: string; retryAfter: number };
      expect(body.error).toMatch(/too many|rate limit/i);
      expect(body.retryAfter).toBeGreaterThan(0);
      test.info().annotations.push({
        type: 'note',
        description: `workspace quota spent; limiter answered correctly, resets in ${body.retryAfter}s`,
      });
      return;
    }

    const body = (await response.json()) as { workspaceId: string; token: string };
    expect(body.workspaceId).toMatch(/^ws_[0-9a-z]{16}$/);
    expect(body.token).toHaveLength(64);
  });
});
