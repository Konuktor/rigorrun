import type { APIRoute } from 'astro';

/**
 * Written here rather than pulled in as an integration: the site is a dozen
 * hand-authored routes, and a dependency that generates twelve lines is a
 * dependency to keep patched forever.
 *
 * There was no sitemap before because there was nothing to put in one — the
 * whole site lived behind a hash router, so `https://rigorrun.xyz/` was the
 * only URL that existed.
 */
const ROUTES: Array<{ path: string; priority: string; changefreq: string }> = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/how-it-works', priority: '0.9', changefreq: 'monthly' },
  { path: '/evidence', priority: '0.9', changefreq: 'weekly' },
  { path: '/verify', priority: '0.8', changefreq: 'monthly' },
  { path: '/start', priority: '0.8', changefreq: 'monthly' },
  { path: '/security', priority: '0.7', changefreq: 'monthly' },
  { path: '/what-is-built', priority: '0.7', changefreq: 'weekly' },
  { path: '/company', priority: '0.6', changefreq: 'monthly' },
  { path: '/access', priority: '0.6', changefreq: 'monthly' },
  { path: '/changelog', priority: '0.6', changefreq: 'weekly' },
  { path: '/privacy', priority: '0.3', changefreq: 'yearly' },
  { path: '/terms', priority: '0.3', changefreq: 'yearly' },
];

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL('https://rigorrun.xyz')).origin;
  const today = new Date().toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${ROUTES.map(
  (route) => `  <url>
    <loc>${origin}${route.path === '/' ? '' : route.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`,
).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
