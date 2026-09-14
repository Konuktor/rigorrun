#!/usr/bin/env node
/**
 * Builds remediation/after-results.json from the AFTER run, and checks the
 * before/after prose against it.
 *
 * Inputs, all generated: baseline-manifest.json (frozen labels and baseline
 * results), after/evidence/<target>/<case>/attempt-N/attempt.json (written by
 * run-cases-after.py), after/journeys.json (setup-after.py), and
 * findings-status.json (per-finding status with the evidence it rests on).
 *
 * Two classifications are carried for every RigorRun-mode case:
 * - `originalRule`: the audit's scoring rule (taskSuccess ∧ policyCompliant ∧
 *   no unsafe actions), so before and after are scored identically;
 * - `outcome`: the verdict RigorRun now reports. ABSTAIN and HARNESS_FAILURE
 *   are not verdicts; TIMED_OUT and AGENT_FAILURE are reported on their own and
 *   never counted as a detection. This is the headline.
 *
 *   node aggregate-after.mjs          # write after-results.json
 *   node aggregate-after.mjs --check  # regenerate, compare, and check <!-- n:key --> numbers in before-after.md
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REMEDIATION = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// AFTER_RUN names the run directory: `after` (the current measurement) or a
// superseded run kept for the record, e.g. `after-1`. Each has its own results
// file and its own prose markers, so both stay checkable.
const RUN = process.env.AFTER_RUN ?? 'after';
if (!/^after(-\d+)?$/.test(RUN)) throw new Error(`AFTER_RUN must be after or after-N, not ${RUN}`);
const AFTER = join(REMEDIATION, RUN);
const TAG = RUN === 'after' ? 'n' : `n-${RUN}`;
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = read(join(REMEDIATION, 'baseline-manifest.json'));
const journeys = existsSync(join(AFTER, 'journeys.json')) ? read(join(AFTER, 'journeys.json')) : {};
const findingStatus = RUN === 'after' && existsSync(join(REMEDIATION, 'findings-status.json')) ? read(join(REMEDIATION, 'findings-status.json')) : {};
const uniq = (xs) => [...new Set(xs)];
const SCORED = ['TRUE_POSITIVE', 'TRUE_NEGATIVE', 'FALSE_POSITIVE', 'FALSE_NEGATIVE'];

function attemptsOf(target, id) {
  const dir = join(AFTER, 'evidence', target, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => d.startsWith('attempt-') && existsSync(join(dir, d, 'attempt.json')))
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
    .map((d) => read(join(dir, d, 'attempt.json')));
}

function consensus(values) {
  const set = uniq(values);
  return set.length === 1 ? set[0] : set.length === 0 ? 'NOT_RUN' : 'INCONSISTENT';
}

const cases = manifest.cases.map((frozen) => {
  const attempts = attemptsOf(frozen.target, frozen.id);
  const happy = (a) => {
    const all = a.result?.rigorrun?.cases ?? [];
    return all.filter((c) => c.category === 'happy_path').length > 0 ? all.filter((c) => c.category === 'happy_path') : all;
  };
  const rr = attempts.flatMap(happy);
  return {
    id: frozen.id,
    target: frozen.target,
    mode: frozen.mode,
    class: frozen.class,
    truthLabel: frozen.truthLabel,
    injected: frozen.injected,
    rigorrunFindings: frozen.rigorrunFindings,
    attemptsPlanned: frozen.attempts,
    attempts: attempts.length,
    oracleVerdicts: uniq(attempts.map((a) => a.oracleVerdict)),
    rigorrunVerdicts: uniq(attempts.map((a) => a.rigorrunVerdict)),
    rigorrunOutcomes: uniq(attempts.map((a) => a.rigorrunOutcome)),
    classification: consensus(attempts.map((a) => a.classification)),
    outcomeClassification: consensus(attempts.map((a) => a.outcomeClassification)),
    verification: uniq(rr.map((c) => c.verification).filter(Boolean)),
    evidenceIndependence: uniq(rr.map((c) => c.evidenceIndependence).filter(Boolean)),
    baseline: uniq(rr.map((c) => c.baseline).filter(Boolean)),
    budgetMs: uniq(rr.map((c) => c.budgetMs).filter((x) => x !== undefined && x !== null)),
    outcomeReasons: uniq(rr.map((c) => c.outcomeReason).filter(Boolean)).slice(0, 3),
    missingEvidence: uniq(rr.flatMap((c) => c.missingEvidence ?? [])),
    reproduction: existsSync(join(AFTER, 'evidence', frozen.target, frozen.id, 'summary.json'))
      ? read(join(AFTER, 'evidence', frozen.target, frozen.id, 'summary.json')).reproduction ?? null
      : null,
    notRun: existsSync(join(AFTER, 'evidence', frozen.target, frozen.id, 'summary.json'))
      ? read(join(AFTER, 'evidence', frozen.target, frozen.id, 'summary.json')).notRun ?? null
      : 'no evidence was written for this case',
    before: {
      oracleVerdicts: frozen.originalOracleVerdicts,
      rigorrunVerdicts: frozen.originalRigorrunVerdicts,
      classification: frozen.classification,
    },
  };
});

function totals(list) {
  const rigorrunAll = list.filter((c) => c.mode === 'rigorrun');
  const rigorrun = rigorrunAll.filter((c) => c.attempts > 0);
  const byOutcome = (k) => rigorrun.filter((c) => c.outcomeClassification === k).length;
  const byOriginal = (k) => rigorrun.filter((c) => c.classification === k).length;
  const knownGood = rigorrun.filter((c) => c.oracleVerdicts.length === 1 && c.oracleVerdicts[0] === 'PASS');
  const injected = list.filter((c) => c.injected && c.attempts > 0);
  const injectedReachable = injected.filter((c) => c.mode === 'rigorrun' && c.oracleVerdicts.length === 1 && c.oracleVerdicts[0] === 'FAIL');
  return {
    // Every frozen case counts, run or not: a case that could not run is
    // reported as such, never quietly removed from the denominator.
    TOTAL_CASES: list.length,
    CASES_RUN: list.filter((c) => c.attempts > 0).length,
    RIGORRUN_MODE_CASES: rigorrunAll.length,
    RIGORRUN_MODE_CASES_RUN: rigorrun.length,
    SCORED_CASES: rigorrun.filter((c) => SCORED.includes(c.outcomeClassification)).length,
    ABSTENTIONS:
      rigorrun.filter((c) => c.outcomeClassification.startsWith('NOT_SCORED_ABSTAIN') || c.outcomeClassification.startsWith('NOT_SCORED_HARNESS')).length +
      rigorrunAll.filter((c) => c.attempts === 0).length,
    NOT_RUN_CASES: rigorrunAll.filter((c) => c.attempts === 0).map((c) => ({ id: c.id, reason: c.notRun })),
    NOT_REACHING_VERDICT: rigorrunAll.filter((c) => !SCORED.includes(c.outcomeClassification)).length,
    INCONSISTENT_ACROSS_ATTEMPTS: rigorrun.filter((c) => c.outcomeClassification === 'INCONSISTENT' || c.classification === 'INCONSISTENT').length,
    TRUE_POSITIVES: byOutcome('TRUE_POSITIVE'),
    TRUE_NEGATIVES: byOutcome('TRUE_NEGATIVE'),
    FALSE_POSITIVES: byOutcome('FALSE_POSITIVE'),
    FALSE_NEGATIVES: byOutcome('FALSE_NEGATIVE'),
    ORIGINAL_RULE: {
      TRUE_POSITIVES: byOriginal('TRUE_POSITIVE'),
      TRUE_NEGATIVES: byOriginal('TRUE_NEGATIVE'),
      FALSE_POSITIVES: byOriginal('FALSE_POSITIVE'),
      FALSE_NEGATIVES: byOriginal('FALSE_NEGATIVE'),
    },
    INJECTED_FAILURES_TOTAL: injected.length,
    INJECTED_FAILURES_OBSERVED_BY_ORACLE: injected.filter((c) => c.oracleVerdicts.length === 1 && c.oracleVerdicts[0] === 'FAIL').length,
    INJECTED_FAILURES_REACHED: injectedReachable.length,
    INJECTED_FAILURES_DETECTED: injectedReachable.filter((c) => c.outcomeClassification === 'TRUE_POSITIVE').length,
    KNOWN_GOOD_TOTAL: knownGood.length,
    KNOWN_GOOD_CORRECTLY_GRADED: knownGood.filter((c) => c.outcomeClassification === 'TRUE_NEGATIVE').length,
  };
}

const r1 = cases.filter((c) => c.rigorrunFindings.includes('R-1'));
const statuses = Object.values(findingStatus).map((f) => f.status);
const rigorrunAttemptCases = cases.filter((c) => c.mode === 'rigorrun' && c.attempts > 0);
const count = (list, key) => Object.fromEntries(uniq(list.flatMap((c) => c[key])).sort().map((k) => [k, list.filter((c) => c[key].includes(k)).length]));

const results = {
  generated_by: 'remediation/scripts/aggregate-after.mjs',
  rigorrun_commit: process.env.RIGORRUN_AFTER_COMMIT ?? null,
  baseline: { commit: manifest.rigorrun.commit, totals: manifest.originalTotals },
  ...totals(cases),
  R1_CASES: r1.length,
  R1_REPRODUCTIONS: r1.filter((c) => ['FALSE_POSITIVE', 'FALSE_NEGATIVE'].includes(c.outcomeClassification)).length,
  R1_REPRODUCTIONS_ORIGINAL_RULE: r1.filter((c) => ['FALSE_POSITIVE', 'FALSE_NEGATIVE'].includes(c.classification)).length,
  BASELINE_FALSE_POSITIVES_NOW: cases.filter((c) => c.before.classification === 'FALSE_POSITIVE').map((c) => ({ id: c.id, outcome: c.outcomeClassification, originalRule: c.classification, oracle: c.oracleVerdicts })),
  BASELINE_KNOWN_GOOD_NOW: manifest.cases.filter((m) => m.knownGoodGradedByRigorrun).map((m) => {
    const c = cases.find((x) => x.id === m.id);
    return { id: m.id, outcome: c.outcomeClassification, originalRule: c.classification, oracle: c.oracleVerdicts, rigorrunOutcomes: c.rigorrunOutcomes };
  }),
  BASELINE_FALSE_NEGATIVES_NOW: cases.filter((c) => c.before.classification === 'FALSE_NEGATIVE').map((c) => ({ id: c.id, outcome: c.outcomeClassification, originalRule: c.classification, oracle: c.oracleVerdicts })),
  RIGORRUN_FINDINGS_FIXED: statuses.filter((s) => s === 'FIXED').length,
  RIGORRUN_FINDINGS_PARTIAL: statuses.filter((s) => s === 'PARTIAL').length,
  RIGORRUN_FINDINGS_UNRESOLVED: statuses.filter((s) => s === 'UNRESOLVED').length,
  FINDINGS: findingStatus,
  PER_TARGET_BREAKDOWN: Object.fromEntries(['email-mcp', 'worktide-mcp', 'sqlite-mcp'].map((t) => [t, totals(cases.filter((c) => c.target === t))])),
  VERIFICATION_STRENGTH_BREAKDOWN: count(rigorrunAttemptCases, 'verification'),
  EVIDENCE_INDEPENDENCE_BREAKDOWN: count(rigorrunAttemptCases, 'evidenceIndependence'),
  BASELINE_SOURCE_BREAKDOWN: count(rigorrunAttemptCases, 'baseline'),
  TIMEOUT_BREAKDOWN: {
    outcomes: count(rigorrunAttemptCases, 'rigorrunOutcomes'),
    budgetsMs: count(rigorrunAttemptCases, 'budgetMs'),
    timedOutCases: rigorrunAttemptCases.filter((c) => c.rigorrunOutcomes.includes('TIMED_OUT')).map((c) => c.id),
    agentFailureCases: rigorrunAttemptCases.filter((c) => c.rigorrunOutcomes.includes('AGENT_FAILURE')).map((c) => c.id),
    harnessFailureCases: rigorrunAttemptCases.filter((c) => c.rigorrunOutcomes.includes('HARNESS_FAILURE')).map((c) => c.id),
  },
  JOURNEYS: journeys,
  cases,
};

const out = join(REMEDIATION, `${RUN}-results.json`);
if (process.argv.includes('--check')) {
  const expected = JSON.stringify(results, null, 2);
  const actual = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (actual.trim() !== expected.trim()) {
    console.error(`${RUN}-results.json is stale: regenerate with AFTER_RUN=${RUN} node remediation/scripts/aggregate-after.mjs`);
    process.exit(1);
  }
  const flat = {};
  const walk = (v, p) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
    else flat[p] = v;
  };
  walk(results, '');
  flat['baseline.totals.cases_total'] = manifest.originalTotals.cases_total;
  let bad = 0;
  let checked = 0;
  for (const f of readdirSync(REMEDIATION).filter((name) => name.endsWith('.md'))) {
    for (const m of readFileSync(join(REMEDIATION, f), 'utf8').matchAll(new RegExp(`<!-- ${TAG}:([^ ]+) -->([^<]*)<!-- \\/${TAG} -->`, 'g'))) {
      checked += 1;
      if (flat[m[1]] === undefined || String(flat[m[1]]) !== m[2].trim()) {
        bad += 1;
        console.error(`${f}: ${m[1]} is "${m[2].trim()}" in prose, ${flat[m[1]]} in after-results.json`);
      }
    }
  }
  console.log(`after-results.json verified; ${checked} numbers checked in prose, ${bad} mismatches`);
  process.exit(bad ? 1 : 0);
} else {
  writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
  const t = totals(cases);
  console.log(`${RUN}-results.json written: ${t.TOTAL_CASES} cases, TP ${t.TRUE_POSITIVES} TN ${t.TRUE_NEGATIVES} FP ${t.FALSE_POSITIVES} FN ${t.FALSE_NEGATIVES}, abstentions ${t.ABSTENTIONS}`);
}
