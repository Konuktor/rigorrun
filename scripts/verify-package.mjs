#!/usr/bin/env node
/**
 * Everything that has to be true before `rigorrun` goes on npm.
 *
 * One command, because the failure mode of a checklist is that somebody does
 * four of the six steps at 11pm. Each stage below has burned somebody
 * somewhere: a tarball with sources in it, a bundle that crashes on the first
 * dynamic require, a package that works in the monorepo and not outside it, an
 * executable that produces a syntax error on the Node a stranger happens to
 * have.
 *
 *   node scripts/verify-package.mjs
 *
 * It publishes nothing. The last line tells you whether it would be safe to.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'packages', 'cli');

const ESC = String.fromCharCode(27);
const red = (t) => `${ESC}[31m${t}${ESC}[0m`;
const green = (t) => `${ESC}[32m${t}${ESC}[0m`;
const dim = (t) => `${ESC}[90m${t}${ESC}[0m`;
const bold = (t) => `${ESC}[1m${t}${ESC}[0m`;

const failures = [];
const notes = [];

function check(what, ok, detail = '') {
  console.log(`  ${ok ? green('ok') : red('no')}  ${what}${detail ? dim(`  ${detail}`) : ''}`);
  if (!ok) failures.push(what);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', cwd: root, ...options });
}

// ------------------------------------------------------------------- 1. build

console.log(bold('\nBuilding what would be published'));
run('pnpm', ['build:web'], { stdio: 'ignore' });
run('pnpm', ['build:cli'], { stdio: 'ignore' });
check('the interface was built into the package', await exists(join(pkgDir, 'ui', 'index.html')));

// -------------------------------------------------------------------- 2. pack

console.log(bold('\nPacking'));
const packOut = run('npm', ['pack', '--json', '--pack-destination', join(root, 'dist')], {
  cwd: pkgDir,
});
// npm 10 answers with an array, npm 11 with an object keyed by package name.
// Handling both is cheaper than pinning an npm.
const packReport = JSON.parse(packOut);
const packed = Array.isArray(packReport) ? packReport[0] : Object.values(packReport)[0];
if (!packed) throw new Error(`npm pack said something unexpected: ${packOut.slice(0, 200)}`);
const tarball = join(root, 'dist', packed.filename);
console.log(dim(`  ${packed.filename}  ${(packed.size / 1024).toFixed(0)}kB packed`));

const names = packed.files.map((file) => file.path).sort();
check('contains only what running it needs', names.every(isAllowed), names.join(' '));
check('ships no sources or tests', !names.some((name) => /^(src|test)\//.test(name)));
check('ships the executable', names.includes('bin/rigorrun.mjs'));
check('ships the interface', names.some((name) => name.startsWith('ui/')));
check('ships a licence', names.includes('LICENSE'));
check('ships the README npm will show', names.includes('README.md'));

// -------------------------------------------------------------- 3. secret scan

console.log(bold('\nScanning for anything that should not be in a public artifact'));
const scratch = await mkdtemp(join(tmpdir(), 'rigorrun-verify-'));
run('tar', ['xzf', tarball, '-C', scratch]);
const unpacked = join(scratch, 'package');

const SECRET_SHAPES = [
  ['an API key', /\b(sk|gsk|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}/],
  ['an AWS key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Google API key', /\bAIza[A-Za-z0-9_-]{30,}/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a JWT', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./],
  ['a path from the machine that built it', /\/(home|Users)\/[a-z]/i],
];
const found = [];
for (const file of await filesUnder(unpacked)) {
  const body = await readFile(file, 'utf8').catch(() => '');
  for (const [what, pattern] of SECRET_SHAPES) {
    if (pattern.test(body)) found.push(`${what} in ${file.slice(unpacked.length + 1)}`);
  }
}
check('no credentials or build-machine paths', found.length === 0, found.join('; '));

// --------------------------------------------------- 4. install somewhere else

console.log(bold('\nInstalling into a clean directory, as a stranger would'));
const clean = await mkdtemp(join(tmpdir(), 'rigorrun-install-'));
run('npm', ['init', '-y'], { cwd: clean, stdio: 'ignore' });
run('npm', ['install', tarball], { cwd: clean, stdio: 'ignore' });

const binary = join(clean, 'node_modules', '.bin', 'rigorrun');
check('the executable is on the path npm puts it on', await exists(binary));

// No workspace anywhere near it: this is the check that catches a bundled
// package quietly depending on the monorepo it was built in.
const installedManifest = JSON.parse(
  await readFile(join(clean, 'node_modules', 'rigorrun', 'package.json'), 'utf8'),
);
check(
  'declares nothing that only exists in our monorepo',
  !Object.keys(installedManifest.dependencies ?? {}).some((name) => name.startsWith('@rigorrun/')),
);

// -------------------------------------------------------------- 5. actually run

console.log(bold('\nRunning it'));
const home = join(clean, 'home');
const version = run(binary, ['--version'], { env: { ...process.env, RIGORRUN_HOME: home } }).trim();
check('reports its version', version === installedManifest.version, version);

const doctor = spawnResult(binary, ['doctor'], home);
check('doctor runs', doctor.status === 0 || doctor.status === 2, doctor.out.slice(0, 60));

const started = spawnResult(binary, ['--once'], home);
const paired = /http:\/\/127\.0\.0\.1:\d+\/\?code=[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/.exec(
  started.out,
);
check('starts and prints a pairing URL', paired !== null);
check(
  'has an interface to serve',
  !started.out.includes('interface is not built'),
  'otherwise the first thing a stranger sees is a dead end',
);

// An old runtime has to produce a sentence rather than a syntax error. Faking
// the version is the only way to test this without installing an old Node.
const shim = await readFile(join(clean, 'node_modules', 'rigorrun', 'bin', 'rigorrun.mjs'), 'utf8');
const oldNode = spawnSync('node', ['-e', shim.replace(
  'process.versions.node',
  "'18.19.0'",
).replace("import('../dist/rigorrun.mjs')", 'Promise.resolve()')]);
check(
  'explains itself on a Node that is too old',
  oldNode.status === 2 && /Node 20\.11 or newer/.test(oldNode.err) && /nodejs\.org/.test(oldNode.err),
  oldNode.err.split('\n')[1] ?? '',
);

// ------------------------------------------------------- 6. the fresh-user run

console.log(bold('\nThe fresh-user journey, against the packaged artifact'));
const e2e = spawnSync('pnpm', ['e2e:external'], {
  cwd: root,
  env: { ...process.env, RIGORRUN_BIN: binary },
});
check('a stranger can go from nothing to a verdict', e2e.status === 0);
if (e2e.status !== 0) notes.push(e2e.out.split('\n').slice(-25).join('\n'));

// ------------------------------------------------------------------- verdict

await rm(scratch, { recursive: true, force: true });
await rm(clean, { recursive: true, force: true });

console.log();
if (failures.length > 0) {
  console.log(red(bold('NOT READY TO PUBLISH')));
  for (const failure of failures) console.log(red(`  · ${failure}`));
  for (const note of notes) console.log(dim(note));
  process.exit(1);
}

console.log(green(bold('READY TO PUBLISH')));
console.log(dim(`  ${tarball}`));
console.log();
console.log('  Publishing is a decision, not a build step. When you want to:');
console.log(bold(`    npm publish ${tarball} --access public --tag alpha`));
console.log();
console.log(dim('  --tag alpha keeps it off `latest`, so `npm i rigorrun` does not'));
console.log(dim('  install a prerelease by accident.'));

// ------------------------------------------------------------------- helpers

function isAllowed(name) {
  return (
    name === 'package.json' ||
    name === 'README.md' ||
    name === 'LICENSE' ||
    name.startsWith('bin/') ||
    name.startsWith('dist/') ||
    name.startsWith('ui/')
  );
}

async function exists(path) {
  return Boolean(await stat(path).catch(() => null));
}

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full)));
    else out.push(full);
  }
  return out;
}

/** Runs something to completion and keeps everything it said. */
function spawnSync(command, args, options = {}) {
  const result = execFileSyncSafe(command, args, options);
  return result;
}

function execFileSyncSafe(command, args, options) {
  try {
    const out = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    return { status: 0, out, err: '' };
  } catch (error) {
    return {
      status: error.status ?? 1,
      out: String(error.stdout ?? ''),
      err: String(error.stderr ?? ''),
    };
  }
}

function spawnResult(command, args, home) {
  const result = execFileSyncSafe(command, args, {
    cwd: root,
    env: { ...process.env, RIGORRUN_HOME: home, NO_COLOR: '1' },
    timeout: 120_000,
  });
  return { status: result.status, out: `${result.out}${result.err}` };
}

void spawn;
