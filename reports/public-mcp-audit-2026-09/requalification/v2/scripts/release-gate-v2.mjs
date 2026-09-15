#!/usr/bin/env node
/**
 * The requalification's release gate. benchmark-v2 decides; benchmark-v1 is reported beside it and read by no gate.
 *
 *   node release-gate-v2.mjs     # writes requalification/release-gate.json, prints every gate
 *
 * The twelve gates of the final qualification (final-qualification/scripts/release-gate-final.mjs),
 * with the inputs pre-registered in requalification/v2/PREREGISTRATION.md and frozen with it:
 * benchmark-v2's results (every generated case), the N-1 evidence re-measured at the product under
 * test, the independent-oracle cases v1 and v2, the MCP preflight, and the product checks. A gate
 * whose evidence is missing FAILS. Exit 0 only when every gate passes, and only then is the status
 * GO_FOR_POPULAR_MCP_AUDITS.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const V2 = resolve(HERE, '..');
const RQ = resolve(V2, '..');
const REPO = resolve(RQ, '..', '..', '..');
const AUDITED = '07dda8c738d6daada161ffcf2bfc046b3c874ac5';
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const text = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

const product = read(join(RQ, 'product-under-test.json'));
const results = read(join(RQ, 'results-v2.json'));
const t = results?.totals ?? null;
const r1 = results?.R1 ?? null;
const eh = read(join(RQ, 'n1', 'eh-wt-03.json'));
const worktideV2 = read(join(RQ, 'n1', 'heldout-worktide-v2-results.json'));
const inprocess = read(join(RQ, 'n1', 'evidence', 'heldout-inprocess', 'results.json'));
const cross = read(join(RQ, 'evidence', 'n1-cross-regression-v2.json'));
const ioV1 = read(join(RQ, 'v1', 'evidence', 'independent-oracle', 'results.json'));
const ioV2 = read(join(RQ, 'io-v2', 'evidence', 'results.json'));
const preflight = read(join(RQ, 'mcp', 'evidence', 'mcp-preflight', 'summary.json'));
const targets = read(join(RQ, 'mcp', 'evidence', 'mcp-preflight', 'targets.json'));
const PATHSPEC = product?.productPathspec ?? ['packages', 'apps', 'fixtures'];

const gates = [];
const gate = (id, title, pass, evidence, blocker) => gates.push({ id, title, status: pass ? 'PASS' : 'FAIL', evidence, ...(pass ? {} : { blocker }) });
const run = (cmd, args) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() };
  }
};
const sameProductSources = (commit) => Boolean(commit && product) && run('git', ['diff', '--quiet', commit, product.productCommit, '--', ...PATHSPEC]).code === 0;

// GATE 1
gate('GATE_1', 'COMPLETE: every frozen case executed with its planned attempts, and every labelled generated case judged on every planned attempt',
  Boolean(t) && t.TOTAL_CASES === 58 && t.NOT_RUN === 0 && t.CASES_WITH_PLANNED_ATTEMPTS === 58 && t.GENERATED_ATTEMPTS_NOT_SCORED.length === 0 && t.UNLABELLED_GENERATED_CASES.length === 0,
  { totalCases: t?.TOTAL_CASES, casesRun: t?.CASES_RUN, casesWithPlannedAttempts: t?.CASES_WITH_PLANNED_ATTEMPTS, notRun: t?.NOT_RUN_CASES ?? null,
    generatedAttemptsScored: t?.GENERATED_ATTEMPTS_SCORED, generatedAttemptsPlanned: t?.GENERATED_ATTEMPTS_PLANNED, notScored: t?.GENERATED_ATTEMPTS_NOT_SCORED ?? null, unlabelled: t?.UNLABELLED_GENERATED_CASES ?? null },
  `${t?.NOT_RUN ?? '?'} case(s) not run; ${t?.GENERATED_ATTEMPTS_NOT_SCORED?.length ?? '?'} generated attempt(s) not judged: ${(t?.GENERATED_ATTEMPTS_NOT_SCORED ?? []).slice(0, 8).map((a) => `${a.id}/${a.generatedCaseId}#${a.attempt} (${a.reason})`).join('; ')}; unlabelled ${t?.UNLABELLED_GENERATED_CASES?.length ?? '?'}`);

// GATE 2
gate('GATE_2', 'R1: all 11 R-1 cases ran, every generated case of theirs has a verdict, and none reproduces R-1',
  Boolean(r1) && r1.cases === 11 && r1.casesRun === 11 && r1.reproductions === 0 && r1.casesWithoutVerdict.length === 0,
  r1,
  `R-1 cases run ${r1?.casesRun ?? '?'}/11; reproductions ${r1?.reproductions ?? '?'}; without a verdict: ${(r1?.casesWithoutVerdict ?? []).join(', ')}`);

// GATE 3
{
  const ehAttempts = (eh?.attempts ?? []).filter((a) => a.id === 'EH-WT-03');
  const ehOk = ehAttempts.filter((a) => a.actual === 'FAIL').length >= 3 && ehAttempts.every((a) => a.actual !== 'PASS') && sameProductSources(eh?.rigorrunCommit);
  const wtOk = Boolean(worktideV2) && worktideV2.blocks?.gate?.passes === true && worktideV2.blocks?.['side-channel']?.passes === true && sameProductSources(worktideV2.rigorrunCommit);
  const crossOk = Boolean(cross) && cross.summary.frozenResultsPresent && cross.summary.regressions.length === 0 && (cross.summary.unmeasured ?? [null]).length === 0;
  const totals = inprocess?.totals;
  const inprocessOk = Boolean(totals) && totals.cases === totals.matchingExpected && totals.knownGoodIncorrectlyFailed === 0 && totals.knownBadIncorrectlyPassed === 0 && sameProductSources(inprocess?.rigorrunCommit);
  gate('GATE_3', 'N1: EH-WT-03 still FAIL; Worktide v2 held-out clean; no N-1 cross-regression in benchmark-v2; in-process held-out set as expected — all at the product under test',
    ehOk && wtOk && crossOk && inprocessOk,
    { ehWt03: { rigorrunCommit: eh?.rigorrunCommit ?? null, productSourcesEqual: sameProductSources(eh?.rigorrunCommit), outcomes: ehAttempts.map((a) => a.actual) },
      heldoutWorktideV2: { rigorrunCommit: worktideV2?.rigorrunCommit ?? null, productSourcesEqual: sameProductSources(worktideV2?.rigorrunCommit), gate: worktideV2?.blocks?.gate ?? null, sideChannel: worktideV2?.blocks?.['side-channel'] ?? null },
      crossRegression: cross?.summary ?? null,
      heldoutInprocess: inprocess ? { rigorrunCommit: inprocess.rigorrunCommit, ...totals } : null },
    [!ehOk && 'EH-WT-03 evidence', !wtOk && 'Worktide v2 held-out', !crossOk && (cross ? `cross-regression: ${cross.summary.regressions.length} regression(s), ${(cross.summary.unmeasured ?? []).length} unmeasured` : 'cross-regression evidence missing'), !inprocessOk && 'in-process held-out'].filter(Boolean).join('; '));
}

// GATE 4
gate('GATE_4', 'FALSE_POSITIVES (strict): no known-good generated case graded anything but TRUE_NEGATIVE, under either rule, on any attempt',
  Boolean(t) && t.ATTEMPT_LEVEL.FP === 0 && t.ATTEMPT_LEVEL.ORIGINAL_RULE.FP === 0 && t.KNOWN_GOOD.attempts > 0 && t.KNOWN_GOOD.notGradedTrueNegative.length === 0,
  { FP: t?.ATTEMPT_LEVEL?.FP, originalRuleFP: t?.ATTEMPT_LEVEL?.ORIGINAL_RULE?.FP, knownGood: t?.KNOWN_GOOD ?? null },
  `known-good attempts not TRUE_NEGATIVE: ${(t?.KNOWN_GOOD?.notGradedTrueNegative ?? []).map((a) => `${a.id}/${a.generatedCaseId}#${a.attempt} ${a.outcome}`).join('; ') || 'none'}`);

// GATE 5
gate('GATE_5', 'FALSE_NEGATIVES: no independently known-bad generated case receives PASS',
  Boolean(t) && t.KNOWN_BAD.attemptsGivenPass.length === 0 && t.ATTEMPT_LEVEL.FN === 0 && t.ATTEMPT_LEVEL.ORIGINAL_RULE.FN === 0,
  { knownBad: t?.KNOWN_BAD ?? null, FN: t?.ATTEMPT_LEVEL?.FN, originalRuleFN: t?.ATTEMPT_LEVEL?.ORIGINAL_RULE?.FN },
  `known-bad attempts given PASS: ${(t?.KNOWN_BAD?.attemptsGivenPass ?? []).map((a) => `${a.id}/${a.generatedCaseId}#${a.attempt}`).join(', ') || 'none'}; FN ${t?.ATTEMPT_LEVEL?.FN}/${t?.ATTEMPT_LEVEL?.ORIGINAL_RULE?.FN}`);

// GATE 6
gate('GATE_6', 'INJECTED_FAILURES: every reachable injected failure detected on every attempt, and at least one is reachable',
  Boolean(t) && t.INJECTED.reachableAttempts > 0 && t.INJECTED.detectedAttempts === t.INJECTED.reachableAttempts,
  t?.INJECTED ?? null,
  `reachable injected attempts ${t?.INJECTED?.reachableAttempts ?? '?'}, detected ${t?.INJECTED?.detectedAttempts ?? '?'}`);

// GATE 7
{
  const oracleGate = (io, expectedCases) => {
    const s = io?.summary;
    const planned = (io?.cases ?? []).filter((c) => (c.gates ?? []).includes('INDEPENDENT_ORACLE'));
    const complete = planned.every((c) => c.attempts === c.attemptsPlanned);
    const ok = Boolean(s) && planned.length === expectedCases && planned.length > 0 && complete && s.independentOracleGate.failing.length === 0 && s.independentOracleGate.guardViolations.length === 0;
    return { ok, planned: planned.length, complete, failing: s?.independentOracleGate?.failing ?? null, guardViolations: s?.independentOracleGate?.guardViolations ?? null,
      perCase: Object.fromEntries((io?.cases ?? []).map((c) => [c.id, { expected: c.expected, outcomes: c.outcomes, labels: c.labels, oracle: c.oracleVerdicts, allAttemptsMatch: c.allAttemptsMatch }])) };
  };
  const ioV2Planned = (ioV2?.cases ?? []).filter((c) => (c.gates ?? []).includes('INDEPENDENT_ORACLE')).length;
  const v1 = oracleGate(ioV1, 10);
  const v2 = oracleGate(ioV2, ioV2Planned);
  gate('GATE_7', 'INDEPENDENT_ORACLE: the ten gated IO-v1 cases and every gated IO-v2 case behave exactly as frozen; independent evidence overrides self-reported evidence; nothing changed outside the frame passes',
    v1.ok && v2.ok,
    { ioV1: v1, ioV2: v2 },
    `IO-v1 failing: ${(v1.failing ?? ['evidence missing']).join(', ') || 'none'}; IO-v2 failing: ${(v2.failing ?? ['evidence missing']).join(', ') || 'none'}; guard violations: ${[...(v1.guardViolations ?? []), ...(v2.guardViolations ?? [])].join(', ') || 'none'}`);
}

// GATE 8
{
  const abstentionFailing = (io) => io?.summary?.abstentionGate?.failing ?? null;
  const passWithMissing = (io) => (io?.cases ?? []).flatMap((c) => (c.perAttempt ?? []).filter((a) => a.outcome === 'PASS' && (a.missingEvidence ?? []).length > 0).map((a) => `${c.id}#${a.attempt}`));
  const v1Failing = abstentionFailing(ioV1);
  const v2Failing = abstentionFailing(ioV2);
  const missing = [...(t?.PASS_WITH_MISSING_EVIDENCE ?? []).map((a) => `${a.id}/${a.generatedCaseId}#${a.attempt}`), ...passWithMissing(ioV1), ...passWithMissing(ioV2)];
  gate('GATE_8', 'ABSTENTION: without authoritative evidence RigorRun never gives PASS',
    Boolean(t) && v1Failing !== null && v2Failing !== null && v1Failing.length === 0 && v2Failing.length === 0 && missing.length === 0,
    { ioV1AbstentionFailing: v1Failing, ioV2AbstentionFailing: v2Failing, passWithMissingEvidence: missing },
    `abstention cases failing: ${[...(v1Failing ?? ['IO-v1 evidence missing']), ...(v2Failing ?? ['IO-v2 evidence missing'])].join(', ') || 'none'}; PASS with missing evidence: ${missing.join(', ') || 'none'}`);
}

// GATE 9
{
  const statements = targets?.targets ?? [];
  const planned = ['Playwright MCP', 'GitHub MCP', 'Filesystem MCP'];
  const missing = planned.filter((name) => !statements.some((s) => s.name === name));
  const unsupported = statements.filter((s) => ['UNSUPPORTED', 'UNKNOWN'].includes(s.status)).map((s) => `${s.name}: ${s.status}`);
  gate('GATE_9', 'MCP_COMPAT: supported MCP behaviour explicitly known at the product under test; no compatibility ambiguity that would invalidate the next audits',
    Boolean(preflight) && preflight.statuses.FAIL === 0 && existsSync(join(RQ, 'mcp-compatibility.md')) && missing.length === 0 && unsupported.length === 0,
    { preflight: preflight?.statuses ?? null, targets: statements, missingStatements: missing },
    `preflight FAIL checks ${preflight?.statuses?.FAIL ?? '?'}; missing target statements: ${missing.join(', ') || 'none'}; unsupported: ${unsupported.join(', ') || 'none'}`);
}

// GATE 10
{
  const base = join(RQ, 'evidence', 'final');
  const exitOf = (log) => {
    if (log === null) return null;
    const m = /exit (\d+)\s*$/.exec(log.trim());
    return m ? Number(m[1]) : null;
  };
  const suite = (log) => {
    if (log === null) return null;
    const line = (label) => {
      const m = new RegExp(`${label}\\s+([^\\n]*?)\\((\\d+)\\)`).exec(log);
      if (!m) return null;
      const part = (word) => Number(new RegExp(`(\\d+) ${word}`).exec(m[1])?.[1] ?? 0);
      return { failed: part('failed'), passed: part('passed'), skipped: part('skipped'), total: Number(m[2]) };
    };
    const tests = line('Tests');
    return tests ? { parsed: true, ...tests, exit: exitOf(log) } : { parsed: false, exit: exitOf(log) };
  };
  const e2eLog = text(join(base, 'e2e.log'));
  const test = suite(text(join(base, 'test.log')));
  const typecheck = exitOf(text(join(base, 'typecheck.log')));
  const lint = exitOf(text(join(base, 'lint.log')));
  const e2e = e2eLog === null ? null : { passed: Number(/(\d+) passed/.exec(e2eLog)?.[1] ?? 0), failed: Number(/(\d+) failed/.exec(e2eLog)?.[1] ?? 0), exit: exitOf(e2eLog) };
  const testsOk = Boolean(test?.parsed) && test.failed === 0 && test.skipped === 0 && test.passed === test.total && test.exit === 0;
  const e2eOk = Boolean(e2e) && e2e.exit === 0 && e2e.failed === 0 && e2e.passed > 0;
  gate('GATE_10', 'TESTS: unit/integration, e2e, typecheck and lint all pass at the product under test',
    testsOk && typecheck === 0 && lint === 0 && e2eOk,
    { test, typecheck, lint, e2e },
    [!testsOk && 'unit/integration', typecheck !== 0 && 'typecheck', lint !== 0 && 'lint', !e2eOk && 'e2e'].filter(Boolean).join(', '));
}

// GATE 11
{
  const productCheck = run('node', [join(RQ, 'scripts', 'product-under-test.mjs'), '--check']);
  const quarantine = run('python3', [join(RQ, 'scripts', 'rq_hygiene.py'), 'quarantine-check']);
  const later = product?.frozenInputs?.laterFreezes ?? {};
  const frozenBeforeRuns = later.benchmarkV2?.present === true && later.ioV2?.present === true;
  gate('GATE_11', 'BENCHMARK_INTEGRITY: no frozen label, case or benchmark definition changed — benchmark-v1, benchmark-v2, IO-v1, IO-v2 and the Worktide v2 held-out set',
    productCheck.code === 0 && quarantine.code === 0 && frozenBeforeRuns,
    { productUnderTestCheck: productCheck.out, frozenAuditFiles: quarantine.out, laterFreezesRecorded: later },
    `${productCheck.code !== 0 ? productCheck.out : ''} ${quarantine.code !== 0 ? quarantine.out : ''} ${frozenBeforeRuns ? '' : 'benchmark-v2 or IO-v2 freeze not recorded with the product under test'}`.trim());
}

// GATE 12
{
  const diff = product ? execFileSync('git', ['-C', REPO, 'diff', AUDITED, product.productCommit, '--', 'packages', 'apps'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) : '';
  const FORBIDDEN = /mailhog|greenmail|worktide|email-mcp|mcp-server-sqlite|\bsqlite\b|audit 17|quarterly report|example\.test|check_inbox|send_email|time\.(start|stop)|tasks\.search|\bp_[0-9a-f]{12}\b|\bEM-GMA?-\d|\bSQ-(W1B?|LLM|D)-\d|\bWT-D-\d|\bEH-WT-\d|\bV2-[TSLMU]-\d|taskdesk|create_task|query_tasks|\bIO-\d|\bIO2-|query_notes|create_note|update_note|list_notes|delete_task|reset_desk|Record1-DOES-NOT-EXIST/i;
  const hits = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (!/^(packages|apps)\/[^/]+\/src\//.test(file)) continue;
    if (FORBIDDEN.test(line)) hits.push({ file, line: line.slice(1).trim().slice(0, 200) });
  }
  gate('GATE_12', 'NO_TARGET_HACKS: no target-specific special casing in production code',
    Boolean(product) && hits.length === 0,
    { scanned: `git diff ${AUDITED.slice(0, 7)} ${product?.productCommit?.slice(0, 7)} -- packages apps (added lines in */src/)`, hits },
    `target-specific lines: ${hits.map((h) => `${h.file}: ${h.line}`).join('; ')}`);
}

const passed = gates.every((g) => g.status === 'PASS');
const report = {
  generatedBy: 'requalification/v2/scripts/release-gate-v2.mjs',
  decidedBy: 'benchmark-v2',
  productCommit: product?.productCommit ?? null,
  packageVersion: product?.packageVersion ?? null,
  status: passed ? 'GO_FOR_POPULAR_MCP_AUDITS' : 'NO_GO',
  gates,
  blockers: gates.filter((g) => g.status === 'FAIL').map((g) => ({ gate: g.id, blocker: g.blocker })),
};
writeFileSync(join(RQ, 'release-gate.json'), JSON.stringify(report, null, 2) + '\n');
for (const g of gates) console.log(`${g.status.padEnd(4)}  ${g.id.padEnd(8)} ${g.title}`);
console.log(report.status);
process.exit(passed ? 0 : 1);
