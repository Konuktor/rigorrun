#!/usr/bin/env node
/**
 * Builds results.json from the run artefacts, and checks the prose against it.
 *
 * Nothing in results.json is typed by hand: every count is derived from
 * cases/<target>/*.json, evidence/<target>/<case>/summary.json and the
 * per-attempt files. `--check` re-derives the numbers and fails if any number
 * quoted in the markdown reports (marked `<!-- n:key -->value<!-- /n -->`)
 * differs from the JSON.
 *
 *   node aggregate-results.mjs            # write results.json
 *   node aggregate-results.mjs --check    # verify the markdown matches
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPORT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO = resolve(REPORT, '..', '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const TARGETS = ['email-mcp', 'worktide-mcp', 'sqlite-mcp'];

function casesFor(target) {
  const dir = join(REPORT, 'cases', target);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => read(join(dir, f)));
}
function summaryFor(target, id) {
  const p = join(REPORT, 'evidence', target, id, 'summary.json');
  return existsSync(p) ? read(p) : null;
}
function attemptsFor(target, id) {
  const dir = join(REPORT, 'evidence', target, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => d.startsWith('attempt-') && existsSync(join(dir, d, 'attempt.json'))).sort().map((d) => read(join(dir, d, 'attempt.json')));
}

const findings = existsSync(join(REPORT, 'findings.json')) ? read(join(REPORT, 'findings.json')) : [];
const environment = existsSync(join(REPORT, 'evidence', 'environment.json')) ? read(join(REPORT, 'evidence', 'environment.json')) : {};

const targets = TARGETS.map((target) => {
  const cases = casesFor(target).map((c) => {
    const attempts = attemptsFor(target, c.id);
    const summary = summaryFor(target, c.id);
    const last = attempts[attempts.length - 1];
    const classes = [...new Set(attempts.map((a) => a.classification))];
    const oracle = [...new Set(attempts.map((a) => a.oracleVerdict))];
    const rr = [...new Set(attempts.map((a) => a.rigorrunVerdict))];
    // Verification strength as RigorRun itself labelled the run.
    const strengths = [...new Set(attempts.map((a) => a.result?.rigorrun?.verification).filter(Boolean))];
    return {
      id: c.id, class: c.class, workflow: c.workflow ?? null, mode: c.mode, truth: c.truth, injected: Boolean(c.injected),
      supplement: c.supplement ? true : false, attempts: attempts.length, oracleVerdicts: oracle, rigorrunVerdicts: rr,
      classification: classes.length === 1 ? classes[0] : classes.length === 0 ? 'NOT_RUN' : 'INCONSISTENT',
      reproduction: summary?.reproduction ?? null, verification: strengths, agentReport: last?.result?.rigorrun?.cases?.[0]?.agentReport ?? null,
    };
  });
  const scored = cases.filter((c) => c.mode === 'rigorrun' && c.attempts > 0);
  const count = (k) => scored.filter((c) => c.classification === k).length;
  const inj = cases.filter((c) => c.injected && c.attempts > 0);
  const injDetected = inj.filter((c) => c.oracleVerdicts.length === 1 && c.oracleVerdicts[0] === 'FAIL').length;
  const tp = count('TRUE_POSITIVE'), tn = count('TRUE_NEGATIVE'), fp = count('FALSE_POSITIVE'), fn = count('FALSE_NEGATIVE');
  const workflows = [...new Set(cases.map((c) => c.workflow).filter(Boolean))];
  const setups = existsSync(join(REPORT, 'traces', target)) ? readdirSync(join(REPORT, 'traces', target)).filter((d) => d.endsWith('-setup')) : [];
  // A journey RigorRun refused to compile or build a suite for is an abstention, recorded as such.
  const refused = setups.filter((d) => !existsSync(join(REPORT, 'traces', target, d, 'benchmark-summary.json')));
  const strengths = [...new Set(scored.flatMap((c) => c.verification))];
  return {
    target, target_commit: environment.targets?.[target]?.commit ?? null, environment: environment.targets?.[target]?.environment ?? null,
    workflows, rigorrun_setups: setups, rigorrun_journeys_refused: refused, cases_total: cases.filter((c) => c.attempts > 0).length,
    cases_expected_pass_held: cases.filter((c) => c.attempts > 0 && c.oracleVerdicts.length === 1 && c.oracleVerdicts[0] === 'PASS').length,
    cases_expected_state_violated: cases.filter((c) => c.attempts > 0 && c.oracleVerdicts.length === 1 && c.oracleVerdicts[0] === 'FAIL').length,
    rigorrun_scored_cases: scored.length, true_positives: tp, true_negatives: tn, false_positives: fp, false_negatives: fn,
    rigorrun_abstained: cases.filter((c) => c.mode === 'rigorrun' && c.attempts === 0).length + refused.length,
    injected_failures: inj.length, injected_failures_detected_by_oracle: injDetected,
    injected_failures_detected_by_rigorrun: inj.filter((c) => c.mode === 'rigorrun' && c.classification === 'TRUE_POSITIVE').length,
    true_positive_rate: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null,
    false_positive_rate: fp + tn ? +(fp / (fp + tn)).toFixed(3) : null,
    verification_strength: strengths,
    confirmed_target_findings: findings.filter((f) => f.target === target && f.category.startsWith('TARGET_') && f.status === 'CONFIRMED').map((f) => f.id),
    confirmed_rigorrun_findings: findings.filter((f) => f.target === target && f.category.startsWith('RIGORRUN_') && f.status === 'CONFIRMED').map((f) => f.id),
    limitations: environment.targets?.[target]?.limitations ?? [],
    cases,
  };
});

const all = targets.flatMap((t) => t.cases);
const scoredAll = all.filter((c) => c.mode === 'rigorrun' && c.attempts > 0);
const sum = (k) => targets.reduce((n, t) => n + t[k], 0);
const results = {
  audit_version: '1.0.0', date: environment.date ?? new Date().toISOString().slice(0, 10),
  rigorrun_version: environment.rigorrun?.version ?? null, rigorrun_commit: environment.rigorrun?.commit ?? null,
  question: 'Can RigorRun find real, reproducible failures in external state-changing MCP/agent workflows?',
  totals: {
    cases_total: sum('cases_total'), rigorrun_scored_cases: scoredAll.length,
    true_positives: sum('true_positives'), true_negatives: sum('true_negatives'), false_positives: sum('false_positives'), false_negatives: sum('false_negatives'),
    injected_failures: sum('injected_failures'), injected_failures_detected_by_oracle: sum('injected_failures_detected_by_oracle'),
    injected_failures_detected_by_rigorrun: sum('injected_failures_detected_by_rigorrun'),
    true_positive_rate: (sum('true_positives') + sum('false_negatives')) ? +(sum('true_positives') / (sum('true_positives') + sum('false_negatives'))).toFixed(3) : null,
    false_positive_rate: (sum('false_positives') + sum('true_negatives')) ? +(sum('false_positives') / (sum('false_positives') + sum('true_negatives'))).toFixed(3) : null,
    mutation_detection_rate: (() => { const wrong = scoredAll.filter((c) => c.oracleVerdicts.length === 1 && c.oracleVerdicts[0] === 'FAIL'); return wrong.length ? +(wrong.filter((c) => c.classification === 'TRUE_POSITIVE').length / wrong.length).toFixed(3) : null; })(),
    confirmed_upstream_findings: findings.filter((f) => f.category.startsWith('TARGET_') && f.status === 'CONFIRMED').length,
    confirmed_rigorrun_findings: findings.filter((f) => f.category.startsWith('RIGORRUN_') && f.status === 'CONFIRMED').length,
    findings_total: findings.length,
  },
  findings: findings.map((f) => ({ id: f.id, target: f.target, category: f.category, severity: f.severity, status: f.status, title: f.title, reproduction: f.reproduction })),
  targets,
  limitations: environment.limitations ?? [],
  generated_by: 'scripts/aggregate-results.mjs',
};

const out = join(REPORT, 'results.json');
if (process.argv.includes('--check')) {
  const expected = JSON.stringify(results, null, 2);
  const actual = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (actual.trim() !== expected.trim()) { console.error('results.json is stale: regenerate with node scripts/aggregate-results.mjs'); process.exit(1); }
  // Every number in the markdown that is marked as coming from results.json must match it.
  const flat = {};
  const walk = (v, p) => { if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k); else flat[p] = v; };
  walk(results, '');
  for (const t of targets) for (const [k, v] of Object.entries(t)) if (typeof v !== 'object') flat[`targets[${t.target}].${k}`] = v;
  let bad = 0, checked = 0;
  for (const f of readdirSync(REPORT).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(join(REPORT, f), 'utf8');
    for (const m of text.matchAll(/<!-- n:([^ ]+) -->([^<]*)<!-- \/n -->/g)) {
      checked += 1;
      const want = flat[m[1]];
      if (want === undefined || String(want) !== m[2].trim()) { bad += 1; console.error(`${f}: ${m[1]} is "${m[2].trim()}" in prose, ${want} in results.json`); }
    }
  }
  console.log(`${checked} numbers checked in prose, ${bad} mismatches`);
  process.exit(bad ? 1 : 0);
} else {
  writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
  console.log(`results.json written: ${results.totals.cases_total} cases, TP ${results.totals.true_positives} TN ${results.totals.true_negatives} FP ${results.totals.false_positives} FN ${results.totals.false_negatives}`);
}
