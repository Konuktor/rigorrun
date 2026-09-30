#!/usr/bin/env node
/**
 * Freezes and checks the RigorRun build the requalification measures.
 *
 *   node product-under-test.mjs          # write requalification/product-under-test.json
 *   node product-under-test.mjs --check  # product sources still equal the recorded commit, and every frozen input still verifies
 *
 * The final qualification's own check (final-qualification/scripts/product-under-test.mjs)
 * pins a9edbec and cannot pass at a later product, so its frozen-input checks are
 * repeated here against the same committed files: the frozen 58
 * (remediation/scripts/freeze-baseline.mjs --check), the Worktide v2 held-out
 * freeze, the independent-oracle v1 freeze (the rule run-io.py applies), the
 * pinned target clones and the committed scoring scripts. The benchmark-v2 and
 * IO-v2 freezes are verified once they exist, and a freeze that appears after
 * this record was written is a difference, not a pass.
 *
 * Exit 1 on any unexpected difference: a run must never start against a product
 * or a benchmark it did not freeze. Nothing here is typed by hand; every value
 * is read from git, the manifests or the files they name.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RQ = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPORT = resolve(RQ, '..');
const REMEDIATION = join(REPORT, 'remediation');
const FQ = join(REPORT, 'final-qualification');
const REPO = resolve(REPORT, '..', '..');
const OUT = join(RQ, 'product-under-test.json');

/** Everything whose change would change what the product does. Evidence under reports/ is not in it. */
export const PRODUCT_PATHSPEC = ['packages', 'apps', 'fixtures', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json', 'vitest.config.ts'];
/** The requalification's stage A commits (requalification/PLAN.md). */
const STAGE_A_COMMITS = {
  product: ['7e2e6a1', '8013852', '4491fbd', '32d561c', 'a6f60ed', '94d7230'],
  tests: ['2cc8980', 'e60f8e5', 'd75fb3b', '03ad7d6', '6a2f535'],
};
const N1_COMMITS = ['0099670', 'f1ad841', '69e6c33', 'bbb5f9e', '8336fd3'];
const FINAL_QUALIFICATION_PRODUCT = 'a9edbec98ea9056bf1b6a3773cc3fa9ba2692d01';
const SCORING_FILES = [
  'reports/public-mcp-audit-2026-09/scripts/run-cases.py',
  'reports/public-mcp-audit-2026-09/remediation/scripts/run-cases-after.py',
  'reports/public-mcp-audit-2026-09/remediation/scripts/aggregate-after.mjs',
  'reports/public-mcp-audit-2026-09/remediation/scripts/setup-after.py',
  'reports/public-mcp-audit-2026-09/remediation/scripts/recreate-stacks.sh',
];
const IO_V1 = join(FQ, 'scripts', 'io');
const IO_V1_DEFINING = ['cases.json', 'taskdesk_server.py', 'taskdesk_oracle_server.py', 'reset-taskdesk.sh', 'run-io.py'];
/** Frozen in the pre-registration commit. Each freeze covers every file under its directory except evidence/. */
const LATER_FREEZES = { benchmarkV2: join(RQ, 'v2'), ioV2: join(RQ, 'io-v2') };

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

function differing(now, frozen) {
  return [...new Set([...Object.keys(now), ...Object.keys(frozen)])].filter((file) => now[file] !== frozen[file]).sort();
}

/** The rule run-io.py applies before any independent-oracle case runs, repeated without importing it. */
function ioV1Freeze(problems) {
  const freeze = read(join(IO_V1, 'freeze.json'));
  const listed = (directory, suffix) =>
    existsSync(join(IO_V1, directory))
      ? readdirSync(join(IO_V1, directory)).filter((name) => name.endsWith(suffix)).sort().map((name) => `${directory}/${name}`)
      : [];
  const defining = [...IO_V1_DEFINING, ...listed('playbooks', '.json'), ...listed('specs', '.template.json')];
  const now = Object.fromEntries(defining.map((file) => [file, sha256(join(IO_V1, file))]));
  const mismatches = differing(now, freeze.files);
  if (mismatches.length > 0) problems.push(`independent-oracle v1 files differ from io/freeze.json: ${mismatches.join(', ')}`);
  return { freezeJsonSha256: sha256(join(IO_V1, 'freeze.json')), frozenAtHead: freeze.frozenAtHead, filesVerified: Object.keys(freeze.files).length, mismatches };
}

function laterFreeze(directory, problems) {
  const path = join(directory, 'freeze.json');
  if (!existsSync(path)) return { present: false };
  const walk = (current) =>
    readdirSync(current).flatMap((name) => {
      const full = join(current, name);
      const rel = relative(directory, full);
      if (rel === 'freeze.json' || rel === 'evidence' || name === '__pycache__') return [];
      return statSync(full).isDirectory() ? walk(full) : [rel];
    });
  const freeze = read(path);
  const now = Object.fromEntries(walk(directory).map((file) => [file, sha256(join(directory, file))]));
  const mismatches = differing(now, freeze.files ?? {});
  if (mismatches.length > 0) problems.push(`${relative(REPORT, directory)} differs from its freeze.json: ${mismatches.join(', ')}`);
  return { present: true, freezeJsonSha256: sha256(path), frozenAt: freeze.frozenAt, filesVerified: Object.keys(freeze.files ?? {}).length, mismatches };
}

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
    let actual;
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
    SCORING_FILES.map((file) => [file, { sha256: sha256(join(REPO, file)), committedUnmodified: gitOk('diff', '--quiet', 'HEAD', '--', file) }]),
  );
  for (const [file, entry] of Object.entries(scoring)) if (!entry.committedUnmodified) problems.push(`scoring file has uncommitted changes: ${file}`);

  return {
    baselineManifest: { path: 'remediation/baseline-manifest.json', sha256: sha256(join(REMEDIATION, 'baseline-manifest.json')), frozenAt: manifest.frozenAt, cases: manifest.cases.length, frozenFiles: Object.keys(manifest.frozenFiles).length },
    freezeBaselineCheck: freezeCheck,
    caseDefinitionsSha256: createHash('sha256').update(JSON.stringify(labels)).digest('hex'),
    trialCounts: { perCase: Object.fromEntries(manifest.cases.map((c) => [c.id, c.attempts])), totalAttempts: manifest.cases.reduce((n, c) => n + c.attempts, 0) },
    r1Cases: manifest.cases.filter((c) => c.rigorrunFindings.includes('R-1')).map((c) => c.id),
    heldoutWorktideV2: { freezeJsonSha256: sha256(join(v2Dir, 'freeze.json')), casesJsonSha256: sha256(join(v2Dir, 'cases.json')), frozenAt: v2Freeze.frozenAt, filesVerified: Object.keys(v2Freeze.files).length, mismatches: v2Mismatch },
    independentOracleV1: ioV1Freeze(problems),
    laterFreezes: Object.fromEntries(Object.entries(LATER_FREEZES).map(([key, directory]) => [key, laterFreeze(directory, problems)])),
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
  if (now.caseDefinitionsSha256 !== recorded.frozenInputs.caseDefinitionsSha256) problems.push('caseDefinitionsSha256 changed since the record');
  if (now.baselineManifest.sha256 !== recorded.frozenInputs.baselineManifest.sha256) problems.push('baseline-manifest.json changed since the record');
  if (now.heldoutWorktideV2.freezeJsonSha256 !== recorded.frozenInputs.heldoutWorktideV2.freezeJsonSha256) problems.push('heldout-worktide-v2/freeze.json changed since the record');
  if (now.independentOracleV1.freezeJsonSha256 !== recorded.frozenInputs.independentOracleV1.freezeJsonSha256) problems.push('io/freeze.json changed since the record');
  for (const [key, entry] of Object.entries(now.laterFreezes)) {
    const then = recorded.frozenInputs.laterFreezes[key];
    if (entry.present && !then?.present) problems.push(`${key} was frozen after this record was written: record the product under test again`);
    if (then?.present && entry.freezeJsonSha256 !== then.freezeJsonSha256) problems.push(`${key} freeze.json changed since the record`);
  }
  for (const [file, entry] of Object.entries(now.scoringRules)) if (entry.sha256 !== recorded.frozenInputs.scoringRules[file]?.sha256) problems.push(`scoring file changed since the record: ${file}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`DIFFERS: ${problem}`);
    process.exit(1);
  }
  console.log(`product under test verified: product sources equal ${recorded.productCommit.slice(0, 7)}; frozen inputs unchanged`);
  process.exit(0);
}

if (!productSourcesClean()) problems.push('product sources have uncommitted changes');
const head = git('rev-parse', 'HEAD');
const ancestors = (commits) => Object.fromEntries(commits.map((c) => [c, gitOk('merge-base', '--is-ancestor', c, head)]));
const stageA = { product: ancestors(STAGE_A_COMMITS.product), tests: ancestors(STAGE_A_COMMITS.tests) };
const n1 = ancestors(N1_COMMITS);
for (const [commit, present] of Object.entries({ ...stageA.product, ...stageA.tests, ...n1 })) if (!present) problems.push(`commit ${commit} is not an ancestor of HEAD`);
const inputs = frozenInputs(problems);
const record = {
  generatedBy: 'requalification/scripts/product-under-test.mjs',
  recordedAt: new Date().toISOString(),
  productCommit: head,
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  packageVersion: read(join(REPO, 'package.json')).version,
  productPathspec: PRODUCT_PATHSPEC,
  stageACommits: { ...STAGE_A_COMMITS, presentAsAncestors: stageA },
  n1Commits: { commits: N1_COMMITS, presentAsAncestors: n1 },
  lastProductCommit: git('log', '-1', '--format=%H %s', '--', ...PRODUCT_PATHSPEC),
  previousMeasurements: {
    finalQualification: { productCommit: FINAL_QUALIFICATION_PRODUCT, productSourcesEqualNow: gitOk('diff', '--quiet', FINAL_QUALIFICATION_PRODUCT, head, '--', ...PRODUCT_PATHSPEC) },
  },
  frozenInputs: inputs,
  problems,
};
writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n');
for (const problem of problems) console.error(`DIFFERS: ${problem}`);
const later = Object.entries(inputs.laterFreezes).map(([key, entry]) => `${key} ${entry.present ? 'frozen' : 'not yet frozen'}`).join(', ');
console.log(`${problems.length === 0 ? 'recorded' : 'NOT RECORDED CLEANLY'}: product ${head.slice(0, 7)} ${record.packageVersion}; manifest ${inputs.baselineManifest.cases} cases; IO v1 ${inputs.independentOracleV1.filesVerified} files; ${later}; targets ${Object.values(inputs.pinnedTargets).filter((t) => t.matches).length}/4 pinned`);
process.exit(problems.length === 0 ? 0 : 1);
