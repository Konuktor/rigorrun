/**
 * Bundles the CLI into a single file so `rigorrun` runs without a TypeScript
 * loader and without resolving workspace paths at runtime.
 */
import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const alias = (name) => fileURLToPath(new URL(`packages/${name}/src/index.ts`, new URL(root, 'file://')));

await build({
  entryPoints: [fileURLToPath(new URL('src/bin.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: fileURLToPath(new URL('dist/rigorrun.mjs', import.meta.url)),
  alias: {
    '@rigorrun/core': alias('core'),
    '@rigorrun/verifier': alias('verifier'),
    '@rigorrun/scoring': alias('scoring'),
    '@rigorrun/agents': alias('agents'),
    '@rigorrun/providers': alias('providers'),
    '@rigorrun/runner': alias('runner'),
    '@rigorrun/report': alias('report'),
    '@rigorrun/generator': alias('generator'),
    '@rigorrun/compiler': alias('compiler'),
    '@rigorrun/environment': alias('environment'),
    '@rigorrun/environments': alias('environments'),
    '@rigorrun/quality': alias('quality'),
  },
  logLevel: 'warning',
});

await chmod(fileURLToPath(new URL('dist/rigorrun.mjs', import.meta.url)), 0o755);
console.log('built packages/cli/dist/rigorrun.mjs');
