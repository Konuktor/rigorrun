#!/usr/bin/env node
/**
 * benchmark-v2's numbers, generated from its evidence only. Pre-registered and
 * frozen with the labels, before any benchmark-v2 attempt ran.
 *
 *   node aggregate-v2.mjs     # writes requalification/results-v2.json
 *
 * Unit of scoring: one generated case of one frozen RigorRun-mode case, on one
 * attempt. run-v2.py judges each on its own oracle window and records both
 * classifications of run-cases-after.py, unchanged: `classification` is the
 * audit's original rule, `outcomeClassification` the outcome-aware one, in which
 * ABSTAIN, HARNESS_FAILURE, TIMED_OUT and AGENT_FAILURE are never a verdict.
 *
 * Every labelled generated case on every planned attempt is in every
 * denominator. One without an oracle-judged record — the attempt never ran, the
 * run stopped before it, its reading is missing — is NOT_SCORED with its
 * reason, never dropped. A generated case the run produced with no label is
 * listed as unlabelled. Direct probes are run and recorded, never scored.
 *
 * The output is written outside requalification/v2/, so producing results can
 * never change the frozen file set.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2 = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const RQ = resolve(V2, '..');
const REPORT = resolve(RQ, '..');
const RUN = join(V2, 'evidence', 'run');
const OUT = join(RQ, 'results-v2.json');
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const sha256 = (path) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);
const uniq = (xs) => [...new Set(xs)];
const SCORED = ['TRUE_POSITIVE', 'TRUE_NEGATIVE', 'FALSE_POSITIVE', 'FALSE_NEGATIVE'];

const manifest = read(join(REPORT, 'remediation', 'baseline-manifest.json'));
const labels = read(join(V2, 'labels.json'));
const product = read(join(RQ, 'product-under-test.json'));

function attemptsOf(target, id) {
  const dir = join(RUN, 'evidence', target, id);
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

function generatedAttempt(frozen, gid, label, attemptNumber, attempt) {
  const base = { id: frozen.id, generatedCaseId: gid, category: label.category, truth: label.truth, injected: Boolean(label.injected), attempt: attemptNumber };
  if (!attempt) return { ...base, scored: false, status: 'NOT_RUN', reason: 'the attempt did not run' };
  const record = (attempt.generated ?? []).find((g) => g.caseId === gid);
  if (!record) {
    return { ...base, scored: false, status: 'NOT_SCORED', reason: attempt.run?.runFileWritten ? 'the run did not execute this generated case' : `the run wrote no run file (exit ${attempt.run?.exit ?? '?'})` };
  }
  if (!record.scored) return { ...base, scored: false, status: 'NOT_SCORED', reason: record.reason };
  const rr = record.rigorrun ?? {};
  return {
    ...base,
    scored: true,
    status: 'SCORED',
    oracleVerdict: record.oracleVerdict,
    reproduced: record.reproduced,
    rigorrunVerdict: record.rigorrunVerdict,
    rigorrunOutcome: record.rigorrunOutcome,
    classification: record.classification,
    outcomeClassification: record.outcomeClassification,
    outcomeReason: rr.outcomeReason ?? null,
    missingEvidence: rr.missingEvidence ?? [],
    verification: rr.verification ?? null,
    evidenceIndependence: rr.evidenceIndependence ?? null,
    budgetMs: rr.budgetMs ?? null,
    durationMs: rr.durationMs ?? null,
    readStability: rr.readStability ?? null,
    seconds: attempt.seconds ?? null,
  };
}

function buildCase(frozen) {
  const attempts = attemptsOf(frozen.target, frozen.id);
  const blocked = read(join(V2, 'evidence', 'local-model', frozen.id, 'blocked.json'));
  const common = {
    id: frozen.id, target: frozen.target, mode: frozen.mode, truthLabel: frozen.truthLabel, injected: frozen.injected,
    r1: frozen.rigorrunFindings.includes('R-1'), rigorrunFindings: frozen.rigorrunFindings,
    attemptsPlanned: frozen.attempts, attempts: attempts.length,
    notRunReason: attempts.length > 0 ? null : blocked ? 'BLOCKED_BY_HOST_RESOURCES' : 'no evidence was written for this case',
  };
  if (frozen.mode !== 'rigorrun') {
    return { ...common, status: attempts.length === 0 ? 'NOT_RUN' : 'DIRECT_PROBE_NOT_SCORED', oracleVerdicts: uniq(attempts.map((a) => a.oracleVerdict)) };
  }
  const caseLabels = labels?.cases?.[frozen.id];
  const generated = Object.entries(caseLabels?.generatedCases ?? {}).map(([gid, label]) => {
    const perAttempt = Array.from({ length: frozen.attempts }, (_, i) => generatedAttempt(frozen, gid, label, i + 1, attempts.find((a) => a.attempt === i + 1)));
    const scored = perAttempt.filter((a) => a.scored);
    return {
      generatedCaseId: gid, category: label.category, truth: label.truth, injected: Boolean(label.injected),
      attemptsPlanned: frozen.attempts, attemptsScored: scored.length,
      oracleVerdicts: uniq(scored.map((a) => a.oracleVerdict)),
      rigorrunOutcomes: uniq(scored.map((a) => a.rigorrunOutcome)),
      classification: scored.length === frozen.attempts ? consensus(scored.map((a) => a.classification)) : 'NOT_SCORED',
      outcomeClassification: scored.length === frozen.attempts ? consensus(scored.map((a) => a.outcomeClassification)) : 'NOT_SCORED',
      perAttempt,
    };
  });
  const unlabelled = uniq(attempts.flatMap((a) => (a.generated ?? []).filter((g) => !caseLabels?.generatedCases?.[g.caseId]).map((g) => g.caseId)));
  return {
    ...common,
    status: attempts.length === 0 ? 'NOT_RUN' : 'RUN',
    caseTimeoutMs: caseLabels?.caseTimeoutMs ?? null,
    exits: attempts.map((a) => a.run?.exit ?? null),
    endReadingMismatches: attempts.filter((a) => a.endReadingEqualsLastAfterCaseReading === false).map((a) => a.attempt),
    unlabelledGeneratedCases: unlabelled,
    generated,
  };
}

const cases = (manifest?.cases ?? []).map(buildCase);
const rigorrunCases = cases.filter((c) => c.mode === 'rigorrun');
const generatedAttempts = rigorrunCases.flatMap((c) => c.generated.flatMap((g) => g.perAttempt));
const scored = generatedAttempts.filter((a) => a.scored);
const by = (key, value) => scored.filter((a) => a[key] === value).length;
const knownGood = scored.filter((a) => a.oracleVerdict === 'PASS');
const knownBad = scored.filter((a) => a.oracleVerdict === 'FAIL');
const injectedReachable = scored.filter((a) => a.injected && a.oracleVerdict === 'FAIL');
const r1Cases = rigorrunCases.filter((c) => c.r1);

const totals = {
  TOTAL_CASES: cases.length,
  CASES_RUN: cases.filter((c) => c.attempts > 0).length,
  CASES_WITH_PLANNED_ATTEMPTS: cases.filter((c) => c.attempts >= c.attemptsPlanned).length,
  NOT_RUN: cases.filter((c) => c.attempts === 0).length,
  NOT_RUN_CASES: cases.filter((c) => c.attempts === 0).map((c) => ({ id: c.id, reason: c.notRunReason })),
  ATTEMPTS_PLANNED: cases.reduce((n, c) => n + c.attemptsPlanned, 0),
  ATTEMPTS_RUN: cases.reduce((n, c) => n + c.attempts, 0),
  DIRECT_PROBE_CASES_RUN: cases.filter((c) => c.mode !== 'rigorrun' && c.attempts > 0).length,
  RIGORRUN_MODE_CASES: rigorrunCases.length,
  GENERATED_CASES: rigorrunCases.reduce((n, c) => n + c.generated.length, 0),
  GENERATED_ATTEMPTS_PLANNED: generatedAttempts.length,
  GENERATED_ATTEMPTS_SCORED: scored.length,
  GENERATED_ATTEMPTS_NOT_SCORED: generatedAttempts.filter((a) => !a.scored).map((a) => ({ id: a.id, generatedCaseId: a.generatedCaseId, attempt: a.attempt, status: a.status, reason: a.reason })),
  UNLABELLED_GENERATED_CASES: rigorrunCases.filter((c) => c.unlabelledGeneratedCases.length > 0).map((c) => ({ id: c.id, generatedCaseIds: c.unlabelledGeneratedCases })),
  END_READING_MISMATCHES: rigorrunCases.filter((c) => c.endReadingMismatches.length > 0).map((c) => ({ id: c.id, attempts: c.endReadingMismatches })),
  ATTEMPT_LEVEL: {
    TP: by('outcomeClassification', 'TRUE_POSITIVE'),
    TN: by('outcomeClassification', 'TRUE_NEGATIVE'),
    FP: by('outcomeClassification', 'FALSE_POSITIVE'),
    FN: by('outcomeClassification', 'FALSE_NEGATIVE'),
    ABSTAIN: by('outcomeClassification', 'NOT_SCORED_ABSTAIN'),
    TIMED_OUT: by('outcomeClassification', 'TIMED_OUT'),
    AGENT_FAILURE: by('outcomeClassification', 'AGENT_FAILURE'),
    HARNESS_FAILURE: by('outcomeClassification', 'NOT_SCORED_HARNESS_FAILURE'),
    UNKNOWN: by('outcomeClassification', 'NOT_SCORED_UNKNOWN') + by('outcomeClassification', 'NOT_SCORED_NOT_RUN'),
    ORIGINAL_RULE: {
      TP: by('classification', 'TRUE_POSITIVE'),
      TN: by('classification', 'TRUE_NEGATIVE'),
      FP: by('classification', 'FALSE_POSITIVE'),
      FN: by('classification', 'FALSE_NEGATIVE'),
    },
  },
  KNOWN_GOOD: {
    generatedCases: uniq(knownGood.map((a) => `${a.id}/${a.generatedCaseId}`)).length,
    attempts: knownGood.length,
    attemptsGradedTrueNegativeBothRules: knownGood.filter((a) => a.outcomeClassification === 'TRUE_NEGATIVE' && a.classification === 'TRUE_NEGATIVE').length,
    notGradedTrueNegative: knownGood.filter((a) => !(a.outcomeClassification === 'TRUE_NEGATIVE' && a.classification === 'TRUE_NEGATIVE'))
      .map((a) => ({ id: a.id, generatedCaseId: a.generatedCaseId, attempt: a.attempt, outcome: a.rigorrunOutcome, outcomeClassification: a.outcomeClassification, classification: a.classification, outcomeReason: a.outcomeReason })),
  },
  KNOWN_BAD: {
    generatedCases: uniq(knownBad.map((a) => `${a.id}/${a.generatedCaseId}`)).length,
    attempts: knownBad.length,
    attemptsGivenPass: knownBad.filter((a) => a.rigorrunOutcome === 'PASS' || a.rigorrunVerdict === 'PASS')
      .map((a) => ({ id: a.id, generatedCaseId: a.generatedCaseId, attempt: a.attempt, outcome: a.rigorrunOutcome, verdict: a.rigorrunVerdict })),
  },
  INJECTED: {
    labelledGeneratedCases: uniq(generatedAttempts.filter((a) => a.injected).map((a) => `${a.id}/${a.generatedCaseId}`)),
    reachableAttempts: injectedReachable.length,
    detectedAttempts: injectedReachable.filter((a) => a.outcomeClassification === 'TRUE_POSITIVE').length,
    undetected: injectedReachable.filter((a) => a.outcomeClassification !== 'TRUE_POSITIVE').map((a) => ({ id: a.id, generatedCaseId: a.generatedCaseId, attempt: a.attempt, outcomeClassification: a.outcomeClassification })),
  },
  PASS_WITH_MISSING_EVIDENCE: scored.filter((a) => a.rigorrunOutcome === 'PASS' && (a.missingEvidence ?? []).length > 0).map((a) => ({ id: a.id, generatedCaseId: a.generatedCaseId, attempt: a.attempt, missingEvidence: a.missingEvidence })),
};

const R1 = {
  cases: r1Cases.length,
  casesRun: r1Cases.filter((c) => c.attempts > 0).length,
  reproductions: r1Cases.filter((c) => c.generated.some((g) => g.perAttempt.some((a) => a.scored && (['FALSE_POSITIVE', 'FALSE_NEGATIVE'].includes(a.outcomeClassification) || ['FALSE_POSITIVE', 'FALSE_NEGATIVE'].includes(a.classification))))).length,
  casesWithoutVerdict: r1Cases.filter((c) => c.attempts === 0 || c.generated.some((g) => g.perAttempt.some((a) => !a.scored || !SCORED.includes(a.outcomeClassification)))).map((c) => c.id),
  perCase: r1Cases.map((c) => ({ id: c.id, attempts: c.attempts, generated: c.generated.map((g) => ({ generatedCaseId: g.generatedCaseId, oracle: g.oracleVerdicts, outcome: g.outcomeClassification, originalRule: g.classification })) })),
};

const report = {
  generatedBy: 'requalification/v2/scripts/aggregate-v2.mjs',
  productCommit: product?.productCommit ?? null,
  labelsSha256: sha256(join(V2, 'labels.json')),
  freezeSha256: sha256(join(V2, 'freeze.json')),
  totals,
  R1,
  cases: Object.fromEntries(cases.map((c) => [c.id, c])),
};
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ cases: `${totals.CASES_RUN}/${totals.TOTAL_CASES}`, generatedAttemptsScored: `${totals.GENERATED_ATTEMPTS_SCORED}/${totals.GENERATED_ATTEMPTS_PLANNED}`, ...totals.ATTEMPT_LEVEL, knownGoodNotTN: totals.KNOWN_GOOD.notGradedTrueNegative.length, knownBadGivenPass: totals.KNOWN_BAD.attemptsGivenPass.length, injected: `${totals.INJECTED.detectedAttempts}/${totals.INJECTED.reachableAttempts}`, r1Reproductions: R1.reproductions }, null, 2));
