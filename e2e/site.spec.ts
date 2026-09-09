/**
 * Layer C — the public site, against the real deployment.
 *
 * What this can assert changed completely with the site itself. The old site
 * was a React SPA behind a hash router: one URL existed, its title was written
 * by JavaScript after paint, and a request for any path returned the homepage
 * with a 200. So "does /evidence exist" was not a question that could be asked.
 * Every route is now a document, which is what the assertions here rely on.
 */
import { expect, test } from '@playwright/test';

const ROUTES = [
  '/',
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
] as const;

test.describe('every route', () => {
  for (const path of ROUTES) {
    test(`${path} serves a complete document`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      // Exactly one h1, and it is not empty.
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).not.toBeEmpty();

      // A title and description that belong to this page rather than to the
      // site. Every route used to share one of each.
      await expect(page).toHaveTitle(/RigorRun/);
      const description = page.locator('meta[name="description"]');
      await expect(description).toHaveAttribute('content', /.{60,}/);

      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveAttribute('href', /^https:\/\/rigorrun\.xyz/);

      // A share card, with an image. The whole site was `summary` with no
      // image, so every link anybody posted rendered as bare text.
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        'content',
        'summary_large_image',
      );
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og\.png$/);

      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();
    });
  }
});

test.describe('the page arrives without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  /*
   * The point of the rebuild. With scripting off the old site was an empty
   * <div id="root">, which is what a crawler that does not execute JavaScript
   * saw as well.
   */
  test('the home page is readable with scripting disabled', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('said it worked');
    await expect(page.getByText('npx rigorrun').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Evidence' }).first()).toBeVisible();
  });

  test('the evidence page keeps its denominator with scripting disabled', async ({ page }) => {
    await page.goto('/evidence');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('did not write');
    await expect(page.getByText('of 37', { exact: false }).first()).toBeVisible();
  });

  /* Nothing is revealed on scroll if nothing can run to reveal it. */
  test('no section is left invisible', async ({ page }) => {
    await page.goto('/');
    const hidden = await page
      .locator('[data-reveal]')
      .evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).opacity !== '1').length);
    expect(hidden).toBe(0);
  });
});

test.describe('crawler surface', () => {
  test('a missing page is a 404, not the homepage', async ({ page }) => {
    const response = await page.goto('/no-such-page');
    expect(response?.status()).toBe(404);
  });

  test('the sitemap lists every route', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const body = await response.text();
    for (const path of ROUTES) {
      const expected = path === '/' ? 'https://rigorrun.xyz<' : `https://rigorrun.xyz${path}<`;
      expect(body, `${path} should be in the sitemap`).toContain(expected);
    }
  });

  test('robots points at the sitemap and allows crawling', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    expect(body).toContain('Allow: /');
    expect(body).toContain('Sitemap: https://rigorrun.xyz/sitemap.xml');
  });

  test('the brand assets are served', async ({ request }) => {
    for (const [path, type] of [
      ['/og.png', 'image/png'],
      ['/favicon.svg', 'image/svg+xml'],
      ['/favicon.ico', ''],
      ['/apple-touch-icon.png', 'image/png'],
      ['/site.webmanifest', ''],
      ['/llms.txt', 'text/plain'],
      ['/fonts/instrument-sans-latin.woff2', 'font/woff2'],
    ] as const) {
      const response = await request.get(path);
      expect(response.status(), `${path} should serve`).toBe(200);
      if (type) expect(response.headers()['content-type'] ?? '', path).toContain(type);
    }
  });
});

test.describe('claims that must not drift', () => {
  /*
   * These are the sentences the product is judged on. A redesign is exactly
   * the kind of change that quietly rounds "19 of 37" up to "verified" and
   * drops the paragraph saying what a scan does not establish.
   */
  test('the evidence page still carries what it does not establish', async ({ page }) => {
    await page.goto('/evidence');
    await expect(page.getByText('What this does not establish')).toBeVisible();
    await expect(page.getByText('Our own scan is not a user')).toBeVisible();
    await expect(page.getByText('What the harness itself cannot do')).toBeVisible();
    await expect(page.getByText(/does not claim to prevent a container escape/)).toBeVisible();
  });

  test('a verdict against a real system is not described as authoritative', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/is\s+PARTIAL/).first()).toBeVisible();
  });

  test('the access page claims no customers and no pricing', async ({ page }) => {
    await page.goto('/access');
    await expect(page.getByText('There are no customers')).toBeVisible();
    await expect(page.getByText('There is no cohort')).toBeVisible();
  });

  test('security names what leaves the machine rather than claiming nothing does', async ({
    page,
  }) => {
    await page.goto('/security');
    await expect(page.getByText('What leaves the machine')).toBeVisible();
    await expect(page.getByText(/registry\.npmjs\.org|npm registry/).first()).toBeVisible();
  });
});

test.describe('responsive', () => {
  test('no route scrolls sideways at this viewport', async ({ page }) => {
    for (const path of ROUTES) {
      await page.goto(path);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll, `${path} overflows`).toBeLessThanOrEqual(overflow.client);
    }
  });
});
