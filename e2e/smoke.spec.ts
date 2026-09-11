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
  test('the home page serves and renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('said it worked');
    await expect(page.getByTestId('nav-cta')).toBeVisible();
  });

  /*
   * The site is static HTML now, one document per route, so a route being
   * reachable is a thing that can be asserted. It could not be before: every
   * page lived behind a `#`, so `/evidence` and `/security` did not exist as
   * addresses and a request for either returned the homepage with a 200.
   */
  test('every route is a real document', async ({ page }) => {
    for (const path of [
      '/how-it-works',
      '/evidence',
      '/verify',
      '/security',
      '/what-is-built',
      '/start',
      '/access',
      '/company',
      '/changelog',
      '/privacy',
      '/terms',
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should serve`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('a page that does not exist says so', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    // A soft 200 that serves the homepage is what the SPA fallback used to do,
    // and it tells a crawler every misspelling is a real page.
    expect(response?.status()).toBe(404);
  });

  test('the evidence page shows third-party results', async ({ page }) => {
    await page.goto('/evidence');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('did not write');
    // The denominator, not just the successes.
    await expect(page.getByText('of 37', { exact: false }).first()).toBeVisible();
  });

  test('the share card and the crawler files are served', async ({ request }) => {
    for (const [path, type] of [
      ['/og.png', 'image/png'],
      ['/favicon.svg', 'image/svg+xml'],
      ['/sitemap.xml', 'xml'],
      ['/robots.txt', 'text/plain'],
      ['/llms.txt', 'text/plain'],
      ['/site.webmanifest', 'json'],
    ] as const) {
      const response = await request.get(path);
      expect(response.status(), `${path} should serve`).toBe(200);
      expect(response.headers()['content-type'] ?? '', path).toContain(type);
    }
  });

  test('the Northstar demo app serves', async ({ page }) => {
    const response = await page.goto(CRM);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
  });
});
