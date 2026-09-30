#!/usr/bin/env node
/**
 * benchmark-v1's numbers at the requalification's product under test, generated from its evidence only.
 * benchmark-v1 is reported beside benchmark-v2; no release gate reads it.
 *
 *   node aggregate-v1.mjs          # writes requalification/results-v1.json
 *   node aggregate-v1.mjs --check  # regenerates, compares, and checks every
 *                                  # <!-- v1:KEY -->value<!-- /v1 --> in requalification/*.md
 *
 * A copy of final-qualification/scripts/aggregate-final.mjs (last committed in a011a64).
 * The frozen-58 scoring (buildCase, totals, R-1) is unchanged. Differences:
 *   - Paths:
 *       run evidence   v1/evidence/frozen-58/run
 *       refused cases  v1/evidence/frozen-58/not-run.json
 *       local-model    v1/evidence/local-model/<case>/blocked.json
 *       product        requalification/product-under-test.json
 *       output         requalification/results-v1.json
 *       prose markers  v1:
 *   - Sections:
 *       - no GreenMail happy-path diagnostic: benchmark-v2 scores those suites in full;
 *       - no N-1 or cross-regression section: benchmark-v2's release gate reads that evidence;
 *       - independentOracle   v1/evidence/independent-oracle
 *       - heldoutInprocess    n1/evidence/heldout-inprocess
 *       - mcpPreflight        mcp/evidence/mcp-preflight
 *       - checks.final        evidence/final
 *   - Added: setupRecovery. It reports run/agent-reregistration.json and the attempts kept
 *     under run/evidence-not-run-agent-unregistered/, so the recovery stays visible beside
 *     the re-run it enabled.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const V1 = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const RQ = resolve(V1, '..');
const REPORT = resolve(RQ, '..');
const REMEDIATION = join(REPORT, 'remediation');
const RUN = join(V1, 'evidence', 'frozen-58', 'run');
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const text = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const uniq = (xs) => [...new Set(xs)];
const SCORED = ['TRUE_POSITIVE', 'TRUE_NEGATIVE', 'FALSE_POSITIVE', 'FALSE_NEGATIVE'];

const manifest = read(join(REMEDIATION, 'baseline-manifest.json'));
const product = read(join(RQ, 'product-under-test.json'));
const runInfo = read(join(RUN, 'run-info.json'));
const after2 = read(join(REMEDIATION, 'after-results.json'));
const after1 = read(join(REMEDIATION, 'after-1-results.json'));
// Cases the frozen protocol refused to run, with the recorded reason (v1/evidence/frozen-58/not-run.json).
const refused = read(join(V1, 'evidence', 'frozen-58', 'not-run.json'))?.cases ?? {};

function consensus(values) {
  const set = uniq(values);
  return set.length === 1 ? set[0] : set.length === 0 ? 'NOT_RUN' : 'INCONSISTENT';
}

function attemptsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => d.startsWith('attempt-') && existsSync(join(dir, d, 'attempt.json')))
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
    .map((d) => read(join(dir, d, 'attempt.json')));
}

function attemptsOf(runDir, target, id) {
  return attemptsIn(join(runDir, 'evidence', target, id));
}

function happy(attempt) {
  const all = attempt.result?.rigorrun?.cases ?? [];
  const chosen = all.filter((c) => c.category === 'happy_path');
  return chosen.length > 0 ? chosen : all;
}

function previousOf(frozen) {
  for (const [source, results] of [['AFTER-2', after2], ['AFTER-1', after1]]) {
    const c = results?.cases?.find((x) => x.id === frozen.id);
    if (c && c.attempts > 0) {
      return { source, rigorrunCommit: results.rigorrun_commit, attempts: c.attempts, oracleVerdicts: c.oracleVerdicts, rigorrunOutcomes: c.rigorrunOutcomes, classification: c.classification, outcomeClassification: c.outcomeClassification };
    }
  }
  return { source: 'BASELINE', rigorrunCommit: manifest.rigorrun.commit, attempts: frozen.originalOracleVerdicts?.length ?? null, oracleVerdicts: uniq(frozen.originalOracleVerdicts ?? []), rigorrunOutcomes: null, classification: frozen.classification, outcomeClassification: null };
}

function buildCase(frozen, runDir) {
  const attempts = attemptsOf(runDir, frozen.target, frozen.id);
  const perAttempt = attempts.map((a) => {
    const rr = happy(a)[0] ?? null;
    return {
      attempt: a.attempt,
      seconds: a.seconds,
      oracleVerdict: a.oracleVerdict,
      rigorrunVerdict: a.rigorrunVerdict,
      rigorrunOutcome: a.rigorrunOutcome,
      classification: a.classification,
      outcomeClassification: a.outcomeClassification,
      verification: rr?.verification ?? null,
      evidenceIndependence: rr?.evidenceIndependence ?? null,
      baseline: rr?.baseline ?? null,
      budgetMs: rr?.budgetMs ?? null,
      durationMs: rr?.durationMs ?? null,
      outcomeReason: rr?.outcomeReason ?? null,
      missingEvidence: rr?.missingEvidence ?? [],
      exit: a.result?.rigorrun?.exit ?? null,
    };
  });
  const summary = read(join(runDir, 'evidence', frozen.target, frozen.id, 'summary.json'));
  const blocked = read(join(V1, 'evidence', 'local-model', frozen.id, 'blocked.json'));
  const rigorrun = frozen.mode === 'rigorrun';
  const status = attempts.length === 0
    ? 'NOT_RUN'
    : rigorrun ? consensus(perAttempt.map((a) => a.rigorrunOutcome)) : 'DIRECT_PROBE_NOT_SCORED';
  return {
    id: frozen.id,
    target: frozen.target,
    mode: frozen.mode,
    truthLabel: frozen.truthLabel,
    injected: frozen.injected,
    r1: frozen.rigorrunFindings.includes('R-1'),
    rigorrunFindings: frozen.rigorrunFindings,
    attemptsPlanned: frozen.attempts,
    attempts: attempts.length,
    status,
    notRunReason: attempts.length > 0 ? null : refused[frozen.id] ?? (blocked ? 'BLOCKED_BY_HOST_RESOURCES' : summary?.notRun ?? 'no evidence was written for this case'),
    oracleVerdicts: uniq(perAttempt.map((a) => a.oracleVerdict)),
    rigorrunOutcomes: uniq(perAttempt.map((a) => a.rigorrunOutcome)),
    classification: consensus(perAttempt.map((a) => a.classification)),
    outcomeClassification: consensus(perAttempt.map((a) => a.outcomeClassification)),
    verificationStrength: rigorrun ? uniq(perAttempt.map((a) => a.verification).filter(Boolean)) : [frozen.verificationStrength].filter(Boolean),
    evidenceIndependence: uniq(perAttempt.map((a) => a.evidenceIndependence).filter(Boolean)),
    totalSeconds: Math.round(perAttempt.reduce((n, a) => n + (a.seconds ?? 0), 0) * 100) / 100,
    perAttempt,
    previous: previousOf(frozen),
  };
}
const cases = manifest.cases.map((frozen) => buildCase(frozen, RUN));

function totals(list) {
  const rr = list.filter((c) => c.mode === 'rigorrun');
  const rrRun = rr.filter((c) => c.attempts > 0);
  const byOutcome = (k) => rrRun.filter((c) => c.outcomeClassification === k).length;
  const byOriginal = (k) => rrRun.filter((c) => c.classification === k).length;
  const rrAttempts = rrRun.flatMap((c) => c.perAttempt.map((a) => ({ ...a, id: c.id, injected: c.injected })));
  const attemptsBy = (k) => rrAttempts.filter((a) => a.outcomeClassification === k).length;
  const knownGoodAttempts = rrAttempts.filter((a) => a.oracleVerdict === 'PASS');
  const knownBadAttempts = rrAttempts.filter((a) => a.oracleVerdict === 'FAIL');
  const injectedCases = list.filter((c) => c.injected);
  const injectedReachable = rrAttempts.filter((a) => a.injected && a.oracleVerdict === 'FAIL');
  return {
    TOTAL_CASES: list.length,
    CASES_RUN: list.filter((c) => c.attempts > 0).length,
    CASES_WITH_PLANNED_ATTEMPTS: list.filter((c) => c.attempts >= c.attemptsPlanned).length,
    NOT_RUN: list.filter((c) => c.attempts === 0).length,
    ATTEMPTS_PLANNED: list.reduce((n, c) => n + c.attemptsPlanned, 0),
    ATTEMPTS_RUN: list.reduce((n, c) => n + c.attempts, 0),
    DIRECT_PROBE_CASES_RUN: list.filter((c) => c.mode !== 'rigorrun' && c.attempts > 0).length,
    RIGORRUN_MODE_CASES: rr.length,
    RIGORRUN_MODE_CASES_RUN: rrRun.length,
    TP: byOutcome('TRUE_POSITIVE'),
    TN: byOutcome('TRUE_NEGATIVE'),
    FP: byOutcome('FALSE_POSITIVE'),
    FN: byOutcome('FALSE_NEGATIVE'),
    ABSTAIN: byOutcome('NOT_SCORED_ABSTAIN'),
    TIMED_OUT: byOutcome('TIMED_OUT'),
    AGENT_FAILURE: byOutcome('AGENT_FAILURE'),
    HARNESS_FAILURE: byOutcome('NOT_SCORED_HARNESS_FAILURE'),
    UNKNOWN: byOutcome('NOT_SCORED_UNKNOWN') + byOutcome('NOT_SCORED_NOT_RUN'),
    INCONSISTENT: byOutcome('INCONSISTENT'),
    RIGORRUN_MODE_NOT_RUN: rr.length - rrRun.length,
    ORIGINAL_RULE: {
      TP: byOriginal('TRUE_POSITIVE'),
      TN: byOriginal('TRUE_NEGATIVE'),
      FP: byOriginal('FALSE_POSITIVE'),
      FN: byOriginal('FALSE_NEGATIVE'),
      INCONSISTENT: byOriginal('INCONSISTENT'),
    },
    ATTEMPT_LEVEL: {
      attempts: rrAttempts.length,
      TP: attemptsBy('TRUE_POSITIVE'),
      TN: attemptsBy('TRUE_NEGATIVE'),
      FP: attemptsBy('FALSE_POSITIVE'),
      FN: attemptsBy('FALSE_NEGATIVE'),
      ABSTAIN: attemptsBy('NOT_SCORED_ABSTAIN'),
      TIMED_OUT: attemptsBy('TIMED_OUT'),
      AGENT_FAILURE: attemptsBy('AGENT_FAILURE'),
      HARNESS_FAILURE: attemptsBy('NOT_SCORED_HARNESS_FAILURE'),
      ORIGINAL_RULE_FP: rrAttempts.filter((a) => a.classification === 'FALSE_POSITIVE').length,
      ORIGINAL_RULE_FN: rrAttempts.filter((a) => a.classification === 'FALSE_NEGATIVE').length,
    },
    KNOWN_GOOD: {
      cases: uniq(knownGoodAttempts.map((a) => a.id)).length,
      attempts: knownGoodAttempts.length,
      attemptsGradedTrueNegativeBothRules: knownGoodAttempts.filter((a) => a.outcomeClassification === 'TRUE_NEGATIVE' && a.classification === 'TRUE_NEGATIVE').length,
      notGradedTrueNegative: knownGoodAttempts.filter((a) => !(a.outcomeClassification === 'TRUE_NEGATIVE' && a.classification === 'TRUE_NEGATIVE')).map((a) => ({ id: a.id, attempt: a.attempt, outcome: a.rigorrunOutcome, outcomeClassification: a.outcomeClassification, classification: a.classification })),
    },
    KNOWN_BAD: {
      cases: uniq(knownBadAttempts.map((a) => a.id)).length,
      attempts: knownBadAttempts.length,
      attemptsGivenPass: knownBadAttempts.filter((a) => a.rigorrunOutcome === 'PASS' || a.rigorrunVerdict === 'PASS').map((a) => ({ id: a.id, attempt: a.attempt, outcome: a.rigorrunOutcome, verdict: a.rigorrunVerdict })),
    },
    INJECTED: {
      cases: injectedCases.length,
      casesRun: injectedCases.filter((c) => c.attempts > 0).length,
      observedByOracle: injectedCases.filter((c) => c.oracleVerdicts.length === 1 && c.oracleVerdicts[0] === 'FAIL').length,
      reachableAttempts: injectedReachable.length,
      reachableCases: uniq(injectedReachable.map((a) => a.id)),
      detectedAttempts: injectedReachable.filter((a) => a.outcomeClassification === 'TRUE_POSITIVE').length,
    },
  };
}

const r1Of = (list) => {
  const r1Cases = list.filter((c) => c.r1);
  return {
  cases: r1Cases.length,
  casesRun: r1Cases.filter((c) => c.attempts > 0).length,
  reproductions: r1Cases.filter((c) => c.perAttempt.some((a) => ['FALSE_POSITIVE', 'FALSE_NEGATIVE'].includes(a.outcomeClassification) || ['FALSE_POSITIVE', 'FALSE_NEGATIVE'].includes(a.classification))).length,
  casesWithoutVerdict: r1Cases.filter((c) => c.attempts === 0 || c.perAttempt.some((a) => !SCORED.includes(a.outcomeClassification))).map((c) => c.id),
  perCase: r1Cases.map((c) => ({ id: c.id, attempts: c.attempts, oracle: c.oracleVerdicts, outcome: c.outcomeClassification, originalRule: c.classification, status: c.status })),
  };
};
const r1 = r1Of(cases);

// The one setup recovery: an agent registration that failed on a port collision, re-made before its case was re-run.
const KEPT = join(RUN, 'evidence-not-run-agent-unregistered');
const recovery = read(join(RUN, 'agent-reregistration.json'));
const setupRecovery = recovery || existsSync(KEPT) ? {
  reregistration: recovery,
  keptNotRunAttempts: manifest.cases
    .filter((frozen) => existsSync(join(KEPT, frozen.target, frozen.id)))
    .map((frozen) => ({
      id: frozen.id,
      attempts: attemptsIn(join(KEPT, frozen.target, frozen.id)).map((a) => ({ attempt: a.attempt, rigorrunVerdict: a.rigorrunVerdict, outcomeClassification: a.outcomeClassification, error: a.result?.rigorrun?.error?.trim() ?? null })),
    })),
} : null;

// ---- other sections, each null until its evidence exists
function suite(log) {
  if (log === null) return null;
  // vitest prints only the parts that are non-zero, e.g. "Tests  1007 passed | 10 skipped (1017)" or "Tests  2 failed | 1015 passed (1017)".
  const line = (label) => {
    const m = new RegExp(`${label}\\s+([^\\n]*?)\\((\\d+)\\)`).exec(log);
    if (!m) return null;
    const part = (word) => Number(new RegExp(`(\\d+) ${word}`).exec(m[1])?.[1] ?? 0);
    return { failed: part('failed'), passed: part('passed'), skipped: part('skipped'), total: Number(m[2]) };
  };
  const tests = line('Tests');
  const files = line('Test Files');
  if (!tests) return { parsed: false };
  return { parsed: true, ...tests, files: files?.total ?? null, filesFailed: files?.failed ?? null };
}

function exitOf(log) {
  if (log === null) return null;
  const m = /exit (\d+)\s*$/.exec(log.trim());
  return m ? Number(m[1]) : null;
}

function checks(dir) {
  const base = join(RQ, 'evidence', dir);
  if (!existsSync(base)) return null;
  const playwright = (log) => {
    if (log === null) return null;
    const passed = /(\d+) passed/.exec(log);
    const failed = /(\d+) failed/.exec(log);
    const flaky = /(\d+) flaky/.exec(log);
    return { passed: passed ? Number(passed[1]) : 0, failed: failed ? Number(failed[1]) : 0, flaky: flaky ? Number(flaky[1]) : 0, exit: exitOf(log) };
  };
  return {
    test: (() => { const log = text(join(base, 'test.log')); return log === null ? null : { ...suite(log), exit: exitOf(log) }; })(),
    typecheck: (() => { const log = text(join(base, 'typecheck.log')); return log === null ? null : { exit: exitOf(log) }; })(),
    lint: (() => { const log = text(join(base, 'lint.log')); return log === null ? null : { exit: exitOf(log), files: Number(/linted (\d+) file/.exec(log)?.[1] ?? NaN) || null }; })(),
    e2e: playwright(text(join(base, 'e2e.log'))),
  };
}

const inprocess = read(join(RQ, 'n1', 'evidence', 'heldout-inprocess', 'results.json'));
const io = read(join(V1, 'evidence', 'independent-oracle', 'results.json'));
const preflight = read(join(RQ, 'mcp', 'evidence', 'mcp-preflight', 'summary.json'));

const results = {
  generatedBy: 'requalification/v1/scripts/aggregate-v1.mjs',
  productCommit: product?.productCommit ?? null,
  packageVersion: product?.packageVersion ?? null,
  frozen58: {
    runCommit: runInfo?.rigorrunCommit ?? null,
    ...totals(cases),
    R1: r1,
    PER_TARGET: Object.fromEntries(['email-mcp', 'worktide-mcp', 'sqlite-mcp'].map((t) => [t, totals(cases.filter((c) => c.target === t))])),
    NOT_RUN_CASES: cases.filter((c) => c.attempts === 0).map((c) => ({ id: c.id, reason: c.notRunReason })),
    setupRecovery,
    cases: Object.fromEntries(cases.map((c) => [c.id, c])),
  },
  heldoutInprocess: inprocess ? { rigorrunCommit: inprocess.rigorrunCommit, ...inprocess.totals } : null,
  independentOracle: io?.summary ?? null,
  mcpPreflight: preflight ?? null,
  checks: { final: checks('final') },
};

const out = join(RQ, 'results-v1.json');
if (process.argv.includes('--check')) {
  const expected = JSON.stringify(results, null, 2);
  const actual = text(out) ?? '';
  if (actual.trim() !== expected.trim()) {
    console.error('results-v1.json is stale: regenerate with node requalification/v1/scripts/aggregate-v1.mjs');
    process.exit(1);
  }
  const flat = {};
  const walk = (value, path) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    else flat[path] = Array.isArray(value) ? value.join(', ') : value;
  };
  walk(results, '');
  let checked = 0;
  let bad = 0;
  for (const file of readdirSync(RQ).filter((name) => name.endsWith('.md'))) {
    for (const m of readFileSync(join(RQ, file), 'utf8').matchAll(/<!-- v1:([^ ]+) -->([^<]*)<!-- \/v1 -->/g)) {
      checked += 1;
      if (flat[m[1]] === undefined || String(flat[m[1]]) !== m[2].trim()) {
        bad += 1;
        console.error(`${file}: ${m[1]} is "${m[2].trim()}" in prose, ${flat[m[1]]} in results-v1.json`);
      }
    }
  }
  console.log(`results-v1.json verified; ${checked} numbers checked in prose, ${bad} mismatches`);
  process.exit(bad ? 1 : 0);
}
writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
const t = results.frozen58;
console.log(`results-v1.json written: frozen 58 run ${t.CASES_RUN}/${t.TOTAL_CASES}; TP ${t.TP} TN ${t.TN} FP ${t.FP} FN ${t.FN} ABSTAIN ${t.ABSTAIN} TIMED_OUT ${t.TIMED_OUT} HARNESS_FAILURE ${t.HARNESS_FAILURE} NOT_RUN ${t.NOT_RUN}; R-1 ${r1.casesRun}/${r1.cases} run, ${r1.reproductions} reproductions`);
