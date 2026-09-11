import { readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { sharedConfig } from '../../vite.shared.ts';

/**
 * The version the product actually ships as.
 *
 * It used to be the string "v0.1" typed into three components, which is how
 * the site went on saying v0.1 after 0.1.1 was published. Read from the CLI
 * manifest — the one package that is published — so it cannot drift.
 */
const version: string = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../packages/cli/package.json', import.meta.url)), 'utf8'),
).version;

/**
 * Where the documentation actually is.
 *
 * `docs.rigorrun.xyz` is a Pages custom domain and is not live until its DNS
 * record exists. This interface ships inside the npm package, so a link that
 * does not resolve would sit in the header of every install until the next
 * release. Resolved at build time, with the deployment's own hostname as the
 * fallback.
 */
const docsUrl: string = await lookup('docs.rigorrun.xyz').then(
  () => 'https://docs.rigorrun.xyz',
  () => 'https://rigorrun-docs.pages.dev',
);

// Served from a domain root. A relative base would make a deep link such as
// /customers/CUST-2016 request its assets from /customers/assets/…, which the
// SPA fallback answers with index.html — the app then never boots.
export default defineConfig({
  ...sharedConfig(),
  base: '/',
  define: {
    __RIGORRUN_VERSION__: JSON.stringify(version),
    __RIGORRUN_DOCS__: JSON.stringify(docsUrl),
  },
});
