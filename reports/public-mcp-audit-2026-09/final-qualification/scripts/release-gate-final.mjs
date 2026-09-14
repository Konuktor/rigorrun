#!/usr/bin/env node
/**
 * The final qualification's release gate, computed from generated evidence only.
 *
 *   node release-gate-final.mjs     # writes final-qualification/release-gate.json, prints every gate
 *
 * The twelve gates are the ones written in the plan before any run, with the three
 * decisions recorded with the user (GATE 4 strict; IO-5 state-observable; IO-7 mixed
 * nomination gated). A gate whose evidence is missing FAILS. Exit 0 only when every
 * gate passes, and only then is the status GO_FOR_POPULAR_MCP_AUDITS.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FQ = resolve(HERE, '..');
const REMEDIATION = resolve(FQ, '..', 'remediation');
const REPO = resolve(FQ, '..', '..', '..');
const AUDITED = '07dda8c738d6daada161ffcf2bfc046b3c874ac5';
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

const product = read(join(FQ, 'product-under-test.json'));
const results = read(join(FQ, 'results.json'));
const f58 = results?.frozen58 ?? null;
const n1Final = read(join(REMEDIATION, 'n1', 'after-fix-final.json'));
const v2 = read(join(REMEDIATION, 'heldout-worktide-v2', 'results.json'));
const cross = read(join(FQ, 'evidence', 'n1-cross-regression.json'));
const inprocess = read(join(FQ, 'evidence', 'heldout-inprocess', 'results.json'));
const io = read(join(FQ, 'evidence', 'independent-oracle', 'results.json'));
const preflight = read(join(FQ, 'evidence', 'mcp-preflight', 'summary.json'));
const targets = read(join(FQ, 'evidence', 'mcp-preflight', 'targets.json'));
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
gate('GATE_1', 'FROZEN_58_COMPLETE: every frozen case executed with its planned attempts; no case missing',
  Boolean(f58) && f58.TOTAL_CASES === 58 && f58.NOT_RUN === 0 && f58.CASES_WITH_PLANNED_ATTEMPTS === 58,
  { totalCases: f58?.TOTAL_CASES, casesRun: f58?.CASES_RUN, casesWithPlannedAttempts: f58?.CASES_WITH_PLANNED_ATTEMPTS, notRun: f58?.NOT_RUN_CASES ?? null },
  `${f58?.NOT_RUN ?? '?'} frozen case(s) not run: ${(f58?.NOT_RUN_CASES ?? []).map((c) => `${c.id} (${c.reason})`).join('; ')}`);

// GATE 2
gate('GATE_2', 'R1: all 11 R-1 cases ran and none reproduces R-1',
  Boolean(f58) && f58.R1.cases === 11 && f58.R1.casesRun === 11 && f58.R1.reproductions === 0 && f58.R1.casesWithoutVerdict.length === 0,
  f58?.R1 ?? null,
  `R-1 cases run ${f58?.R1?.casesRun ?? '?'}/11; reproductions ${f58?.R1?.reproductions ?? '?'}; without a verdict: ${(f58?.R1?.casesWithoutVerdict ?? []).join(', ')}`);

// GATE 3
{
  const eh = (n1Final?.attempts ?? []).filter((a) => a.id === 'EH-WT-03');
  const ehOk = eh.filter((a) => a.actual === 'FAIL').length >= 3 && eh.every((a) => a.actual !== 'PASS') && sameProductSources(n1Final?.rigorrunCommit);
  const v2Ok = Boolean(v2) && v2.blocks?.gate?.passes === true && v2.blocks?.['side-channel']?.passes === true && sameProductSources(v2.rigorrunCommit);
  // No cross-regression has to be shown, not assumed: a case correct at AFTER-2 with no verdict now is unmeasured, and fails the gate like any missing evidence.
  const crossOk = Boolean(cross) && cross.summary.frozenResultsPresent && cross.summary.regressions.length === 0 && (cross.summary.unmeasured ?? [null]).length === 0;
  const t = inprocess?.totals;
  const inprocessOk = Boolean(t) && t.cases === t.matchingExpected && t.knownGoodIncorrectlyFailed === 0 && t.knownBadIncorrectlyPassed === 0 && inprocess.rigorrunCommit && sameProductSources(inprocess.rigorrunCommit);
  gate('GATE_3', 'N1: EH-WT-03 still FAIL; Worktide v2 held-out clean; no N-1 cross-regression in the frozen 58 (and the in-process held-out set at the product commit)',
    ehOk && v2Ok && crossOk && inprocessOk,
    { ehWt03: { rigorrunCommit: n1Final?.rigorrunCommit, productSourcesEqual: sameProductSources(n1Final?.rigorrunCommit), outcomes: eh.map((a) => a.actual) },
      heldoutWorktideV2: { rigorrunCommit: v2?.rigorrunCommit, productSourcesEqual: sameProductSources(v2?.rigorrunCommit), gate: v2?.blocks?.gate, sideChannel: v2?.blocks?.['side-channel'] },
      crossRegression: cross?.summary ?? null,
      heldoutInprocess: inprocess ? { rigorrunCommit: inprocess.rigorrunCommit, ...t } : null },
    [!ehOk && 'EH-WT-03 evidence', !v2Ok && 'Worktide v2', !crossOk && (cross ? `cross-regression: ${cross.summary.regressions.length} measured regression(s)${cross.summary.regressions.length ? ` (${cross.summary.regressions.map((r) => r.id).join(', ')})` : ''}; ${(cross.summary.unmeasured ?? []).length} frozen case(s) correct at AFTER-2 have no verdict now, so no cross-regression cannot be shown (${(cross.summary.unmeasured ?? []).map((r) => r.id).join(', ')})` : 'cross-regression evidence missing'), !inprocessOk && 'in-process held-out'].filter(Boolean).join('; '));
}

// GATE 4
{
  const kg = f58?.KNOWN_GOOD;
  gate('GATE_4', 'FALSE_POSITIVES (strict): no known-good frozen case graded anything but TRUE_NEGATIVE, under either rule, on any attempt',
    Boolean(f58) && f58.FP === 0 && f58.ORIGINAL_RULE.FP === 0 && f58.ATTEMPT_LEVEL.FP === 0 && f58.ATTEMPT_LEVEL.ORIGINAL_RULE_FP === 0 && kg.attempts > 0 && kg.notGradedTrueNegative.length === 0,
    { FP: f58?.FP, originalRuleFP: f58?.ORIGINAL_RULE?.FP, attemptFP: f58?.ATTEMPT_LEVEL?.FP, attemptOriginalRuleFP: f58?.ATTEMPT_LEVEL?.ORIGINAL_RULE_FP, knownGood: kg ?? null },
    `known-good attempts not TRUE_NEGATIVE: ${(kg?.notGradedTrueNegative ?? []).map((a) => `${a.id}#${a.attempt} ${a.outcome}`).join('; ') || 'none'}; FP ${f58?.FP}/${f58?.ORIGINAL_RULE?.FP}`);
}

// GATE 5
gate('GATE_5', 'FALSE_NEGATIVES: no independently known-bad scored case receives PASS',
  Boolean(f58) && f58.KNOWN_BAD.attemptsGivenPass.length === 0 && f58.FN === 0 && f58.ORIGINAL_RULE.FN === 0 && f58.ATTEMPT_LEVEL.FN === 0 && f58.ATTEMPT_LEVEL.ORIGINAL_RULE_FN === 0,
  { knownBad: f58?.KNOWN_BAD ?? null, FN: f58?.FN, originalRuleFN: f58?.ORIGINAL_RULE?.FN },
  `known-bad attempts given PASS: ${(f58?.KNOWN_BAD?.attemptsGivenPass ?? []).map((a) => `${a.id}#${a.attempt}`).join(', ')}`);

// GATE 6
gate('GATE_6', 'INJECTED_FAILURES: every reachable injected failure detected on every attempt',
  Boolean(f58) && f58.INJECTED.reachableAttempts > 0 && f58.INJECTED.detectedAttempts === f58.INJECTED.reachableAttempts,
  f58?.INJECTED ?? null,
  `reachable injected attempts ${f58?.INJECTED?.reachableAttempts ?? '?'}, detected ${f58?.INJECTED?.detectedAttempts ?? '?'}`);

// GATE 7
{
  const s = io?.summary;
  const planned = (io?.cases ?? []).filter((c) => c.gates.includes('INDEPENDENT_ORACLE'));
  const complete = planned.every((c) => c.attempts === c.attemptsPlanned);
  gate('GATE_7', 'INDEPENDENT_ORACLE: IO-1…IO-7 (with IO-5 state-observable and IO-7 mixed nomination gated) behave exactly as specified; independent evidence overrides self-reported evidence',
    Boolean(s) && planned.length === 10 && complete && s.independentOracleGate.failing.length === 0 && s.independentOracleGate.guardViolations.length === 0,
    { gatedCases: s?.independentOracleGate?.cases ?? null, failing: s?.independentOracleGate?.failing ?? null, guardViolations: s?.independentOracleGate?.guardViolations ?? null,
      perCase: Object.fromEntries((io?.cases ?? []).map((c) => [c.id, { expected: c.expected, outcomes: c.outcomes, labels: c.labels, oracle: c.oracleVerdicts, allAttemptsMatch: c.allAttemptsMatch }])) },
    `IO cases not as specified: ${(s?.independentOracleGate?.failing ?? []).map((id) => { const c = io.cases.find((x) => x.id === id); return `${id} (expected ${c.expected.outcome}, got ${c.outcomes.join('/')}, oracle ${c.oracleVerdicts.join('/')})`; }).join('; ')}`);
}

// GATE 8
{
  const s = io?.summary;
  const frozenPassWithMissing = Object.values(f58?.cases ?? {}).flatMap((c) => c.perAttempt.filter((a) => a.rigorrunOutcome === 'PASS' && (a.missingEvidence ?? []).length > 0).map((a) => `${c.id}#${a.attempt}`));
  const ioPassWithMissing = (io?.cases ?? []).flatMap((c) => c.perAttempt.filter((a) => a.outcome === 'PASS' && (a.missingEvidence ?? []).length > 0).map((a) => `${c.id}#${a.attempt}`));
  gate('GATE_8', 'ABSTENTION: without authoritative evidence RigorRun never gives PASS',
    Boolean(s) && Boolean(f58) && s.abstentionGate.failing.length === 0 && frozenPassWithMissing.length === 0 && ioPassWithMissing.length === 0,
    { abstentionCases: s?.abstentionGate ?? null, frozenPassWithMissingEvidence: frozenPassWithMissing, ioPassWithMissingEvidence: ioPassWithMissing },
    `abstention cases failing: ${(s?.abstentionGate?.failing ?? []).join(', ')}; PASS with missing evidence: ${[...frozenPassWithMissing, ...ioPassWithMissing].join(', ')}`);
}

// GATE 9
{
  const statements = targets?.targets ?? [];
  const planned = ['Playwright MCP', 'GitHub MCP', 'Filesystem MCP'];
  const missing = planned.filter((name) => !statements.some((t) => t.name === name));
  const unsupported = statements.filter((t) => ['UNSUPPORTED', 'UNKNOWN'].includes(t.status)).map((t) => `${t.name}: ${t.status}`);
  gate('GATE_9', 'MCP_COMPAT: supported MCP behaviour explicitly known; no compatibility ambiguity that would invalidate the next audits',
    Boolean(preflight) && preflight.statuses.FAIL === 0 && existsSync(join(FQ, 'mcp-compatibility.md')) && missing.length === 0 && unsupported.length === 0,
    { preflight: preflight?.statuses ?? null, targets: statements, missingStatements: missing },
    `preflight FAIL checks ${preflight?.statuses?.FAIL ?? '?'}; missing target statements: ${missing.join(', ') || 'none'}; unsupported: ${unsupported.join(', ') || 'none'}`);
}

// GATE 10
{
  const f = results?.checks?.final;
  const testsOk = Boolean(f?.test?.parsed) && f.test.failed === 0 && f.test.passed + (f.test.skipped ?? 0) === f.test.total && (f.test.skipped ?? 0) === 0 && f.test.exit === 0;
  const typeOk = f?.typecheck?.exit === 0;
  const lintOk = f?.lint?.exit === 0;
  const e2eOk = Boolean(f?.e2e) && f.e2e.exit === 0 && f.e2e.failed === 0 && f.e2e.passed > 0;
  gate('GATE_10', 'TESTS: unit/integration, e2e, typecheck and lint all pass at the product commit',
    testsOk && typeOk && lintOk && e2eOk,
    { test: f?.test ?? null, typecheck: f?.typecheck ?? null, lint: f?.lint ?? null, e2e: f?.e2e ?? null },
    [!testsOk && 'unit/integration', !typeOk && 'typecheck', !lintOk && 'lint', !e2eOk && 'e2e'].filter(Boolean).join(', '));
}

// GATE 11
{
  const productCheck = run('node', [join(HERE, 'product-under-test.mjs'), '--check']);
  const quarantine = run('python3', [join(HERE, 'fq_hygiene.py'), 'quarantine-check']);
  const ioFreeze = read(join(HERE, 'io', 'freeze.json'));
  const ioChanged = Object.entries(ioFreeze?.files ?? {}).filter(([file, hash]) => createHash('sha256').update(readFileSync(join(HERE, 'io', file))).digest('hex') !== hash).map(([file]) => file);
  gate('GATE_11', 'BENCHMARK_INTEGRITY: no frozen label or benchmark definition changed',
    productCheck.code === 0 && quarantine.code === 0 && Boolean(ioFreeze) && ioChanged.length === 0,
    { productUnderTestCheck: productCheck.out, frozenAuditFiles: quarantine.out, independentOracleFreeze: { files: Object.keys(ioFreeze?.files ?? {}).length, changed: ioChanged } },
    `${productCheck.code !== 0 ? productCheck.out : ''} ${quarantine.code !== 0 ? quarantine.out : ''} ${ioChanged.length ? `IO files changed: ${ioChanged.join(', ')}` : ''}`.trim());
}

// GATE 12
{
  const diff = product ? execFileSync('git', ['-C', REPO, 'diff', AUDITED, product.productCommit, '--', 'packages', 'apps'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) : '';
  const FORBIDDEN = /mailhog|greenmail|worktide|email-mcp|mcp-server-sqlite|\bsqlite\b|audit 17|quarterly report|example\.test|check_inbox|send_email|time\.(start|stop)|tasks\.search|\bp_[0-9a-f]{12}\b|\bEM-GMA?-\d|\bSQ-(W1B?|LLM|D)-\d|\bWT-D-\d|\bEH-WT-\d|\bV2-[TSLMU]-\d|taskdesk|create_task|query_tasks|\bIO-\d/i;
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
  generatedBy: 'final-qualification/scripts/release-gate-final.mjs',
  productCommit: product?.productCommit ?? null,
  packageVersion: product?.packageVersion ?? null,
  status: passed ? 'GO_FOR_POPULAR_MCP_AUDITS' : 'NO_GO',
  gates,
  blockers: gates.filter((g) => g.status === 'FAIL').map((g) => ({ gate: g.id, blocker: g.blocker })),
};
writeFileSync(join(FQ, 'release-gate.json'), JSON.stringify(report, null, 2) + '\n');
for (const g of gates) console.log(`${g.status.padEnd(4)}  ${g.id.padEnd(8)} ${g.title}`);
console.log(report.status);
process.exit(passed ? 0 : 1);
