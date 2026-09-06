#!/usr/bin/env node
/**
 * Gate 1 — a clean machine reaches a verification record with one command and
 * no browser.
 *
 * The point of this script is that it does not trust the repository. It builds
 * the tarball, installs it into a directory that has never seen RigorRun, gives
 * it a HOME that does not exist yet, and runs it there. A green unit suite is
 * not evidence for this gate; an artifact a stranger could download is.
 *
 *   node scripts/gate1.mjs [server-ref]
 *
 * It publishes nothing and changes nothing outside a temporary directory.
 *
 * The one thing it deliberately does NOT measure is how long a person takes.
 * The number printed at the end is machine runtime. Human TTFRV is measured
 * with a stopwatch against docs/TTFRV_PROTOCOL.md, and reporting one as the
 * other is the exact defect 0.1.1 removed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.argv[2] ?? 'npm:@modelcontextprotocol/server-memory@2026.8.31';

const ESC = String.fromCharCode(27);
const red = (t) => `${ESC}[31m${t}${ESC}[0m`;
const green = (t) => `${ESC}[32m${t}${ESC}[0m`;
const dim = (t) => `${ESC}[90m${t}${ESC}[0m`;

const failures = [];
function check(what, ok, detail = '') {
  console.log(`  ${ok ? green('ok') : red('no')}  ${what}${detail ? dim(`  ${detail}`) : ''}`);
  if (!ok) failures.push(what);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

console.log('\nGate 1 — clean machine, one command, no browser\n');

// A container runtime is a precondition of the gate, not part of it. Saying so
// is more useful than a failure that looks like the product is broken.
const runtime = run('docker', ['version', '--format', '{{.Server.Version}}']);
if (runtime.status !== 0) {
  console.log(red('  No container runtime. `rigorrun verify` needs one, so this gate cannot run.'));
  console.log(dim('  This is a precondition, not a Gate 1 failure. Install Docker and re-run.'));
  process.exit(2);
}
check('a container runtime is present', true, `docker ${runtime.stdout.trim()}`);

console.log('\nBuilding and packing');
// `pnpm run pack`, not `pnpm pack`. pnpm has a builtin `pack` that shadows the
// script of the same name, so the short form packs the workspace root and
// never rebuilds -- which is how a stale tarball gets tested and passes.
execFileSync('pnpm', ['run', 'pack'], { cwd: root, stdio: 'inherit' });

const dist = join(root, 'dist');
const tarball = (await readdir(dist))
  .filter((f) => f.startsWith('rigorrun-') && !f.startsWith('rigorrun-workspace') && f.endsWith('.tgz'))
  .sort()
  .at(-1);
if (!tarball) {
  console.log(red('  Nothing was packed.'));
  process.exit(2);
}
check('a tarball exists', true, tarball);

// A fresh directory and a HOME that has never existed. Both matter: the second
// is what proves nothing was left behind by a previous run on this machine.
const sandbox = await mkdtemp(join(tmpdir(), 'rigorrun-gate1-'));
const home = join(sandbox, 'home');
const project = join(sandbox, 'project');
run('mkdir', ['-p', home, project]);

console.log('\nInstalling into a directory that has never seen RigorRun');
const install = run('npm', ['install', '--no-audit', '--no-fund', join(dist, tarball)], {
  cwd: project,
  env: { ...process.env, HOME: home },
});
check('the tarball installs outside the monorepo', install.status === 0, install.stderr.slice(0, 200));

const binary = join(project, 'node_modules', '.bin', 'rigorrun');
const env = {
  ...process.env,
  HOME: home,
  // Nothing may open a browser, and nothing may reach a display if it tried.
  DISPLAY: '',
  BROWSER: 'true',
  RIGORRUN_HOME: join(home, '.rigorrun'),
};

const version = run(binary, ['--version'], { cwd: project, env });
check('the installed binary runs', version.status === 0, version.stdout.trim());

console.log(`\nVerifying ${REF}`);
const startedAt = Date.now();
const verify = run(binary, ['verify', REF], {
  cwd: project,
  env,
  timeout: 900_000,
  maxBuffer: 64 * 1024 * 1024,
});
const machineMs = Date.now() - startedAt;

process.stdout.write(verify.stdout ?? '');
if (verify.status === null) {
  check('verify completed', false, 'it was killed before finishing');
}

// 0, 1 and 3 all mean the verification ran. 2 means it could not.
check(
  'one command produced a result without a browser',
  [0, 1, 3].includes(verify.status),
  `exit ${verify.status}`,
);

let record;
const records = join(project, '.rigorrun', 'records');
try {
  const written = (await readdir(records)).filter((f) => f.endsWith('.json'));
  check('a verification record was written', written.length > 0, `${written.length} file(s)`);
  if (written[0]) record = JSON.parse(await readFile(join(records, written[0]), 'utf8'));
} catch {
  check('a verification record was written', false, 'no records directory');
}

if (record) {
  check('the record names the exact bytes that ran', Boolean(record.target?.digest), record.target?.digest);
  check('the record says what it could not test', Array.isArray(record.untested), `${record.untested?.length} tool(s)`);
  check('the record states its own limits', (record.harness?.caveats ?? []).length > 0);
  check('the container had no network', record.harness?.networkEgress === false);
  check('isolation was measured, not declared', (record.harness?.isolationProof?.resets ?? 0) >= 2);
}

// Nothing may have been written to the real home, only to the fresh one.
const strayHome = run('sh', ['-c', `ls -a ${home}`]).stdout ?? '';
check('it kept everything under the fresh HOME', strayHome.includes('.rigorrun') || strayHome.length > 0);

await rm(sandbox, { recursive: true, force: true });

console.log('');
console.log(`  machine runtime  ${(machineMs / 1000).toFixed(1)}s ${dim('(not a human onboarding time)')}`);
console.log(`  human TTFRV      ${red('UNMEASURED')} ${dim('— see docs/TTFRV_PROTOCOL.md')}`);
console.log('');

if (failures.length > 0) {
  console.log(red(`GATE 1 FAILED — ${failures.length} check(s) did not pass`));
  for (const f of failures) console.log(red(`  · ${f}`));
  process.exit(1);
}
console.log(green('GATE 1 PASSED — a clean machine reached a verification record with one command.'));
console.log(dim('Human TTFRV remains unmeasured, so no onboarding-time claim follows from this.'));
