import { readFileSync } from 'node:fs';
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

// Served from a domain root. A relative base would make a deep link such as
// /customers/CUST-2016 request its assets from /customers/assets/…, which the
// SPA fallback answers with index.html — the app then never boots.
export default defineConfig({
  ...sharedConfig(),
  base: '/',
  define: { __RIGORRUN_VERSION__: JSON.stringify(version) },
});
