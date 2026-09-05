/**
 * Builds the published `rigorrun` package.
 *
 * Two decisions worth stating, because both were the other way round first.
 *
 * **Our own code is bundled; third-party code is not.** Every `@rigorrun/*`
 * package is private and will never be on npm, so it has to travel inside this
 * artifact. Everything else stays a real dependency. That is not laziness about
 * bundle size: a declared dependency can be audited by `npm audit`, patched
 * without a RigorRun release, and — most importantly — is resolved by Node the
 * way its author intended. The MCP SDK reaches for `child_process` through
 * `cross-spawn`, which does a dynamic `require`; bundled into ESM that becomes
 * "Dynamic require of child_process is not supported", which is a runtime crash
 * on the first local connector somebody configures.
 *
 * **The interface travels with the runner.** `apps/web/dist` is copied in, so a
 * person who runs `npx rigorrun` gets a working interface rather than a working
 * API and a message about building one. There is no second step.
 */
import { build } from 'esbuild';
import { chmod, cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..');
const webDist = join(root, 'apps', 'web', 'dist');

/**
 * Left to npm to install.
 *
 * Keep this list and `dependencies` in package.json identical — a mismatch is
 * a module-not-found on somebody else's machine, which is the worst place to
 * find one. `packages/cli/test/package.test.ts` fails the build if they drift.
 */
const EXTERNAL = ['@modelcontextprotocol/sdk', 'hono', '@hono/node-server', 'zod'];

await rm(join(here, 'dist'), { recursive: true, force: true });
await mkdir(join(here, 'dist'), { recursive: true });

await build({
  entryPoints: [join(here, 'src', 'bin.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: join(here, 'dist', 'rigorrun.mjs'),
  external: EXTERNAL,
  // A CommonJS dependency that reached `require` at runtime would otherwise hit
  // esbuild's shim and throw. This gives it the real one.
  banner: {
    js: [
      "import { createRequire as __rigorrunCreateRequire } from 'node:module';",
      'const require = __rigorrunCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'warning',
});
await chmod(join(here, 'dist', 'rigorrun.mjs'), 0o755);

// The interface. Absent only when somebody built the CLI on its own, which is
// a development shortcut rather than something to publish.
const built = await stat(join(webDist, 'index.html')).catch(() => undefined);
if (built) {
  await rm(join(here, 'ui'), { recursive: true, force: true });
  await cp(webDist, join(here, 'ui'), { recursive: true });
  console.log('bundled the interface from apps/web/dist');
} else {
  console.log('no interface to bundle — run `pnpm build:web` before packing');
}

console.log('built packages/cli/dist/rigorrun.mjs');
