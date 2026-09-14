#!/usr/bin/env node
/**
 * The remediation's release gate, computed from generated evidence only.
 *
 *   node release-gate.mjs     # writes remediation/release-gate.json, prints every gate
 *
 * Exit 0 only when every gate passes. A gate whose evidence is missing FAILS:
 * nothing here assumes a result it cannot read.
 *
 * Evidence read: after-results.json (aggregate-after.mjs), heldout/results-*.json,
 * evidence/final-test.log (the full suite from a clean state), open-regressions.json
 * (maintained by hand, every entry with its evidence), freeze-baseline.mjs --check,
 * aggregate-after.mjs --check, and the git diff of production sources since the
 * audited commit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REMEDIATION = resolve(HERE, '..');
const REPO = resolve(REMEDIATION, '..', '..', '..');
const BASELINE = '07dda8c738d6daada161ffcf2bfc046b3c874ac5';
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

const after = read(join(REMEDIATION, 'after-results.json'));
// N-1 (appended): the in-process held-out set and the full suite were re-run at the N-1 commit into n1/evidence;
// the earlier records are kept where they were and used only when no re-run exists.
const inprocessRerun = read(join(REMEDIATION, 'n1', 'evidence', 'results-inprocess.json'));
const inprocess = inprocessRerun ?? read(join(REMEDIATION, 'heldout', 'results-inprocess.json'));
const external = read(join(REMEDIATION, 'heldout', 'results-external.json'));
const n1 = read(join(REMEDIATION, 'n1', 'after-fix.json'));
const v2 = read(join(REMEDIATION, 'heldout-worktide-v2', 'results.json'));
const openRegressions = read(join(REMEDIATION, 'open-regressions.json'));
const n1TestLogPath = join(REMEDIATION, 'n1', 'evidence', 'full-test.log');
const testLogPath = existsSync(n1TestLogPath) ? n1TestLogPath : join(REMEDIATION, 'evidence', 'final-test.log');
const testLog = existsSync(testLogPath) ? readFileSync(testLogPath, 'utf8') : '';

const gates = [];
const gate = (id, title, pass, evidence) => gates.push({ id, title, status: pass ? 'PASS' : 'FAIL', evidence });

function exitOf(file, args) {
  try {
    const out = execFileSync('node', [join(HERE, file), ...args], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: out.trim() };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() };
  }
}

// R-1
{
  const r1 = after?.cases?.filter((c) => c.rigorrunFindings.includes('R-1')) ?? [];
  const allRun = r1.length === 11 && r1.every((c) => c.attempts > 0);
  gate('R1', 'R-1: 0 reproductions across the original R-1 cases',
    Boolean(after) && allRun && after.R1_REPRODUCTIONS === 0 && after.R1_REPRODUCTIONS_ORIGINAL_RULE === 0,
    { cases: r1.length, allRun, reproductions: after?.R1_REPRODUCTIONS, reproductionsOriginalRule: after?.R1_REPRODUCTIONS_ORIGINAL_RULE,
      perCase: r1.map((c) => ({ id: c.id, oracle: c.oracleVerdicts, outcome: c.outcomeClassification, originalRule: c.classification })) });
}

// Known-good frozen cases
gate('FP', 'Known-good frozen cases: 0 false positives',
  Boolean(after) && after.FALSE_POSITIVES === 0 && after.ORIGINAL_RULE?.FALSE_POSITIVES === 0 && after.KNOWN_GOOD_TOTAL > 0 &&
    after.KNOWN_GOOD_CORRECTLY_GRADED === after.KNOWN_GOOD_TOTAL,
  { falsePositives: after?.FALSE_POSITIVES, falsePositivesOriginalRule: after?.ORIGINAL_RULE?.FALSE_POSITIVES,
    knownGood: after?.KNOWN_GOOD_TOTAL, knownGoodCorrect: after?.KNOWN_GOOD_CORRECTLY_GRADED, baselineKnownGoodNow: after?.BASELINE_KNOWN_GOOD_NOW });

// Injected failures
gate('INJECTED', 'Injected failures: every reachable injected failure correctly detected',
  Boolean(after) && after.INJECTED_FAILURES_REACHED > 0 && after.INJECTED_FAILURES_DETECTED === after.INJECTED_FAILURES_REACHED,
  { total: after?.INJECTED_FAILURES_TOTAL, observedByOracle: after?.INJECTED_FAILURES_OBSERVED_BY_ORACLE,
    reachedByRigorRun: after?.INJECTED_FAILURES_REACHED, detected: after?.INJECTED_FAILURES_DETECTED });

// R-8
{
  const w2 = after?.JOURNEYS?.['worktide-mcp/w2'];
  const w3 = after?.JOURNEYS?.['worktide-mcp/w3'];
  const past = (j) => Boolean(j?.compiled && j?.suiteBuilt);
  gate('R8', 'R-8: Worktide proceeds beyond the previous normalisation failure',
    past(w2) || past(w3),
    { w2: w2 && { compiled: w2.compiled, suiteBuilt: w2.suiteBuilt, entities: w2.schemaEntities, stage: w2.stage ?? null },
      w3: w3 && { compiled: w3.compiled, suiteBuilt: w3.suiteBuilt, entities: w3.schemaEntities, stage: w3.stage ?? null } });
}

// Tests
{
  const summary = /Tests\s+(\d+) passed \((\d+)\)/.exec(testLog);
  const failed = /Tests\s+\d+ failed/.test(testLog) || /Test Files\s+\d+ failed/.test(testLog);
  const passed = summary ? Number(summary[1]) : 0;
  const total = summary ? Number(summary[2]) : 0;
  gate('TESTS_ORIGINAL', 'Original RigorRun tests: 100% pass',
    Boolean(summary) && !failed && passed === total && total >= 847,
    { log: `remediation/${testLogPath.slice(REMEDIATION.length + 1)}`, passed, total, originalBaseline: 847 });
  const NEW = [
    'packages/connector/test/result.test.ts', 'packages/connector/test/rows.test.ts', 'packages/connector/test/environment.test.ts',
    'packages/runner/test/baseline.test.ts', 'packages/runner/test/outcomes.test.ts', 'packages/runner/test/honesty.test.ts',
    'packages/runner/test/expectedDelta.test.ts', 'packages/runner/test/retry.test.ts',
    'packages/daemon/test/jsonInText.test.ts', 'packages/daemon/test/stepChange.test.ts', 'packages/daemon/test/budgets.test.ts',
    'packages/daemon/test/suiteQualityOnRun.test.ts', 'packages/daemon/test/independentVerifier.test.ts',
    'packages/cli/test/budgets.test.ts', 'packages/cli/test/setup.test.ts', 'packages/cli/test/verifyFlags.test.ts',
    // N-1
    'packages/runner/test/aggregateIdentity.test.ts', 'packages/mcp/test/identity.test.ts', 'packages/verifier/test/stateChange.test.ts',
  ];
  const missing = NEW.filter((file) => !existsSync(join(REPO, file)));
  const unseen = NEW.filter((file) => !testLog.includes(file));
  gate('TESTS_NEW', 'New regression tests: 100% pass',
    Boolean(summary) && !failed && passed === total && missing.length === 0 && unseen.length === 0,
    { files: NEW.length, missing, notInLog: unseen });
}

// No target-specific logic in production code
{
  const diff = execFileSync('git', ['-C', REPO, 'diff', BASELINE, 'HEAD', '--', 'packages', 'apps'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const FORBIDDEN = /mailhog|greenmail|worktide|email-mcp|mcp-server-sqlite|\bsqlite\b|audit 17|quarterly report|example\.test|check_inbox|send_email|time\.(start|stop)|tasks\.search|\bp_[0-9a-f]{12}\b|\bEM-GMA?-\d|\bSQ-(W1B?|LLM|D)-\d|\bWT-D-\d/i;
  const hits = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(6);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (!/^(packages|apps)\/[^/]+\/src\//.test(file)) continue;
    if (FORBIDDEN.test(line)) hits.push({ file, line: line.slice(1).trim().slice(0, 200) });
  }
  gate('NO_TARGET_HACKS', 'No target-specific logic in production code', hits.length === 0,
    { scanned: `git diff ${BASELINE.slice(0, 7)} HEAD -- packages apps (added lines in */src/)`, hits });
}

// Labels
{
  const frozen = exitOf('freeze-baseline.mjs', ['--check']);
  gate('LABELS', 'No benchmark expected label altered', frozen.code === 0, { check: 'freeze-baseline.mjs --check', output: frozen.out });
}

// Prose metrics
{
  const prose = exitOf('aggregate-after.mjs', ['--check']);
  // N-1 (appended): N-1's numbers are checked the same way, against n1/results.json.
  const n1Prose = existsSync(join(REMEDIATION, 'n1', 'results.json')) ? exitOf('../n1/scripts/aggregate-n1.mjs', ['--check']) : null;
  gate('METRICS', 'Every prose metric matches after-results.json (and n1/results.json)', prose.code === 0 && (n1Prose === null || n1Prose.code === 0),
    { check: 'aggregate-after.mjs --check; n1/scripts/aggregate-n1.mjs --check', output: prose.out, n1Output: n1Prose?.out ?? 'no n1/results.json' });
}

// Regressions
// open-regressions.json: [{id, kind: 'regression' | 'newly_reachable_defect', serious, status: 'OPEN' | 'RESOLVED', summary, evidence}].
// Only a serious regression that is not RESOLVED fails this gate; a resolved one is listed with the measurement
// that shows it resolved, and a newly reachable defect is reported with it and in REMAINING RISKS.
gate('NO_NEW_REGRESSION', 'No serious new regression discovered',
  Array.isArray(openRegressions) &&
    openRegressions.filter((entry) => entry.kind === 'regression' && entry.serious && entry.status !== 'RESOLVED').length === 0,
  { file: 'remediation/open-regressions.json', present: Array.isArray(openRegressions), entries: openRegressions ?? null });

// N-1 (appended): EH-WT-03, the known-bad case the held-out gate failed on, re-run at the fixed commit.
const productSourcesAt = (commit) =>
  Boolean(commit) && (() => { try { execFileSync('git', ['-C', REPO, 'diff', '--quiet', commit, 'HEAD', '--', 'packages', 'apps', 'fixtures']); return true; } catch { return false; } })();
{
  const attempts = (n1?.attempts ?? []).filter((a) => a.id === 'EH-WT-03');
  const completed = attempts.filter((a) => a.actual === 'PASS' || a.actual === 'FAIL');
  const current = productSourcesAt(n1?.rigorrunCommit);
  gate('N1', 'N-1: EH-WT-03 never passes after the fix, and fails on at least three completed runs at the current product sources',
    Boolean(n1) && current && attempts.every((a) => a.actual !== 'PASS') && completed.filter((a) => a.actual === 'FAIL').length >= 3,
    { file: 'remediation/n1/after-fix.json', rigorrunCommit: n1?.rigorrunCommit ?? null, productSourcesMatchHead: current,
      attempts: attempts.map((a) => ({ attempt: a.attempt, actual: a.actual, oracle: a.oracle, unassignedMinutes: a.oracleState?.unassignedMinutes })) });
}

// N-1 (appended): the new Worktide held-out set, frozen before its first run.
{
  const v2Dir = join(REMEDIATION, 'heldout-worktide-v2');
  const freeze = read(join(v2Dir, 'freeze.json'));
  const defined = read(join(v2Dir, 'cases.json')) ?? [];
  const recorded = new Set((v2?.cases ?? []).map((c) => c.id));
  const frozenBeforeRun = Boolean(freeze && v2) && (() => { try { execFileSync('git', ['-C', REPO, 'merge-base', '--is-ancestor', freeze.frozenAt, v2.rigorrunCommit]); return true; } catch { return false; } })();
  const gated = ['gate', 'side-channel'].filter((block) => defined.some((c) => c.block === block));
  const blocksPass = gated.every((block) => v2?.blocks?.[block]?.passes === true);
  gate('HELDOUT_WORKTIDE_V2', 'Worktide v2 held-out: frozen before running; no known-good FAIL and no known-bad PASS in the gated blocks; every case run',
    Boolean(v2) && frozenBeforeRun && productSourcesAt(v2?.rigorrunCommit) && defined.length > 0 && defined.every((c) => recorded.has(c.id)) && blocksPass,
    { file: 'remediation/heldout-worktide-v2/results.json', frozenAt: freeze?.frozenAt ?? null, rigorrunCommit: v2?.rigorrunCommit ?? null, frozenBeforeRun,
      blocks: v2?.blocks ?? null, gatedBlocks: gated,
      knownBadPassed: (v2?.cases ?? []).filter((c) => c.block !== 'limit-probe' && c.truth === 'KNOWN_BAD' && c.actual === 'PASS').map((c) => c.id),
      knownGoodFailed: (v2?.cases ?? []).filter((c) => c.block !== 'limit-probe' && c.truth === 'KNOWN_GOOD' && c.actual === 'FAIL').map((c) => c.id),
      limitProbes: (v2?.cases ?? []).filter((c) => c.block === 'limit-probe').map((c) => ({ id: c.id, truth: c.truth, actual: c.actual, oracle: c.oracle })),
      notRun: defined.filter((c) => !recorded.has(c.id)).map((c) => c.id) });
}

// Held-out
{
  // N-1 (appended): the external EH-WT-03 record, measured before the fix, is superseded by its N-1 re-runs.
  // It stays listed; the gate reads the re-runs, never a relabelled case.
  const rerun = (n1?.attempts ?? []).filter((a) => a.id === 'EH-WT-03');
  const superseded = rerun.length > 0 ? (external?.cases ?? []).filter((c) => c.id === 'EH-WT-03') : [];
  const externalCases = (external?.cases ?? []).flatMap((c) =>
    c.id === 'EH-WT-03' && rerun.length > 0
      ? rerun.map((a) => ({ ...c, actual: a.actual, oracle: a.oracle, truthHeldByOracle: a.truthHeldByOracle, attempt: a.attempt, supersededRecord: true }))
      : [c]);
  const cases = [...(inprocess?.cases ?? []).map((c) => ({ ...c, set: 'in-process', oracle: c.truth === 'KNOWN_GOOD' ? 'PASS' : c.truth === 'KNOWN_BAD' ? 'FAIL' : null })),
    ...externalCases.map((c) => ({ ...c, set: 'external' }))];
  // Strict: the truth label decides, whatever the oracle said. A case whose oracle
  // contradicts its label is listed on its own and never relabelled.
  const goodFailed = cases.filter((c) => c.truth === 'KNOWN_GOOD' && c.actual === 'FAIL');
  const badPassed = cases.filter((c) => c.truth === 'KNOWN_BAD' && c.actual === 'PASS');
  const undecidedVerdicts = cases.filter((c) => ['UNDECIDABLE', 'NOT_FINISHED'].includes(c.truth) && (c.actual === 'PASS' || c.actual === 'FAIL'));
  // A defined case with no record at all has not run either: every case in
  // external/cases.json must appear in results-external.json with a run.
  const definedPath = join(REMEDIATION, 'heldout', 'external', 'cases.json');
  const defined = existsSync(definedPath) ? JSON.parse(readFileSync(definedPath, 'utf8')).map((c) => c.id) : [];
  const recorded = new Set((external?.cases ?? []).map((c) => c.id));
  const unrecorded = defined.filter((id) => !recorded.has(id)).map((id) => ({ id, set: 'external', actual: 'NOT_RUN' }));
  const notRun = [...cases.filter((c) => c.actual === 'NOT_RUN'), ...unrecorded];
  // A re-run whose oracle contradicts the label did not stage the case (the duplicate never happened); it is listed, not scored.
  const oracleDisagrees = cases.filter((c) => c.truthHeldByOracle === false);
  gate('HELDOUT', 'Held-out: no known-good case failed; no known-bad case passed; every case run',
    Boolean(inprocess) && Boolean(external) && defined.length > 0 && goodFailed.length === 0 && badPassed.length === 0 && undecidedVerdicts.length === 0 && notRun.length === 0,
    { inProcess: inprocess?.totals ?? null, inProcessSource: inprocessRerun ? 'remediation/n1/evidence/results-inprocess.json' : 'remediation/heldout/results-inprocess.json',
      external: external?.totals ?? null,
      supersededByN1: superseded.map((c) => ({ id: c.id, actual: c.actual, oracle: c.oracle, measuredAt: external?.rigorrunCommit })),
      knownGoodFailed: goodFailed.map((c) => `${c.set}:${c.id}`), knownBadPassed: badPassed.map((c) => `${c.set}:${c.id}`),
      undecidableGivenAVerdict: undecidedVerdicts.map((c) => `${c.set}:${c.id}`), notRun: notRun.map((c) => `${c.set}:${c.id}`),
      oracleContradictsTruthLabel: oracleDisagrees.map((c) => `${c.set}:${c.id}`) });
}

const passed = gates.every((entry) => entry.status === 'PASS');
const report = { generatedBy: 'remediation/scripts/release-gate.mjs', verdict: passed ? 'ALL GATES PASS' : 'REMEDIATION INCOMPLETE', gates };
writeFileSync(join(REMEDIATION, 'release-gate.json'), JSON.stringify(report, null, 2) + '\n');
for (const entry of gates) console.log(`${entry.status.padEnd(4)}  ${entry.id.padEnd(18)} ${entry.title}`);
console.log(report.verdict);
process.exit(passed ? 0 : 1);
