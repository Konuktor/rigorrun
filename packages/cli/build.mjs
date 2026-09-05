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
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

// The interface.
//
// This used to log and carry on. That produced a package whose first screen
// was "the interface is not built", which for somebody whose entire contact
// with RigorRun is `npx rigorrun` is not a degraded experience, it is the
// whole experience. A tarball without an interface should be impossible to
// build, so it now fails.
const built = await stat(join(webDist, 'index.html')).catch(() => undefined);
if (!built) {
  console.error(
    'No interface to bundle. Run `pnpm build:web` first — a package without one\n' +
      'is a package whose first screen is an error message.',
  );
  process.exit(1);
}
await rm(join(here, 'ui'), { recursive: true, force: true });
await cp(webDist, join(here, 'ui'), { recursive: true });
console.log('bundled the interface from apps/web/dist');

// `_redirects` is a Cloudflare Pages instruction. It means nothing inside an
// npm package and only invites the question of what it is doing there.
await rm(join(here, 'ui', '_redirects'), { force: true });

/**
 * The directory that gets packed, which is not the directory we develop in.
 *
 * `packages/cli/package.json` carries seventeen `workspace:*` devDependencies.
 * They are build-time wiring — esbuild resolves `@rigorrun/*` through the links
 * pnpm makes from them — and npm ignores a package's devDependencies when
 * installing it, so they do no harm at install time. But `npm pack` does not
 * rewrite pnpm's `workspace:` protocol, so anybody who opens the tarball reads
 * a manifest naming seventeen packages that do not exist on npm.
 *
 * Rather than mutate `package.json` around the pack and hope nothing crashes in
 * between, everything that ships is assembled into one directory and packed
 * from there. What is in that directory is exactly what a stranger installs,
 * which also makes the `files` allowlist checkable by looking rather than by
 * reasoning about it.
 */
const stage = join(here, 'package');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const manifest = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));
delete manifest.devDependencies;
// `scripts.build` runs this file, which is not in the tarball.
delete manifest.scripts;
await writeFile(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

for (const entry of ['bin', 'dist', 'ui', 'README.md', 'LICENSE']) {
  await cp(join(here, entry), join(stage, entry), { recursive: true });
}

console.log('built packages/cli/dist/rigorrun.mjs');
console.log(`staged the publishable package in ${stage}`);
