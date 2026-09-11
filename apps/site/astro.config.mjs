// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import tailwind from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveMx, lookup } from 'node:dns/promises';

/**
 * One version, read from the manifest that is actually published.
 *
 * The site used to carry hardcoded counts and drifted thirteen commits behind
 * what the pipeline produced. Nothing user-visible is a literal any more: the
 * version comes from here, and every number comes from a generated JSON file.
 */
const version = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../packages/cli/package.json', import.meta.url)), 'utf8'),
).version;

/**
 * Whether the site is allowed to print an @rigorrun.xyz address.
 *
 * The security page tells somebody who found a vulnerability where to send it.
 * An address that bounces is worse than none: it turns a person willing to
 * report privately into a person who thinks they already did. So the build
 * asks whether mail can be delivered, and the pages fall back to the issue
 * tracker when it cannot. Enable Email Routing on the zone and the next build
 * picks it up with no edit.
 *
 * `pnpm contact` reports the same thing without building.
 */
const mailWorks = await resolveMx('rigorrun.xyz').then(
  (records) => records.length > 0,
  () => false,
);
/**
 * Where the documentation actually is.
 *
 * `docs.rigorrun.xyz` is a Cloudflare Pages custom domain, and a custom domain
 * is not live until its DNS record exists. Linking it before then would put a
 * "Docs" item in the primary navigation that resolves to nothing — the same
 * failure as printing an address that bounces, and rather more visible. So the
 * build asks, and falls back to the deployment's own hostname until the record
 * is there.
 */
const docsUrl = await lookup('docs.rigorrun.xyz').then(
  () => 'https://docs.rigorrun.xyz',
  () => 'https://rigorrun-docs.pages.dev',
);
if (docsUrl.endsWith('pages.dev')) {
  console.warn(
    '[rigorrun] docs.rigorrun.xyz does not resolve. Linking rigorrun-docs.pages.dev instead.\n' +
      '           Add a CNAME docs -> rigorrun-docs.pages.dev on the zone and rebuild.',
  );
}

if (!mailWorks) {
  console.warn(
    '[rigorrun] rigorrun.xyz has no MX record. Building without a published email address;\n' +
      '           contact routes to GitHub issues instead. Enable Cloudflare Email Routing\n' +
      '           on the zone and rebuild to publish security@ and hello@.',
  );
}

/**
 * rigorrun.xyz.
 *
 * Static output, one HTML file per route. The site this replaces was a React
 * SPA behind a hash router, which meant `https://rigorrun.xyz/` was the only
 * URL that existed: the evidence page could not be linked, could not be
 * indexed, and could not carry its own share card. Every route below is now a
 * real document that arrives complete before any JavaScript runs.
 *
 * The image service is the passthrough one on purpose. Astro's default pulls
 * in `sharp`, which has an install script, and this workspace holds the line
 * that `pnpm install` runs no scripts. Every image here is either an SVG or a
 * PNG rendered ahead of time by `scripts/build-brand.mjs`, so there is nothing
 * for a native image pipeline to do.
 */
export default defineConfig({
  site: 'https://rigorrun.xyz',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'auto' },
  image: { service: passthroughImageService() },
  vite: {
    plugins: [tailwind()],
    define: {
      __RIGORRUN_VERSION__: JSON.stringify(version),
      __RIGORRUN_MAIL__: JSON.stringify(mailWorks),
      __RIGORRUN_DOCS__: JSON.stringify(docsUrl),
    },
  },
  devToolbar: { enabled: false },
});
