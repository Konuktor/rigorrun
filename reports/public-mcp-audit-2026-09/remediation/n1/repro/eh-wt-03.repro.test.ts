/**
 * N-1 / EH-WT-03, reproduced in-process from frozen artefacts. No Worktide stack.
 *
 * Not part of CI. run-repro.sh copies this file into packages/runner/test, runs
 * it and removes it. It writes n1/evidence/repro-<label>.json.
 *
 * Inputs, all frozen:
 * - n1/evidence/frozen/w2-*.json: the re-created W2 project's schema, contract,
 *   benchmark, demonstration trace and induced schema, copied from the git-ignored
 *   project home with their source checksums (SHA256SUMS.source).
 * - heldout/external/evidence/EH-WT-03/: the committed RigorRun run record and
 *   the oracle's before/after reads for the held-out case.
 * - after/traces/worktide-mcp/w2-setup/teach.json: the demonstrated calls' results.
 *
 * What it proves:
 * 1. The case's starting world is the demonstration's `before` state and its final
 *    world is the run's `finalStateSummary`: both rebuilt states hash to the
 *    run's recorded initialStateHash and finalStateHash.
 * 2. Replaying the production projection and verifier over those states with the
 *    frozen checks gives the frozen verdict.
 * 3. Re-inducing a schema from the demonstration's answers (reconstructed from the
 *    trace rows) with the code under test shows which identity it chooses.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashValue, type Benchmark } from '@rigorrun/core';
import { buildProjection, diffStates, type CanonicalState, type EnvironmentSchema } from '@rigorrun/environment';
import { resolvePath, verify } from '@rigorrun/verifier';
import { normalizeToolResult } from '@rigorrun/connector';
import { induceSchema, type PayloadObservation } from '../../mcp/src/index.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const REMEDIATION = join(REPO, 'reports', 'public-mcp-audit-2026-09', 'remediation');
const N1 = join(REMEDIATION, 'n1');
const FROZEN = join(N1, 'evidence', 'frozen');
const CASE_DIR = join(REMEDIATION, 'heldout', 'external', 'evidence', 'EH-WT-03');
const LABEL = process.env['N1_REPRO_LABEL'] ?? 'adhoc';

const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

type Row = Record<string, unknown>;
interface Trace { before: CanonicalState; after: CanonicalState }
interface CaseRun {
  initialStateHash: string;
  finalStateHash: string;
  outcome: string;
  outcomeReason: string;
  steps: { tool: string; args: Row; ok: boolean; result?: { type: string; text: string }[] }[];
  assertions: { assertionId: string; status: string; observed?: unknown; message: string }[];
  finalStateSummary: Record<string, { count: number; rows: Row[] }>;
}

const schema = json<EnvironmentSchema>(join(FROZEN, 'w2-schema.json'));
const contract = json<Record<string, unknown>>(join(FROZEN, 'w2-contract.json'));
const benchmark = json<Benchmark>(join(FROZEN, 'w2-benchmark.json'));
const trace = json<Trace>(join(FROZEN, 'w2-trace.json'));
const run = json<{ caseResults: CaseRun[]; rigorrunVersion: string }>(join(CASE_DIR, 'rigorrun-run.json'));
const oracleBefore = json<{ time_entries: { task: string | null; durationMinutes: number }[]; db_time_entry_count: number }>(join(CASE_DIR, 'before.json'));
const oracleAfter = json<typeof oracleBefore>(join(CASE_DIR, 'after.json'));
const teach = json<{ step: { tool?: string }; result?: { data: unknown } }[]>(
  join(REMEDIATION, 'after', 'traces', 'worktide-mcp', 'w2-setup', 'teach.json'),
);
const caseRun = run.caseResults[0]!;
const testCase = benchmark.cases[0]!;
const idOf = (name: string) => schema.entities.find((e) => e.name === name)!.idField;

/** The final world as the runner held it: each summarised table keyed by the schema's identifier. */
function finalFromSummary(): CanonicalState {
  const entities: CanonicalState['entities'] = {};
  for (const [name, table] of Object.entries(caseRun.finalStateSummary)) {
    expect(table.rows.length, `${name} summary is complete`).toBe(table.count);
    entities[name] = Object.fromEntries(table.rows.map((row) => [String(row[idOf(name)]), row]));
  }
  return { entities };
}

const unassignedMinutes = (entries: typeof oracleBefore.time_entries) =>
  entries.filter((entry) => entry.task === null).reduce((sum, entry) => sum + entry.durationMinutes, 0);

describe('N-1 / EH-WT-03 from frozen artefacts', () => {
  it('rebuilds the case worlds exactly, replays the verdict, and records every step', async () => {
    const initial = trace.before;
    const final = finalFromSummary();
    const initialHash = await hashValue(initial);
    const finalHash = await hashValue(final);
    expect(initialHash).toBe(caseRun.initialStateHash);
    expect(finalHash).toBe(caseRun.finalStateHash);

    const { derived } = buildProjection(schema, {
      seed: initial,
      final,
      events: [],
      focus: benchmark.projectionFocus,
      knownEventTypes: [],
    });
    const summary = verify(testCase.checks, { state: final, derived, events: [] });
    const replayed = summary.results.map((r) => ({ id: r.assertionId, status: r.status, message: r.message }));
    expect(replayed.map((r) => [r.id, r.status])).toEqual(caseRun.assertions.map((a) => [a.assertionId, a.status]));
    const failed = summary.results.some((r) => r.status === 'FAIL' || r.status === 'ERROR');
    const outcome = failed ? 'FAIL' : summary.taskSuccess && summary.blockingUnverifiable === 0 ? 'PASS' : 'ABSTAIN';
    expect(outcome).toBe(caseRun.outcome);

    // The demonstration's answers, as the daemon handed them to induction: every
    // nominated read before the job, the job's own results, every read after.
    // Reconstructed from the trace rows (the raw answers are not kept after
    // finishing a recording): a report is its header row with its groups nested,
    // and the task search is its rows under `tasks`.
    const reportOf = (state: CanonicalState) => ({
      ...Object.values(state.entities['Record1'] ?? {})[0],
      groups: Object.values(state.entities['Group'] ?? {}),
    });
    const tasksOf = (state: CanonicalState) => ({ tasks: Object.values(state.entities['Task'] ?? {}) });
    const reading = (read: string, moment: 'before' | 'after') => ({ reading: { read, moment } });
    const actionResults: PayloadObservation[] = teach
      .filter((entry) => entry.step.tool && entry.result)
      .map((entry) => ({ tool: entry.step.tool!, payload: normalizeToolResult({ content: entry.result!.data as never }).payload }))
      .filter((observation) => observation.payload !== undefined);
    const observations = [
      { tool: 'before', payload: reportOf(trace.before), ...reading('1:time.report', 'before') },
      { tool: 'before', payload: tasksOf(trace.before), ...reading('2:tasks.search', 'before') },
      ...actionResults,
      { tool: 'after', payload: reportOf(trace.after), ...reading('1:time.report', 'after') },
      { tool: 'after', payload: tasksOf(trace.after), ...reading('2:tasks.search', 'after') },
    ] as PayloadObservation[];
    const reinduced = induceSchema(observations);
    const identityOf = (entity: EnvironmentSchema['entities'][number] & { keyFields?: string[]; identity?: string }) => ({
      name: entity.name,
      idField: entity.idField,
      ...(entity.keyFields ? { keyFields: entity.keyFields } : {}),
      ...(entity.identity ? { identity: entity.identity } : {}),
    });

    const record = {
      label: LABEL,
      measuredAtCommit: process.env['N1_REPRO_COMMIT'] ?? null,
      inputs: {
        frozen: 'n1/evidence/frozen/w2-{schema,contract,benchmark,trace,induced}.json (see SHA256SUMS.source)',
        run: 'heldout/external/evidence/EH-WT-03/rigorrun-run.json',
        oracle: 'heldout/external/evidence/EH-WT-03/{before,after}.json',
      },
      reproductionFidelity: {
        initialStateHash: { recorded: caseRun.initialStateHash, rebuilt: initialHash },
        finalStateHash: { recorded: caseRun.finalStateHash, rebuilt: finalHash },
      },
      oracle: {
        timeEntries: { before: oracleBefore.db_time_entry_count, after: oracleAfter.db_time_entry_count },
        unassignedMinutes: { before: unassignedMinutes(oracleBefore.time_entries), after: unassignedMinutes(oracleAfter.time_entries) },
      },
      frozenSchemaIdentity: schema.entities.map((entity) => identityOf(entity)),
      initialObservedState: { Group: Object.entries(initial.entities['Group'] ?? {}), Record1: Object.entries(initial.entities['Record1'] ?? {}) },
      demonstration: {
        before: { Group: Object.entries(trace.before.entities['Group'] ?? {}), Record1: Object.entries(trace.before.entities['Record1'] ?? {}) },
        after: { Group: Object.entries(trace.after.entities['Group'] ?? {}), Record1: Object.entries(trace.after.entities['Record1'] ?? {}) },
        deltas: diffStates(schema, trace.before, trace.after),
      },
      expectedDelta: {
        focusEntity: contract['focusEntity'],
        focusScope: contract['focusScope'],
        expectedDeltaCount: contract['expectedDeltaCount'],
        expectedDeletedCount: contract['expectedDeletedCount'],
        argumentBindings: contract['argumentBindings'],
        expectedChanges: contract['expectedChanges'] ?? null,
      },
      actualAgentActions: caseRun.steps.map((step) => ({
        tool: step.tool,
        args: step.args,
        ok: step.ok,
        result: step.result?.[0]?.text ? JSON.parse(step.result[0].text) : null,
      })),
      actualFinalState: { Group: Object.entries(final.entities['Group'] ?? {}), Record1: Object.entries(final.entities['Record1'] ?? {}) },
      caseDeltas: diffStates(schema, initial, final),
      projection: {
        created: derived.created['Group'],
        changed: derived.changed['Group'],
        deleted: derived.deleted['Group'],
        count: derived.count['Group'],
      },
      comparatorInput: testCase.checks.map((check) => ({
        id: check.id,
        kind: check.kind,
        target: check.target,
        expected: check.expected ?? null,
        resolved: resolvePath({ state: final, derived, events: [] }, check.target).value,
      })),
      verdict: { replayed, outcome, recordedOutcome: caseRun.outcome, recordedReason: caseRun.outcomeReason },
      reinducedWithCodeUnderTest: {
        note: 'observations reconstructed from the frozen trace rows and teach.json results; the reading tags are ignored by code that does not read them',
        entities: reinduced.schema.entities.map((entity) => identityOf(entity)),
        groupIdQuestion: reinduced.questions.find((q) => q.id === 'q_id_Group') ?? null,
      },
    };
    mkdirSync(join(N1, 'evidence'), { recursive: true });
    writeFileSync(join(N1, 'evidence', `repro-${LABEL}.json`), JSON.stringify(record, null, 2) + '\n');
  });
});
