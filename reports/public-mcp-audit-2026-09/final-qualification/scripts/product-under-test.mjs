#!/usr/bin/env node
/**
 * Freezes and checks the RigorRun build the final qualification measures.
 *
 *   node product-under-test.mjs          # write final-qualification/product-under-test.json
 *   node product-under-test.mjs --check  # the product sources still equal the recorded commit, and every frozen input still verifies
 *
 * Exit 1 on any unexpected difference: a run must never start against a
 * product or a benchmark it did not freeze. Nothing here is typed by hand;
 * every value is read from git, the manifest or the files it names.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FQ = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPORT = resolve(FQ, '..');
const REMEDIATION = join(REPORT, 'remediation');
const REPO = resolve(REPORT, '..', '..');
const OUT = join(FQ, 'product-under-test.json');

/** Everything whose change would change what the product does. Evidence under reports/ is not in it. */
export const PRODUCT_PATHSPEC = ['packages', 'apps', 'fixtures', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json', 'vitest.config.ts'];
const N1_COMMITS = { product: ['0099670', 'f1ad841', '69e6c33'], tests: ['bbb5f9e', '8336fd3'] };
const SCORING_FILES = [
  'reports/public-mcp-audit-2026-09/scripts/run-cases.py',
  'reports/public-mcp-audit-2026-09/remediation/scripts/run-cases-after.py',
  'reports/public-mcp-audit-2026-09/remediation/scripts/aggregate-after.mjs',
  'reports/public-mcp-audit-2026-09/remediation/scripts/setup-after.py',
  'reports/public-mcp-audit-2026-09/remediation/scripts/recreate-stacks.sh',
];
const AFTER2_COMMIT = '0abf8ef5bb5466ff4bba75156836e3cd628a7841';

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOk = (...args) => {
  try {
    execFileSync('git', ['-C', REPO, ...args], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

function frozenInputs(problems) {
  const manifest = read(join(REMEDIATION, 'baseline-manifest.json'));

  let freezeCheck;
  try {
    freezeCheck = { exit: 0, output: execFileSync('node', [join(REMEDIATION, 'scripts', 'freeze-baseline.mjs'), '--check'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    freezeCheck = { exit: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() };
  }
  if (freezeCheck.exit !== 0 || !freezeCheck.output.includes('58 cases, 108 frozen files')) problems.push(`freeze-baseline.mjs --check: ${freezeCheck.output}`);

  const v2Dir = join(REMEDIATION, 'heldout-worktide-v2');
  const v2Freeze = read(join(v2Dir, 'freeze.json'));
  const v2Mismatch = Object.entries(v2Freeze.files).filter(([file, hash]) => !existsSync(join(v2Dir, file)) || sha256(join(v2Dir, file)) !== hash).map(([file]) => file);
  if (v2Mismatch.length > 0) problems.push(`heldout-worktide-v2 files differ from freeze.json: ${v2Mismatch.join(', ')}`);

  const targets = {};
  for (const [directory, key, field] of [['email-mcp', 'email-mcp', 'commit'], ['worktide-mcp', 'worktide-mcp', 'commit'], ['worktide', 'worktide-mcp', 'backendCommit'], ['sqlite-mcp', 'sqlite-mcp', 'commit']]) {
    const clone = join(REPO, 'tmp', 'rigorrun-audit', directory);
    const expected = manifest.targets[key][field];
    let actual = null;
    let modifiedTracked = [];
    try {
      actual = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      modifiedTracked = execFileSync('git', ['-C', clone, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.slice(3));
    } catch {
      actual = null;
    }
    targets[directory] = { expected, actual, matches: actual === expected, modifiedTrackedFiles: modifiedTracked };
    if (actual !== expected) problems.push(`target clone ${directory} at ${actual}, manifest pins ${expected}`);
  }

  const labels = manifest.cases.map((c) => ({ id: c.id, truthLabel: c.truthLabel, attempts: c.attempts, mode: c.mode, injected: c.injected, rigorrunFindings: c.rigorrunFindings, caseFileSha256: c.caseFileSha256 }));
  const scoring = Object.fromEntries(
    SCORING_FILES.map((file) => [file, {
      sha256: sha256(join(REPO, file)),
      committedUnmodified: gitOk('diff', '--quiet', 'HEAD', '--', file),
      unchangedSinceAfter2: gitOk('diff', '--quiet', AFTER2_COMMIT, 'HEAD', '--', file),
    }]),
  );
  for (const [file, entry] of Object.entries(scoring)) if (!entry.committedUnmodified) problems.push(`scoring file has uncommitted changes: ${file}`);

  return {
    baselineManifest: { path: 'remediation/baseline-manifest.json', sha256: sha256(join(REMEDIATION, 'baseline-manifest.json')), frozenAt: manifest.frozenAt, cases: manifest.cases.length, frozenFiles: Object.keys(manifest.frozenFiles).length },
    freezeBaselineCheck: freezeCheck,
    caseDefinitionsSha256: createHash('sha256').update(JSON.stringify(labels)).digest('hex'),
    trialCounts: { perCase: Object.fromEntries(manifest.cases.map((c) => [c.id, c.attempts])), totalAttempts: manifest.cases.reduce((n, c) => n + c.attempts, 0) },
    r1Cases: manifest.cases.filter((c) => c.rigorrunFindings.includes('R-1')).map((c) => c.id),
    heldoutWorktideV2: { freezeJsonSha256: sha256(join(v2Dir, 'freeze.json')), casesJsonSha256: sha256(join(v2Dir, 'cases.json')), frozenAt: v2Freeze.frozenAt, filesVerified: Object.keys(v2Freeze.files).length, mismatches: v2Mismatch },
    pinnedTargets: targets,
    scoringRules: scoring,
  };
}

function productSourcesClean() {
  return git('status', '--porcelain', '--', ...PRODUCT_PATHSPEC) === '';
}

const problems = [];
if (process.argv.includes('--check')) {
  const recorded = read(OUT);
  if (!productSourcesClean()) problems.push('product sources have uncommitted changes');
  if (!gitOk('diff', '--quiet', recorded.productCommit, 'HEAD', '--', ...PRODUCT_PATHSPEC)) problems.push(`product sources differ from the recorded product commit ${recorded.productCommit}`);
  const now = frozenInputs(problems);
  for (const key of ['caseDefinitionsSha256']) if (now[key] !== recorded.frozenInputs[key]) problems.push(`${key} changed since the freeze`);
  if (now.baselineManifest.sha256 !== recorded.frozenInputs.baselineManifest.sha256) problems.push('baseline-manifest.json changed since the freeze');
  if (now.heldoutWorktideV2.freezeJsonSha256 !== recorded.frozenInputs.heldoutWorktideV2.freezeJsonSha256) problems.push('heldout-worktide-v2/freeze.json changed since the freeze');
  for (const [file, entry] of Object.entries(now.scoringRules)) if (entry.sha256 !== recorded.frozenInputs.scoringRules[file]?.sha256) problems.push(`scoring file changed since the freeze: ${file}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`DIFFERS: ${problem}`);
    process.exit(1);
  }
  console.log(`product under test verified: product sources equal ${recorded.productCommit.slice(0, 7)}; frozen inputs unchanged`);
  process.exit(0);
}

if (!productSourcesClean()) problems.push('product sources have uncommitted changes');
const head = git('rev-parse', 'HEAD');
const n1 = Object.fromEntries([...N1_COMMITS.product, ...N1_COMMITS.tests].map((c) => [c, gitOk('merge-base', '--is-ancestor', c, head)]));
for (const [commit, present] of Object.entries(n1)) if (!present) problems.push(`N-1 commit ${commit} is not an ancestor of HEAD`);
const inputs = frozenInputs(problems);
const record = {
  generatedBy: 'final-qualification/scripts/product-under-test.mjs',
  recordedAt: new Date().toISOString(),
  productCommit: head,
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  packageVersion: read(join(REPO, 'package.json')).version,
  productPathspec: PRODUCT_PATHSPEC,
  n1Commits: { product: N1_COMMITS.product, tests: N1_COMMITS.tests, presentAsAncestors: n1 },
  lastProductCommit: git('log', '-1', '--format=%H %s', '--', ...PRODUCT_PATHSPEC),
  previousMeasurements: {
    after2: { run: 'remediation/after', rigorrunCommit: AFTER2_COMMIT, productSourcesEqualNow: gitOk('diff', '--quiet', AFTER2_COMMIT, head, '--', ...PRODUCT_PATHSPEC) },
    n1Final: { rigorrunCommit: '54f6e79f016a4297c7ec1d3c43866ef17b0b9500', productSourcesEqualNow: gitOk('diff', '--quiet', '54f6e79f016a4297c7ec1d3c43866ef17b0b9500', head, '--', ...PRODUCT_PATHSPEC) },
  },
  frozenInputs: inputs,
  problems,
};
writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n');
for (const problem of problems) console.error(`DIFFERS: ${problem}`);
console.log(`${problems.length === 0 ? 'frozen' : 'NOT FROZEN'}: product ${head.slice(0, 7)} ${record.packageVersion}; manifest ${inputs.baselineManifest.cases} cases; v2 ${inputs.heldoutWorktideV2.filesVerified} files; targets ${Object.values(inputs.pinnedTargets).filter((t) => t.matches).length}/4 pinned`);
process.exit(problems.length === 0 ? 0 : 1);
