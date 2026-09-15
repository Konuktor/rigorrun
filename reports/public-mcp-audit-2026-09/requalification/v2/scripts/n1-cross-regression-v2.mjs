#!/usr/bin/env node
/**
 * benchmark-v2's N-1 cross-regression check, derived from
 * final-qualification/scripts/n1-cross-regression.mjs (every change is listed below):
 * what the generic identity change did to every
 * frozen journey's compiled suite, and whether any frozen case got worse.
 *
 *   node n1-cross-regression-v2.mjs
 *
 * Compares, per journey, AFTER-2's setup artefacts (remediation/after/traces/<target>/<journey>-setup,
 * built before N-1) with this run's (requalification/v2/evidence/run/traces/...):
 * induced entities and their identity fields, the contract's focus entity and
 * expected delta, deletions, creations and changes, and the generated checks.
 * It then lists every frozen case whose classification moved from AFTER-2,
 * and flags as a regression any case that was correct at AFTER-2 (TRUE_POSITIVE
 * or TRUE_NEGATIVE on every attempt) and is not correct now.
 *
 * Specific signs looked for, per journey:
 *   - an identity field that is a value the demonstration changed (changed value used as identity)
 *   - a field that was the identity at AFTER-2 and is now treated as a plain value (and the reverse)
 *   - an entity whose identity field is nullable (null identity fields)
 *   - duplicate record keys in a run's final-state summary (rows overwriting each other)
 *   - a focus entity or expected delta that moved (expected delta applied to a different entity)
 *
 * Changes from the final qualification's copy, and nothing else:
 *   - journeys: the four projects the frozen RigorRun-mode cases use, the ones benchmark-v2 sets up;
 *   - this run: benchmark-v2's setup traces and requalification/results-v2.json;
 *   - a case is compared on its happy_path generated case, the one AFTER-2 scored, and is
 *     unmeasured unless every planned attempt of it was scored;
 *   - duplicate keys are read from benchmark-v2's attempt run files;
 *   - there is no happy-path-only diagnostic to compare: benchmark-v2 scores every generated case.
 *
 * Writes requalification/evidence/n1-cross-regression-v2.json and .md. Exit 1 when a regression is found.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2 = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const RQ = resolve(V2, '..');
const REMEDIATION = resolve(RQ, '..', 'remediation');
const BEFORE = join(REMEDIATION, 'after', 'traces');
const NOW = join(V2, 'evidence', 'run', 'traces');
const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

const JOURNEYS = [
  ['sqlite-mcp', 'w1'], ['sqlite-mcp', 'w1b'], ['email-mcp', 'gm-w1'], ['email-mcp', 'gm-fault'],
];

function artefacts(root, target, journey) {
  const dir = join(root, target, `${journey}-setup`);
  if (!existsSync(dir)) return null;
  const schema = read(join(dir, 'schema.json'));
  const contract = read(join(dir, 'contract-proposed.json')) ?? read(join(dir, 'contract.json'));
  const benchmark = read(join(dir, 'benchmark.json')) ?? read(join(dir, 'benchmark-summary.json'));
  return { dir, schema, contract, benchmark };
}

function entitiesOf(schema) {
  return Object.fromEntries((schema?.entities ?? []).map((e) => [e.name, {
    idField: e.idField ?? null,
    identityFields: (e.fields ?? []).filter((f) => f.role === 'identifier').map((f) => f.name),
    nullableIdentity: (e.fields ?? []).some((f) => f.name === e.idField && f.nullable),
    keyFields: e.keyFields ?? e.identity ?? null,
    fields: (e.fields ?? []).map((f) => f.name),
  }]));
}

function checksOf(benchmark, contract) {
  const fromCases = (benchmark?.cases ?? []).flatMap((c) => (c.checks ?? c.assertions ?? []).map((a) => a.id ?? a.assertionId)).filter(Boolean);
  const fromContract = (contract?.successAssertions ?? []).map((a) => a.id).filter(Boolean);
  return [...new Set([...fromCases, ...fromContract])].sort();
}

function contractFacts(contract) {
  if (!contract) return null;
  return {
    focusEntity: contract.focusEntity ?? null,
    focusScope: contract.focusScope ?? null,
    primaryAction: contract.primaryAction ?? null,
    expectedDeltaCount: contract.expectedDeltaCount ?? null,
    expectedDeletedCount: contract.expectedDeletedCount ?? null,
    expectedCreatedCount: contract.expectedCreatedCount ?? null,
    expectedChanges: contract.expectedChanges ?? null,
    argumentBindings: (contract.argumentBindings ?? []).map((b) => `${b.field}<-${b.param}:${b.mode}`).sort(),
  };
}

/** Fields whose values the demonstration changed on a record that kept its identity — never valid as an identity. */
function changedFieldsOf(contract) {
  return new Set((contract?.expectedChanges ?? []).flatMap((c) => Object.keys(c.fields ?? c.changes ?? {}).concat(c.field ? [c.field] : [])));
}

const journeys = JOURNEYS.map(([target, journey]) => {
  const before = artefacts(BEFORE, target, journey);
  const now = artefacts(NOW, target, journey);
  const beforeEntities = entitiesOf(before?.schema);
  const nowEntities = entitiesOf(now?.schema);
  const names = [...new Set([...Object.keys(beforeEntities), ...Object.keys(nowEntities)])].sort();
  const identity = names.map((name) => {
    const b = beforeEntities[name] ?? null;
    const n = nowEntities[name] ?? null;
    return {
      entity: name,
      before: b && { idField: b.idField, identityFields: b.identityFields },
      now: n && { idField: n.idField, identityFields: n.identityFields },
      idFieldChanged: (b?.idField ?? null) !== (n?.idField ?? null),
      identityNowPlainValue: b && n ? b.identityFields.filter((f) => !n.identityFields.includes(f)) : [],
      plainValueNowIdentity: b && n ? n.identityFields.filter((f) => !b.identityFields.includes(f)) : [],
      nullableIdentityNow: n?.nullableIdentity ?? null,
    };
  });
  const changed = changedFieldsOf(now?.contract);
  const changedValueAsIdentity = Object.entries(nowEntities).filter(([, e]) => e.idField && changed.has(e.idField)).map(([name, e]) => `${name}.${e.idField}`);
  const beforeFacts = contractFacts(before?.contract);
  const nowFacts = contractFacts(now?.contract);
  const beforeChecks = checksOf(before?.benchmark, before?.contract);
  const nowChecks = checksOf(now?.benchmark, now?.contract);
  return {
    journey: `${target}/${journey}`,
    compiledBefore: Boolean(before?.contract),
    compiledNow: Boolean(now?.contract),
    identity,
    changedValueAsIdentity,
    contract: { before: beforeFacts, now: nowFacts, focusEntityMoved: (beforeFacts?.focusEntity ?? null) !== (nowFacts?.focusEntity ?? null) },
    checks: { before: beforeChecks, now: nowChecks, added: nowChecks.filter((c) => !beforeChecks.includes(c)), removed: beforeChecks.filter((c) => !nowChecks.includes(c)) },
    suiteShape: {
      before: (before?.benchmark?.cases ?? []).map((c) => `${c.category}:${c.id}`),
      now: (now?.benchmark?.cases ?? []).map((c) => `${c.category}:${c.id}`),
      changed: JSON.stringify((before?.benchmark?.cases ?? []).map((c) => c.category)) !== JSON.stringify((now?.benchmark?.cases ?? []).map((c) => c.category)),
    },
    relationships: { before: (before?.schema?.relationships ?? []).map((r) => r.name), now: (now?.schema?.relationships ?? []).map((r) => r.name) },
    inferredRules: { before: (before?.contract?.rules ?? []).map((r) => r.id), now: (now?.contract?.rules ?? []).map((r) => r.id) },
  };
});

// Frozen cases: AFTER-2 against now, attempt by attempt.
const after2 = read(join(REMEDIATION, 'after-results.json'));
const results = read(join(RQ, 'results-v2.json'));
const nowCases = results?.cases ?? {};
const CORRECT = ['TRUE_POSITIVE', 'TRUE_NEGATIVE'];
const moved = [];
const regressions = [];
// Correct at AFTER-2 and without a verdict now: not a measured regression, and not evidence of its absence either.
const unmeasured = [];
for (const before of after2?.cases ?? []) {
  // benchmark-v2 scores every generated case; AFTER-2 scored the demonstrated one, and that is what is compared.
  const nowCase = nowCases[before.id];
  const happy = nowCase?.generated?.find((g) => g.generatedCaseId === 'case_live__happy_path');
  const allScored = Boolean(happy) && happy.perAttempt.every((a) => a.scored);
  const now = nowCase && happy
    ? { mode: nowCase.mode, attempts: allScored ? happy.perAttempt.length : 0, perAttempt: allScored ? happy.perAttempt : [], outcomeClassification: happy.outcomeClassification, classification: happy.classification, notRunReason: happy.perAttempt.find((a) => !a.scored)?.reason ?? nowCase.notRunReason }
    : null;
  if (!now || before.mode !== 'rigorrun') continue;
  const beforeCorrect = before.attempts > 0 && CORRECT.includes(before.outcomeClassification) && CORRECT.includes(before.classification);
  const nowCorrect = now.attempts > 0 && now.perAttempt.every((a) => CORRECT.includes(a.outcomeClassification) && CORRECT.includes(a.classification));
  const entry = { id: before.id, after2: { outcome: before.outcomeClassification, originalRule: before.classification, attempts: before.attempts }, now: { outcome: now.outcomeClassification, originalRule: now.classification, attempts: now.attempts } };
  if (entry.after2.outcome !== entry.now.outcome || entry.after2.originalRule !== entry.now.originalRule) moved.push(entry);
  if (beforeCorrect && now.attempts === 0) unmeasured.push({ ...entry, reason: now.notRunReason ?? 'not run now' });
  else if (beforeCorrect && !nowCorrect) regressions.push({ ...entry, reason: 'correct at AFTER-2, not correct on every attempt now' });
}

// Rows overwriting each other: duplicate keys in the final-state summaries RigorRun recorded this run.
const duplicateKeys = [];
for (const [id, c] of Object.entries(nowCases)) {
  if (c.mode !== 'rigorrun') continue;
  for (let attempt = 1; attempt <= c.attempts; attempt += 1) {
    const dir = join(V2, 'evidence', 'run', 'evidence', c.target, id, `attempt-${attempt}`);
    const run = read(join(dir, 'rigorrun-run.json'));
    for (const r of run?.caseResults ?? []) {
      const summary = r.finalStateSummary ?? {};
      for (const [entity, rows] of Object.entries(summary)) {
        if (!Array.isArray(rows)) continue;
        const keys = rows.map((row) => row?.id ?? row?.__key ?? null).filter((k) => k !== null).map(String);
        const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
        if (dupes.length > 0) duplicateKeys.push({ id, attempt, entity, keys: [...new Set(dupes)] });
      }
    }
  }
}

function diagnosticComparison() {
  // benchmark-v2 has no happy-path-only diagnostic: every generated case is scored.
  return null;
}

const summary = {
  journeysCompared: journeys.length,
  journeysCompiledNow: journeys.filter((j) => j.compiledNow).length,
  identityChanges: journeys.flatMap((j) => j.identity.filter((e) => e.idFieldChanged).map((e) => ({ journey: j.journey, entity: e.entity, before: e.before?.idField ?? null, now: e.now?.idField ?? null }))),
  changedValueAsIdentity: journeys.flatMap((j) => j.changedValueAsIdentity.map((x) => `${j.journey}:${x}`)),
  nullableIdentityNow: journeys.flatMap((j) => j.identity.filter((e) => e.nullableIdentityNow).map((e) => `${j.journey}:${e.entity}`)),
  focusEntityMoved: journeys.filter((j) => j.contract.focusEntityMoved).map((j) => ({ journey: j.journey, before: j.contract.before?.focusEntity ?? null, now: j.contract.now?.focusEntity ?? null })),
  duplicateKeysInFinalState: duplicateKeys,
  suiteShapeChanges: journeys.filter((j) => j.suiteShape.changed).map((j) => ({ journey: j.journey, before: j.suiteShape.before, now: j.suiteShape.now })),
  casesWhoseClassificationMoved: moved,
  regressions,
  unmeasured,
  greenmailHappyPathDiagnostic: diagnosticComparison(),
  frozenResultsPresent: Boolean(results),
};
const report = { generatedBy: 'requalification/v2/scripts/n1-cross-regression-v2.mjs', summary, journeys };
writeFileSync(join(RQ, 'evidence', 'n1-cross-regression-v2.json'), JSON.stringify(report, null, 2) + '\n');

const md = [
  '# N-1 cross-regression check (benchmark-v2)',
  '',
  'Generated by `requalification/v2/scripts/n1-cross-regression-v2.mjs` from AFTER-2 setup artefacts (before N-1) and benchmark-v2\'s. Numbers here are not typed by hand.',
  '',
  `- Journeys compared: ${summary.journeysCompared}; compiled now: ${summary.journeysCompiledNow}.`,
  `- Frozen RigorRun-mode cases correct at AFTER-2 and measured not correct now (regressions): ${regressions.length}${regressions.length ? ` — ${regressions.map((r) => r.id).join(', ')}` : ''}.`,
  `- Correct at AFTER-2 and without a verdict now (unmeasured, so no-regression cannot be shown for them): ${unmeasured.length}${unmeasured.length ? ` — ${unmeasured.map((r) => `${r.id} (${r.reason})`).join(', ')}` : ''}.`,
  `- Generated suite shape changed: ${summary.suiteShapeChanges.length ? summary.suiteShapeChanges.map((c) => `${c.journey} [${c.before.join(', ')}] → [${c.now.join(', ')}]`).join('; ') : 'none'}.`,
  `- GreenMail happy-path-only diagnostic (deviation, not a gate input): ${summary.greenmailHappyPathDiagnostic ? `${summary.greenmailHappyPathDiagnostic.correctOnEveryAttempt} of ${summary.greenmailHappyPathDiagnostic.casesRun} cases correct on every attempt; regressions against AFTER-2: ${summary.greenmailHappyPathDiagnostic.regressions.map((r) => r.id).join(', ') || 'none'}` : 'not run'}.`,
  `- Cases whose classification moved from AFTER-2: ${moved.length}${moved.length ? ` — ${moved.map((m) => `${m.id} (${m.after2.outcome} → ${m.now.outcome})`).join('; ')}` : ''}.`,
  `- Identity field changes: ${summary.identityChanges.length}${summary.identityChanges.length ? ` — ${summary.identityChanges.map((c) => `${c.journey} ${c.entity}: ${c.before} → ${c.now}`).join('; ')}` : ''}.`,
  `- Identity field that is a value the demonstration changed: ${summary.changedValueAsIdentity.length ? summary.changedValueAsIdentity.join(', ') : 'none'}.`,
  `- Nullable identity field: ${summary.nullableIdentityNow.length ? summary.nullableIdentityNow.join(', ') : 'none'}.`,
  `- Focus entity moved: ${summary.focusEntityMoved.length ? summary.focusEntityMoved.map((f) => `${f.journey} ${f.before} → ${f.now}`).join('; ') : 'none'}.`,
  `- Duplicate record keys in a recorded final state: ${duplicateKeys.length ? JSON.stringify(duplicateKeys) : 'none'}.`,
  '',
  '## Per journey',
  '',
  ...journeys.flatMap((j) => [
    `### ${j.journey}`,
    '',
    `- compiled: before ${j.compiledBefore}, now ${j.compiledNow}`,
    `- focus: ${j.contract.before?.focusEntity ?? '—'} → ${j.contract.now?.focusEntity ?? '—'}; scope ${j.contract.before?.focusScope ?? '—'} → ${j.contract.now?.focusScope ?? '—'}`,
    `- expected delta ${j.contract.before?.expectedDeltaCount ?? '—'} → ${j.contract.now?.expectedDeltaCount ?? '—'}; deleted ${j.contract.before?.expectedDeletedCount ?? '—'} → ${j.contract.now?.expectedDeletedCount ?? '—'}; created ${j.contract.before?.expectedCreatedCount ?? '—'} → ${j.contract.now?.expectedCreatedCount ?? '—'}; changes ${JSON.stringify(j.contract.before?.expectedChanges ?? null)} → ${JSON.stringify(j.contract.now?.expectedChanges ?? null)}`,
    `- identities: ${j.identity.map((e) => `${e.entity} ${e.before?.idField ?? '—'} → ${e.now?.idField ?? '—'}`).join('; ') || 'none'}`,
    `- checks added: ${j.checks.added.join(', ') || 'none'}; removed: ${j.checks.removed.join(', ') || 'none'}`,
    `- suite: [${j.suiteShape.before.join(', ')}] → [${j.suiteShape.now.join(', ')}]; relationships: [${j.relationships.before.join(', ')}] → [${j.relationships.now.join(', ')}]; inferred rules: [${j.inferredRules.before.join(', ')}] → [${j.inferredRules.now.join(', ')}]`,
    '',
  ]),
].join('\n');
writeFileSync(join(RQ, 'evidence', 'n1-cross-regression-v2.md'), md + '\n');
console.log(`journeys ${summary.journeysCompared} (compiled now ${summary.journeysCompiledNow}); regressions ${regressions.length}; unmeasured ${unmeasured.length}; suite shape changes ${summary.suiteShapeChanges.length}; moved ${moved.length}; identity changes ${summary.identityChanges.length}; changed-value identities ${summary.changedValueAsIdentity.length}; duplicate keys ${duplicateKeys.length}`);
process.exit(regressions.length > 0 ? 1 : 0);
