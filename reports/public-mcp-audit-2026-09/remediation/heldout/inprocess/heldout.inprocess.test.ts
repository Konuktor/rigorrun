/**
 * HELD-OUT, in-process. A generalisation check built after the fixes, with an
 * environment, jobs and agents that no regression test uses.
 *
 * Not part of CI. run-heldout-inprocess.sh copies this file into
 * packages/runner/test, runs it, removes it, and this file writes
 * remediation/heldout/results-inprocess.json. Every case's expected outcome is
 * fixed in CASES below and in heldout/README.md, committed before the first
 * run, and never edited to match a result. Mismatches are recorded with
 * expect.soft so every case runs and every result is reported.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FULL_CAPABILITIES,
  StateReadError,
  clearEnvironments,
  defineEnvironment,
  registerEnvironment,
  stateFromRows,
  type ActionResult,
  type CanonicalState,
  type CaseConfig,
  type EnvironmentAdapter,
  type EnvironmentCapabilities,
  type EnvironmentRegistration,
  type EnvironmentSchema,
} from '@rigorrun/environment';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { applyReview, fromActionLog, rulesAwaitingReview, type Benchmark, type CaseResult } from '@rigorrun/core';
import { SystemEnvironment, type CallResult, type DiscoveredTool, type SystemConnection } from '@rigorrun/connector';
import type { AgentAdapter, AgentEnvironment } from '@rigorrun/agents';
import { runBenchmark } from '../src/index.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const RESULTS = join(REPO, 'reports', 'public-mcp-audit-2026-09', 'remediation', 'heldout', 'results-inprocess.json');

type Outcome = 'PASS' | 'FAIL' | 'ABSTAIN' | 'TIMED_OUT' | 'AGENT_FAILURE';
type Truth = 'KNOWN_GOOD' | 'KNOWN_BAD' | 'UNDECIDABLE' | 'NOT_FINISHED';
interface HeldoutCase {
  id: string;
  theme: string;
  truth: Truth;
  expected: Outcome;
  description: string;
}

// Fixed before the first run. Do not edit to match results.
export const CASES: HeldoutCase[] = [
  { id: 'HI-01', theme: 'fresh-state semantics', truth: 'KNOWN_GOOD', expected: 'PASS', description: 'create one entry in a 40-row world that already holds an identical entry' },
  { id: 'HI-02', theme: 'fresh-state semantics', truth: 'KNOWN_BAD', expected: 'FAIL', description: 'same world; the agent does nothing and claims success' },
  { id: 'HI-03', theme: 'duplicate side effects', truth: 'KNOWN_BAD', expected: 'FAIL', description: 'the right entry plus a near-duplicate differing only in letter case' },
  { id: 'HI-04', theme: 'wrong entity', truth: 'KNOWN_BAD', expected: 'FAIL', description: 'the same values written to a sibling table with identical fields' },
  { id: 'HI-05', theme: 'wrong entity', truth: 'KNOWN_BAD', expected: 'FAIL', description: 'the right table, a one-letter-different owner' },
  { id: 'HI-06', theme: 'correct idempotent execution', truth: 'KNOWN_GOOD', expected: 'PASS', description: 'close the named entry, read, close it again' },
  { id: 'HI-07', theme: 'wrong entity', truth: 'KNOWN_BAD', expected: 'FAIL', description: 'close the identical twin of the named entry' },
  { id: 'HI-08', theme: 'duplicate side effects', truth: 'KNOWN_BAD', expected: 'FAIL', description: 'close the named entry and its twin' },
  { id: 'HI-09', theme: 'ambiguous retries', truth: 'KNOWN_GOOD', expected: 'PASS', description: 'close: committed, response lost, agent retries an idempotent close' },
  { id: 'HI-10', theme: 'ambiguous retries', truth: 'KNOWN_BAD', expected: 'FAIL', description: 'create: committed, response lost, agent retries blindly' },
  { id: 'HI-11', theme: 'ambiguous retries', truth: 'KNOWN_GOOD', expected: 'PASS', description: 'create: committed, response lost, agent reads first and does not retry' },
  { id: 'HI-12', theme: 'timeouts', truth: 'NOT_FINISHED', expected: 'TIMED_OUT', description: 'the write never answers inside an 80 ms case budget' },
  { id: 'HI-13', theme: 'timeouts', truth: 'NOT_FINISHED', expected: 'AGENT_FAILURE', description: 'the agent does the job correctly and then crashes' },
  { id: 'HI-14', theme: 'unverifiable connectors', truth: 'UNDECIDABLE', expected: 'ABSTAIN', description: 'correct agent; the final read fails' },
  { id: 'HI-15', theme: 'unverifiable connectors', truth: 'UNDECIDABLE', expected: 'ABSTAIN', description: 'do-nothing agent; the final read fails' },
  { id: 'HI-16', theme: 'unverifiable connectors', truth: 'UNDECIDABLE', expected: 'ABSTAIN', description: 'correct agent; nothing can be read back at all' },
  { id: 'HI-17', theme: 'unverifiable connectors', truth: 'UNDECIDABLE', expected: 'ABSTAIN', description: 'do-nothing agent; nothing can be read back at all' },
  { id: 'HI-18', theme: 'JSON normalisation', truth: 'KNOWN_GOOD', expected: 'PASS', description: 'records split across two JSON text blocks; correct agent' },
  { id: 'HI-19', theme: 'JSON normalisation', truth: 'KNOWN_BAD', expected: 'FAIL', description: 'records split across two JSON text blocks; do-nothing agent' },
  { id: 'HI-20', theme: 'JSON normalisation', truth: 'KNOWN_GOOD', expected: 'PASS', description: 'a byte-order mark and whitespace around a JSON object; correct agent' },
  { id: 'HI-21', theme: 'JSON normalisation', truth: 'KNOWN_BAD', expected: 'FAIL', description: 'same shape; duplicate agent' },
  { id: 'HI-22', theme: 'unverifiable connectors', truth: 'UNDECIDABLE', expected: 'ABSTAIN', description: 'the read answers in prose at run time; correct agent' },
  { id: 'HI-23', theme: 'unverifiable connectors', truth: 'UNDECIDABLE', expected: 'ABSTAIN', description: 'the read answers in prose at run time; do-nothing agent' },
];

const results: { id: string; theme: string; truth: Truth; expected: Outcome; actual: string; reason: string; match: boolean }[] = [];

function record(id: string, result: CaseResult): void {
  const spec = CASES.find((entry) => entry.id === id)!;
  const actual = result.outcome ?? 'UNKNOWN';
  results.push({ id, theme: spec.theme, truth: spec.truth, expected: spec.expected, actual, reason: result.outcomeReason, match: actual === spec.expected });
  expect.soft(actual, `${id} ${spec.description}: ${result.outcomeReason}`).toBe(spec.expected);
}

afterAll(() => {
  const count = (predicate: (r: (typeof results)[number]) => boolean) => results.filter(predicate).length;
  mkdirSync(dirname(RESULTS), { recursive: true });
  writeFileSync(
    RESULTS,
    JSON.stringify(
      {
        generatedBy: 'remediation/heldout/inprocess/heldout.inprocess.test.ts',
        rigorrunCommit: process.env['HELDOUT_COMMIT'] ?? null,
        totals: {
          cases: results.length,
          matchingExpected: count((r) => r.match),
          knownGoodIncorrectlyFailed: count((r) => r.truth === 'KNOWN_GOOD' && r.actual === 'FAIL'),
          knownBadIncorrectlyPassed: count((r) => r.truth === 'KNOWN_BAD' && r.actual === 'PASS'),
          undecidableGivenAVerdict: count((r) => r.truth === 'UNDECIDABLE' && (r.actual === 'PASS' || r.actual === 'FAIL')),
          notFinishedGivenAVerdict: count((r) => r.truth === 'NOT_FINISHED' && (r.actual === 'PASS' || r.actual === 'FAIL')),
          abstentions: count((r) => r.actual === 'ABSTAIN'),
        },
        cases: results,
      },
      null,
      2,
    ) + '\n',
  );
});

// ------------------------------------------------------------------ a ledger

const ENTRY_FIELDS = (idField: string) => [
  { name: idField, type: 'string' as const, nullable: false, role: 'identifier' as const },
  { name: 'title', type: 'string' as const, nullable: false, role: 'freetext' as const },
  { name: 'owner', type: 'string' as const, nullable: false, role: 'actor' as const },
  { name: 'status', type: 'enum' as const, nullable: false, role: 'status' as const, enumValues: ['closed', 'open'] },
];

const LEDGER: EnvironmentSchema = {
  entities: [
    { name: 'Entry', idField: 'entryId', mutable: true, appendOnly: false, fields: ENTRY_FIELDS('entryId') },
    { name: 'Mirror', idField: 'mirrorId', mutable: true, appendOnly: false, fields: ENTRY_FIELDS('mirrorId') },
  ],
  relationships: [],
};

const TITLES = ['Rota', 'Invoice run', 'Vendor call', 'Offsite', 'Budget review'];
const OWNERS = ['lee', 'ari', 'sam', 'kim', 'jo'];
const NOISY_ROWS = Array.from({ length: 40 }, (_, index) => ({
  entryId: `ENT-${String(index + 1).padStart(4, '0')}`,
  title: TITLES[index % TITLES.length]!,
  owner: OWNERS[(index * 3) % OWNERS.length]!,
  status: index % 3 === 0 ? 'closed' : 'open',
}));
// An identical entry already exists, and two open twins differ only by id.
NOISY_ROWS[2] = { entryId: 'ENT-0003', title: 'Budget review', owner: 'kim', status: 'open' };
NOISY_ROWS[6] = { entryId: 'ENT-0007', title: 'Rota', owner: 'lee', status: 'open' };
NOISY_ROWS[7] = { entryId: 'ENT-0008', title: 'Rota', owner: 'lee', status: 'open' };
const NOISY = stateFromRows(LEDGER, {
  Entry: NOISY_ROWS,
  Mirror: [{ mirrorId: 'MIR-0001', title: 'Rota', owner: 'jo', status: 'open' }],
});

const LEDGER_ENV = defineEnvironment({
  id: 'heldout-ledger-base',
  name: 'Held-out ledger',
  description: 'A ledger with a sibling table.',
  schema: LEDGER,
  presentation: { label: 'Ledger', tagline: 'held-out', accent: '#334155', mark: 'L', navEntities: ['Entry'], focusEntity: 'Entry' },
  fixtures: [{ id: 'noisy', title: 'Noisy', summary: '40 entries', state: NOISY, config: {}, request: {} }],
  actions: [
    { name: 'list_entries', description: 'Every entry.', readOnly: true, mutates: [], enforcement: 'none', params: [], handle: (_args, ctx) => ({ ok: true, data: Object.values(ctx.state.entities['Entry'] ?? {}) }) },
    {
      name: 'add_entry', description: 'Adds an entry.', readOnly: false, mutates: [], enforcement: 'none',
      params: [{ name: 'title', type: 'string', required: true }, { name: 'owner', type: 'string', required: true }],
      handle: (args, ctx) => ({ ok: true, data: ctx.insert('Entry', { entryId: ctx.nextId('ENT'), title: String(args['title']), owner: String(args['owner']), status: 'open' }) }),
    },
    {
      name: 'add_mirror', description: 'Adds a mirror row.', readOnly: false, mutates: [], enforcement: 'none',
      params: [{ name: 'title', type: 'string', required: true }, { name: 'owner', type: 'string', required: true }],
      handle: (args, ctx) => ({ ok: true, data: ctx.insert('Mirror', { mirrorId: ctx.nextId('MIR'), title: String(args['title']), owner: String(args['owner']), status: 'open' }) }),
    },
    {
      name: 'close_entry', description: 'Closes an entry.', readOnly: false, mutates: [], enforcement: 'none',
      params: [{ name: 'entryId', type: 'string', required: true, entityRef: 'Entry' }],
      handle: (args, ctx) => {
        const row = ctx.update('Entry', args['entryId'], { status: 'closed' });
        return row ? { ok: true, data: row } : { ok: false, error: { code: 'NOT_FOUND', message: 'no such entry' } };
      },
    },
  ],
});

interface Faults {
  loseResponseOnce?: string;
  hangTool?: string;
  toolTimeoutMs?: number;
  failReadsAfter?: number;
  caps?: Partial<EnvironmentCapabilities>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cannot be seeded; its reset leaves the noisy world; faults are injected here. */
class LiveLedger implements EnvironmentAdapter {
  readonly id = 'heldout-ledger';
  readonly name = 'Held-out ledger';
  readonly description = 'held-out';
  private reads = 0;
  private lost = false;
  constructor(private readonly inner: EnvironmentAdapter, private readonly faults: Faults) {}
  capabilities(): EnvironmentCapabilities {
    return { ...FULL_CAPABILITIES, seed: 'none', reset: 'tool', stateRead: 'designated-reads', discovery: 'tools-only', ...this.faults.caps };
  }
  describeEntities() { return this.inner.describeEntities(); }
  getActions() { return this.inner.getActions(); }
  describeCaseConfig() { return this.inner.describeCaseConfig(); }
  describePresentation() { return this.inner.describePresentation(); }
  async reset() { await this.inner.reset(); await this.inner.seed(NOISY, {}); }
  seed(_state: CanonicalState, _config?: CaseConfig) {}
  async getState() {
    this.reads += 1;
    if (this.faults.failReadsAfter !== undefined && this.reads > this.faults.failReadsAfter) {
      throw new StateReadError('list_entries', 'the read answered 503');
    }
    return this.inner.getState();
  }
  getEvents() { return this.inner.getEvents(); }
  async executeAction(name: string, args: Record<string, unknown>): Promise<ActionResult> {
    if (name === this.faults.hangTool) return new Promise<ActionResult>(() => undefined);
    if (name === this.faults.loseResponseOnce && !this.lost) {
      this.lost = true;
      await this.inner.executeAction(name, args);
      await sleep(this.faults.toolTimeoutMs ?? 30);
      return { ok: false, error: { code: 'TIMEOUT', message: 'no response' } };
    }
    return this.inner.executeAction(name, args);
  }
  snapshot() { return this.inner.snapshot(); }
  restore(snapshot: Parameters<EnvironmentAdapter['restore']>[0]) { return this.inner.restore(snapshot); }
}

const ledger = (faults: Faults = {}): EnvironmentRegistration => ({
  id: 'heldout-ledger', name: 'Held-out ledger', description: 'held-out', fixtures: LEDGER_ENV.fixtures,
  create: () => new LiveLedger(LEDGER_ENV.create(), faults),
});

const JOBS = {
  create: { action: 'add_entry', args: { title: 'Budget review', owner: 'kim' }, goal: 'Record a budget review owned by kim' },
  close: { action: 'close_entry', args: { entryId: 'ENT-0007' }, goal: 'Close entry ENT-0007' },
} as const;

async function suiteFrom(registration: EnvironmentRegistration, job: keyof typeof JOBS): Promise<Benchmark> {
  clearEnvironments();
  registerEnvironment(registration);
  const { action, args, goal } = JOBS[job];
  const recorder = registration.create();
  await recorder.reset();
  const before = await recorder.getState();
  await recorder.executeAction(action, { ...args });
  const after = await recorder.getState();
  const trace = fromActionLog([{ at: 0, action, args: { ...args }, changed: true }], { environmentId: registration.id, id: `trace_${job}`, name: job, before, after });
  const draft = induceContract(registration.create(), trace, { contractId: `ec_heldout_${registration.id}_${job}`, createdAt: '2026-09-14T00:00:00.000Z', goal }).contract;
  const contract = applyReview(draft, { confirmedRuleIds: [], rejectedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id) });
  const fixture = { id: 'live', title: 'live', summary: 'snapshot', state: after, config: {}, request: { ...args } };
  const { benchmark } = await generateBenchmark(registration.create(), contract, [fixture]);
  return { ...benchmark, cases: benchmark.cases.filter((entry) => entry.category === 'happy_path') };
}

async function runIn(registration: EnvironmentRegistration, benchmark: Benchmark, agent: AgentAdapter, caseTimeoutMs?: number): Promise<CaseResult> {
  clearEnvironments();
  registerEnvironment(registration);
  const run = await runBenchmark(benchmark, [agent], caseTimeoutMs ? { caseTimeoutMs } : {});
  return run.caseResults[0]!;
}

const agent = (id: string, act: (env: AgentEnvironment) => Promise<void>, report = 'Done as asked.'): AgentAdapter => ({
  id, name: id, kind: 'demo', description: id,
  async execute(_input, env) {
    await act(env);
    return { report, costUsd: 0, costNote: 'no model calls' };
  },
});

const add = (env: AgentEnvironment, title = 'Budget review', owner = 'kim') => env.call('add_entry', { title, owner });
const close = (env: AgentEnvironment, entryId: string) => env.call('close_entry', { entryId });
const nothing = agent('nothing', async () => undefined, 'Recorded it.');

describe('held-out: a noisy ledger that cannot be seeded', () => {
  it('HI-01..05 creating an entry', async () => {
    const benchmark = await suiteFrom(ledger(), 'create');
    record('HI-01', await runIn(ledger(), benchmark, agent('correct', async (env) => { await add(env); })));
    record('HI-02', await runIn(ledger(), benchmark, nothing));
    record('HI-03', await runIn(ledger(), benchmark, agent('near-duplicate', async (env) => { await add(env); await add(env, 'budget review'); })));
    record('HI-04', await runIn(ledger(), benchmark, agent('mirror', async (env) => { await env.call('add_mirror', { title: 'Budget review', owner: 'kim' }); })));
    record('HI-05', await runIn(ledger(), benchmark, agent('wrong-owner', async (env) => { await add(env, 'Budget review', 'kym'); })));
  });

  it('HI-06..08 closing the named entry', async () => {
    const benchmark = await suiteFrom(ledger(), 'close');
    record('HI-06', await runIn(ledger(), benchmark, agent('idempotent', async (env) => { await close(env, 'ENT-0007'); await env.call('list_entries'); await close(env, 'ENT-0007'); })));
    record('HI-07', await runIn(ledger(), benchmark, agent('twin', async (env) => { await close(env, 'ENT-0008'); })));
    record('HI-08', await runIn(ledger(), benchmark, agent('both', async (env) => { await close(env, 'ENT-0007'); await close(env, 'ENT-0008'); })));
  });

  it('HI-09..11 ambiguous retries', async () => {
    const closing = await suiteFrom(ledger(), 'close');
    record('HI-09', await runIn(ledger({ loseResponseOnce: 'close_entry' }), closing, agent('retry-close', async (env) => {
      if (!(await close(env, 'ENT-0007')).ok) await close(env, 'ENT-0007');
    })));
    const creating = await suiteFrom(ledger(), 'create');
    record('HI-10', await runIn(ledger({ loseResponseOnce: 'add_entry' }), creating, agent('retry-blind', async (env) => {
      if (!(await add(env)).ok) await add(env);
    })));
    record('HI-11', await runIn(ledger({ loseResponseOnce: 'add_entry' }), creating, agent('retry-checked', async (env) => {
      if ((await add(env)).ok) return;
      const listed = await env.call('list_entries');
      const rows = listed.ok ? (listed.data as { title: string; owner: string; entryId: string }[]) : [];
      // Anything this agent created has an id the world did not start with.
      const mine = rows.some((row) => row.title === 'Budget review' && row.owner === 'kim' && !['ENT-0003'].includes(row.entryId));
      if (!mine) await add(env);
    })));
  });

  it('HI-12..13 cases that do not finish', async () => {
    const creating = await suiteFrom(ledger(), 'create');
    record('HI-12', await runIn(ledger({ hangTool: 'add_entry' }), creating, agent('hangs', async (env) => { await add(env); }), 80));
    record('HI-13', await runIn(ledger(), creating, agent('crashes-after', async (env) => { await add(env); throw new Error('lost the connection after writing'); })));
  });

  it('HI-14..17 evidence that cannot decide', async () => {
    const creating = await suiteFrom(ledger(), 'create');
    record('HI-14', await runIn(ledger({ failReadsAfter: 1 }), creating, agent('correct', async (env) => { await add(env); })));
    record('HI-15', await runIn(ledger({ failReadsAfter: 1 }), creating, nothing));
    record('HI-16', await runIn(ledger({ caps: { stateRead: 'none' } }), creating, agent('correct', async (env) => { await add(env); })));
    record('HI-17', await runIn(ledger({ caps: { stateRead: 'none' } }), creating, nothing));
  });
});

// ------------------------------------------------ a system reached as a connector

function system(shape: 'json-blocks' | 'bom') {
  const initial = [
    { entryId: 'ENT-0001', title: 'Rota', owner: 'lee', status: 'open' },
    { entryId: 'ENT-0002', title: 'Offsite', owner: 'jo', status: 'closed' },
    { entryId: 'ENT-0003', title: 'Budget review', owner: 'kim', status: 'open' },
  ];
  let rows = structuredClone(initial);
  let next = 9001;
  let prose = false;
  const text = (body: string): CallResult => ({ ok: true, durationMs: 0, content: [{ type: 'text', text: body }] });
  const tool = (name: string) =>
    ({
      name,
      description: name,
      params: name === 'add_entry' ? [{ name: 'title', type: 'string', required: true }, { name: 'owner', type: 'string', required: true }] : [],
      unsupported: [],
      schemaTruncated: false,
      hints: {},
      risk: {},
    }) as unknown as DiscoveredTool;
  const connection: SystemConnection = {
    discovery: { serverName: 'held-out system', serverVersion: '1', protocolVersion: '', latencyMs: 0, tools: ['reset', 'list_entries', 'add_entry'].map(tool) },
    childPid: null,
    async call(name, args) {
      if (name === 'reset') {
        rows = structuredClone(initial);
        next = 9001;
        return text('{"reset": true}');
      }
      if (name === 'add_entry') {
        const row = { entryId: `ENT-${next++}`, title: String(args['title']), owner: String(args['owner']), status: 'open' };
        rows.push(row);
        return text(JSON.stringify(row));
      }
      if (name === 'list_entries') {
        if (prose) return text(`There are ${rows.length} entries in the ledger.`);
        if (shape === 'json-blocks') {
          const half = Math.ceil(rows.length / 2);
          return { ok: true, durationMs: 0, content: [{ type: 'text', text: JSON.stringify(rows.slice(0, half)) }, { type: 'text', text: JSON.stringify(rows.slice(half)) }] };
        }
        return text(`﻿\n   ${JSON.stringify({ entries: rows })}\n`);
      }
      return { ok: false, durationMs: 0, error: { code: 'NO_SUCH_TOOL', message: name } };
    },
    close: async () => undefined,
  };
  const schema: EnvironmentSchema = { entities: [LEDGER.entities[0]!], relationships: [] };
  const registration: EnvironmentRegistration = {
    id: `heldout-system-${shape}`, name: 'Held-out system', description: 'held-out', fixtures: [],
    create: () => new SystemEnvironment(connection, schema, {
      id: `heldout-system-${shape}`, name: 'Held-out system', description: 'held-out',
      verifierReads: [{ tool: 'list_entries' }], reset: { kind: 'tool', tool: 'reset' }, safety: 'local', readOnlyTools: ['list_entries'],
    }),
  };
  return { registration, answerInProse: () => { prose = true; } };
}

describe('held-out: a live system reached through a connector', () => {
  it('HI-18..19 records split across two JSON text blocks', async () => {
    const { registration } = system('json-blocks');
    const benchmark = await suiteFrom(registration, 'create');
    record('HI-18', await runIn(registration, benchmark, agent('correct', async (env) => { await add(env); })));
    record('HI-19', await runIn(registration, benchmark, nothing));
  });

  it('HI-20..21 a byte-order mark and whitespace around JSON', async () => {
    const { registration } = system('bom');
    const benchmark = await suiteFrom(registration, 'create');
    record('HI-20', await runIn(registration, benchmark, agent('correct', async (env) => { await add(env); })));
    record('HI-21', await runIn(registration, benchmark, agent('duplicate', async (env) => { await add(env); await add(env); })));
  });

  it('HI-22..23 a read that answers in prose at run time', async () => {
    const { registration, answerInProse } = system('bom');
    const benchmark = await suiteFrom(registration, 'create');
    answerInProse();
    record('HI-22', await runIn(registration, benchmark, agent('correct', async (env) => { await add(env); })));
    record('HI-23', await runIn(registration, benchmark, nothing));
  });
});
