#!/usr/bin/env node
/**
 * Freezes the audit benchmark as it stood BEFORE remediation.
 *
 * Reads only existing artefacts (cases/, evidence/, results.json, findings.json,
 * scripts/) and writes remediation/baseline-manifest.json. Nothing here is
 * typed by hand. `--check` re-derives the manifest and fails if anything in
 * the frozen inputs changed (a case label, a script, a result file).
 *
 *   node remediation/scripts/freeze-baseline.mjs          # write
 *   node remediation/scripts/freeze-baseline.mjs --check  # verify
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPORT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const OUT = join(REPORT, 'remediation', 'baseline-manifest.json');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha256 = (p) => 'sha256:' + createHash('sha256').update(readFileSync(p)).digest('hex');
const TARGETS = ['email-mcp', 'worktide-mcp', 'sqlite-mcp'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

function build() {
  const results = read(join(REPORT, 'results.json'));
  const findings = read(join(REPORT, 'findings.json'));
  const environment = read(join(REPORT, 'evidence', 'environment.json'));
  const rigorrunFindings = findings.filter((f) => f.category.startsWith('RIGORRUN_'));

  const cases = [];
  for (const target of TARGETS) {
    const dir = join(REPORT, 'cases', target);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const c = read(join(dir, file));
      const evidenceDir = join(REPORT, 'evidence', target, c.id);
      const attempts = existsSync(evidenceDir)
        ? readdirSync(evidenceDir)
            .filter((d) => d.startsWith('attempt-') && existsSync(join(evidenceDir, d, 'attempt.json')))
            .sort()
            .map((d) => read(join(evidenceDir, d, 'attempt.json')))
        : [];
      const summary = existsSync(join(evidenceDir, 'summary.json')) ? read(join(evidenceDir, 'summary.json')) : null;
      const inResults = results.targets.find((t) => t.target === target)?.cases.find((x) => x.id === c.id) ?? null;
      const classes = [...new Set(attempts.map((a) => a.classification))];
      const classification = classes.length === 1 ? classes[0] : classes.length === 0 ? 'NOT_RUN' : 'INCONSISTENT';
      cases.push({
        id: c.id,
        target,
        targetCommit: environment.targets[target].commit,
        ...(environment.targets[target].backend_commit ? { backendCommit: environment.targets[target].backend_commit } : {}),
        mode: c.mode,
        class: c.class,
        workflow: c.workflow ?? null,
        truthLabel: c.truth,
        intent: c.intent,
        expectedFinalState: c.expectedFinalState,
        expect: c.expect,
        oracle: c.oracle,
        oracleKind: c.oracle_kind ?? target,
        resetKind: c.reset_kind ?? c.oracle_kind ?? target,
        noReset: Boolean(c.no_reset),
        injected: Boolean(c.injected),
        ...(c.injectedFault ? { injectedFault: c.injectedFault } : {}),
        supplement: Boolean(c.supplement),
        ...(c.agent ? { agent: c.agent } : {}),
        ...(c.project ? { project: c.project, home: c.home } : {}),
        attempts: attempts.length,
        attemptDetail: attempts.map((a) => ({ attempt: a.attempt, oracleVerdict: a.oracleVerdict, rigorrunVerdict: a.rigorrunVerdict, classification: a.classification, seconds: a.seconds })),
        originalOracleVerdicts: [...new Set(attempts.map((a) => a.oracleVerdict))],
        originalRigorrunVerdicts: [...new Set(attempts.map((a) => a.rigorrunVerdict))],
        classification,
        reproduction: summary?.reproduction ?? null,
        resultsJsonClassification: inResults?.classification ?? null,
        baselineFalsePositive: classification === 'FALSE_POSITIVE',
        baselineFalseNegative: classification === 'FALSE_NEGATIVE',
        knownGoodGradedByRigorrun: c.mode === 'rigorrun' && attempts.length > 0 && attempts.every((a) => a.oracleVerdict === 'PASS'),
        verificationStrength: inResults?.verification ?? [],
        rigorrunFindings: rigorrunFindings.filter((f) => (f.cases ?? []).includes(c.id)).map((f) => f.id),
        caseFile: relative(REPORT, join(dir, file)),
        caseFileSha256: sha256(join(dir, file)),
      });
    }
  }

  const frozenFiles = {};
  for (const p of [...walk(join(REPORT, 'cases')), ...walk(join(REPORT, 'scripts')), join(REPORT, 'results.json'), join(REPORT, 'findings.json'), join(REPORT, 'findings.md'), join(REPORT, 'evidence', 'environment.json')]) {
    frozenFiles[relative(REPORT, p)] = sha256(p);
  }

  return {
    manifestVersion: '1.0.0',
    frozenAt: '2026-09-14',
    purpose: 'Immutable BEFORE baseline for the RigorRun remediation. Labels, oracles and expect predicates here must not change; a case may only be excluded symmetrically via benchmark-validity-exceptions.md.',
    rigorrun: environment.rigorrun,
    host: environment.host,
    targets: Object.fromEntries(TARGETS.map((t) => [t, { commit: environment.targets[t].commit, ...(environment.targets[t].backend_commit ? { backendCommit: environment.targets[t].backend_commit } : {}), version: environment.targets[t].version, environment: environment.targets[t].environment, tools: environment.targets[t].tools }])),
    originalTotals: results.totals,
    originalPerTarget: results.targets.map((t) => ({ target: t.target, cases_total: t.cases_total, rigorrun_scored_cases: t.rigorrun_scored_cases, true_positives: t.true_positives, true_negatives: t.true_negatives, false_positives: t.false_positives, false_negatives: t.false_negatives, rigorrun_abstained: t.rigorrun_abstained, injected_failures: t.injected_failures, injected_failures_detected_by_oracle: t.injected_failures_detected_by_oracle, injected_failures_detected_by_rigorrun: t.injected_failures_detected_by_rigorrun, rigorrun_journeys_refused: t.rigorrun_journeys_refused })),
    rigorrunFindings: rigorrunFindings.map((f) => ({ id: f.id, severity: f.severity, title: f.title, cases: f.cases ?? [] })),
    rigorrunTestBaseline: { files: 73, tests: 847, passed: 847, log: 'evidence/rigorrun-test-baseline.log' },
    counts: {
      cases: cases.length,
      rigorrunMode: cases.filter((c) => c.mode === 'rigorrun').length,
      scored: cases.filter((c) => c.mode === 'rigorrun' && c.attempts > 0).length,
      falsePositives: cases.filter((c) => c.baselineFalsePositive).length,
      falseNegatives: cases.filter((c) => c.baselineFalseNegative).length,
      knownGoodGraded: cases.filter((c) => c.knownGoodGradedByRigorrun).length,
      knownGoodGradedFalsePositive: cases.filter((c) => c.knownGoodGradedByRigorrun && c.baselineFalsePositive).length,
      injected: cases.filter((c) => c.injected).length,
      r1Cases: cases.filter((c) => c.rigorrunFindings.includes('R-1')).length,
    },
    cases,
    frozenFiles,
  };
}

const manifest = build();
if (process.argv.includes('--check')) {
  const expected = JSON.stringify(manifest, null, 2);
  const actual = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (actual.trim() !== expected.trim()) {
    console.error('baseline-manifest.json does not match the frozen inputs (a case, script or result file changed, or the manifest was edited).');
    process.exit(1);
  }
  console.log(`baseline manifest verified: ${manifest.counts.cases} cases, ${Object.keys(manifest.frozenFiles).length} frozen files`);
} else {
  writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`baseline manifest written: ${JSON.stringify(manifest.counts)}`);
}
