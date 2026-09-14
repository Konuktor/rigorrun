/**
 * Audit N-1: a record is never named by a value the job changes, and a record
 * the job changes must change the way the demonstration changed it.
 *
 * Found on a time report (Worktide, EH-WT-03), reproduced here in neutral form.
 * A read answers with aggregate rows — dimensions plus quantities — over
 * entries no read ever shows. The schema is induced from the demonstration's
 * answers the way the product does it, with both readings of the nominated read
 * labelled; the contract is compiled, the suite generated, and scripted agents
 * whose truth is known in advance are run against a system that cannot be
 * seeded. Names are meaningless on purpose.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FULL_CAPABILITIES,
  clearEnvironments,
  registerEnvironment,
  type ActionDefinition,
  type ActionResult,
  type CanonicalState,
  type EntitySchema,
  type EnvEvent,
  type EnvironmentAdapter,
  type EnvironmentCapabilities,
  type EnvironmentRegistration,
  type EnvironmentSchema,
  type StateSnapshot,
} from '@rigorrun/environment';
import { stateFromPayloads } from '@rigorrun/connector';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { applyReview, fromActionLog, rulesAwaitingReview, type Benchmark, type CaseResult, type EnvironmentContract } from '@rigorrun/core';
import type { AgentAdapter } from '@rigorrun/agents';
import { induceSchema, type PayloadObservation } from '../../mcp/src/index.ts';
import { runBenchmark } from '../src/index.ts';
import { happyOnly, scripted, type ScriptedStep } from './liveWorld.ts';

afterEach(() => clearEnvironments());

type Row = Record<string, unknown>;

interface DeskAction {
  name: string;
  params: { name: string; type: 'string' | 'number' }[];
  apply: (rows: Row[], args: Record<string, unknown>) => void;
}

/** One system: the entries it hides, the one read that summarises them, and what can be done to it. */
interface Variant {
  id: string;
  hidden: Row[];
  read: (rows: readonly Row[]) => unknown;
  actions: DeskAction[];
  demonstrate: { action: string; args: Record<string, unknown> };
}

const READ = 'read_summary';
const clone = (rows: readonly Row[]): Row[] => rows.map((row) => ({ ...row }));
const sum = (values: unknown[]): number => values.reduce<number>((total, value) => total + Number(value), 0);

class Desk implements EnvironmentAdapter {
  readonly name = 'Tally desk';
  readonly description = 'Aggregate rows over entries no read shows.';
  private rows: Row[] = [];
  private events: EnvEvent[] = [];

  constructor(
    readonly id: string,
    private readonly variant: Variant,
    private readonly schema: EnvironmentSchema,
    private readonly resetTo: readonly Row[],
  ) {}

  capabilities(): EnvironmentCapabilities {
    return { ...FULL_CAPABILITIES, seed: 'none', reset: 'tool', stateRead: 'designated-reads', discovery: 'tools-only' };
  }
  describeEntities(): EnvironmentSchema {
    return this.schema;
  }
  getActions(): ActionDefinition[] {
    const read: ActionDefinition = { name: READ, description: 'Reads the summary.', params: [], mutates: [], readOnly: true, enforcement: 'none' };
    return [
      read,
      ...this.variant.actions.map((action) => ({
        name: action.name,
        description: `Performs ${action.name}.`,
        params: action.params.map((param) => ({ name: param.name, type: param.type, required: false })),
        mutates: [] as string[],
        readOnly: false,
        enforcement: 'none' as const,
      })),
    ];
  }
  describeCaseConfig() {
    return [];
  }
  describePresentation() {
    return { label: this.name, tagline: this.description, accent: '#334155', mark: 'T', navEntities: [], focusEntity: this.schema.entities[0]?.name ?? 'Record' };
  }
  reset(): void {
    this.rows = clone(this.resetTo);
    this.events = [];
  }
  seed(): void {
    // A real system offers no way to install a world.
  }
  getState(): CanonicalState {
    return stateFromPayloads([this.variant.read(this.rows)], this.schema);
  }
  getEvents(): EnvEvent[] {
    return [...this.events];
  }
  executeAction(name: string, args: Record<string, unknown>): ActionResult {
    if (name === READ) return { ok: true, data: this.variant.read(this.rows) };
    const action = this.variant.actions.find((candidate) => candidate.name === name);
    if (!action) return { ok: false, error: { code: 'UNKNOWN', message: `no action ${name}` } };
    action.apply(this.rows, args);
    this.events.push({ type: name, ordinal: this.events.length, at: this.events.length + 1, payload: args, ok: true });
    return { ok: true, data: { done: true } };
  }
  snapshot(): StateSnapshot {
    return { state: this.getState(), events: this.getEvents(), config: {}, clock: this.events.length };
  }
  restore(): void {
    this.reset();
  }
}

interface Compiled {
  variant: Variant;
  schema: EnvironmentSchema;
  contract: EnvironmentContract;
  benchmark: Benchmark;
}

function registration(variant: Variant, schema: EnvironmentSchema, world: readonly Row[]): EnvironmentRegistration {
  return { id: variant.id, name: 'Tally desk', description: 'Aggregate rows.', fixtures: [], create: () => new Desk(variant.id, variant, schema, world) };
}

/** Demonstrates the job once, induces the schema from both readings, compiles and generates, as the product does. */
async function compile(variant: Variant): Promise<Compiled> {
  const demonstrated = variant.actions.find((action) => action.name === variant.demonstrate.action)!;
  const before = variant.read(clone(variant.hidden));
  const afterRows = clone(variant.hidden);
  demonstrated.apply(afterRows, variant.demonstrate.args);
  const after = variant.read(afterRows);

  const observations: PayloadObservation[] = [
    { tool: 'before', payload: before, reading: { read: `0:${READ}`, moment: 'before' } },
    { tool: 'after', payload: after, reading: { read: `0:${READ}`, moment: 'after' } },
  ] as PayloadObservation[];
  const { schema } = induceSchema(observations);

  clearEnvironments();
  const live = registration(variant, schema, variant.hidden);
  registerEnvironment(live);
  const beforeState = stateFromPayloads([before], schema);
  const afterState = stateFromPayloads([after], schema);
  const trace = fromActionLog([{ at: 0, action: variant.demonstrate.action, args: variant.demonstrate.args, changed: true }], {
    environmentId: variant.id,
    id: `trace_${variant.id}`,
    name: variant.id,
    before: beforeState,
    after: afterState,
  });
  const draft = induceContract(live.create(), trace, {
    contractId: `ec_${variant.id}`,
    createdAt: '2026-09-14T00:00:00.000Z',
    goal: `Do the ${variant.id} job once`,
  }).contract;
  const contract = applyReview(draft, { confirmedRuleIds: [], rejectedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id) });
  const fixture = { id: 'live', title: 'live', summary: 'snapshot', state: afterState, config: {}, request: variant.demonstrate.args };
  const { benchmark } = await generateBenchmark(live.create(), contract, [fixture]);
  return { variant, schema, contract, benchmark: happyOnly(benchmark) };
}

async function run(compiled: Compiled, world: readonly Row[], agent: AgentAdapter): Promise<CaseResult> {
  clearEnvironments();
  registerEnvironment(registration(compiled.variant, compiled.schema, world));
  const result = await runBenchmark(compiled.benchmark, [agent]);
  return result.caseResults[0]!;
}

async function expectOutcomes(compiled: Compiled, world: readonly Row[], table: [string, ScriptedStep[], CaseResult['outcome']][]) {
  for (const [name, steps, expected] of table) {
    const result = await run(compiled, world, scripted(name, steps));
    expect(result.outcome, `${name}: ${result.outcomeReason}`).toBe(expected);
  }
}

const entityWith = (schema: EnvironmentSchema, field: string): EntitySchema & { keyFields?: string[]; identity?: string } =>
  schema.entities.find((entity) => entity.fields.some((candidate) => candidate.name === field))!;

// ----------------------------------------------------------------- a lane report

/** Lanes that have at least one entry, each with the units booked to it. The unnamed lane has no reference. */
const LANES = [
  { ref: null, label: '(none)' },
  { ref: 'L1', label: 'Lane one' },
  { ref: 'L2', label: 'Lane two' },
];
const lines = (rows: readonly Row[]) =>
  LANES.filter((lane) => rows.some((row) => row['lane'] === lane.ref)).map((lane) => ({
    ref: lane.ref,
    label: lane.label,
    units: sum(rows.filter((row) => row['lane'] === lane.ref).map((row) => row['units'])),
  }));

const booking = (units: number): DeskAction[] => [
  { name: 'book', params: [{ name: 'note', type: 'string' }], apply: (rows) => void rows.push({ lane: null, units }) },
  {
    name: 'book_to',
    params: [{ name: 'lane', type: 'string' }, { name: 'note', type: 'string' }],
    apply: (rows, args) => void rows.push({ lane: args['lane'], units }),
  },
];

const LANE_REPORT: Variant = {
  id: 'lane-report',
  // The unnamed lane already has an empty entry, so the job changes a row that exists.
  hidden: [{ lane: null, units: 0 }, { lane: 'L1', units: 225 }, { lane: 'L2', units: 315 }],
  read: (rows) => ({ lines: lines(rows) }),
  actions: booking(10),
  demonstrate: { action: 'book', args: { note: 'Lane work' } },
};

const book: ScriptedStep = { tool: 'book', args: { note: 'Lane work' } };
const bookTo = (lane: string): ScriptedStep => ({ tool: 'book_to', args: { lane, note: 'Lane work' } });
const read: ScriptedStep = { tool: READ };

describe('an aggregate row whose quantity the job changes', () => {
  it('names the row by what stayed the same, and expects the demonstrated change', async () => {
    const { schema, contract } = await compile(LANE_REPORT);
    const line = entityWith(schema, 'units');
    expect(line.idField).not.toBe('units');
    expect(line.keyFields ?? [line.idField]).not.toContain('units');
    expect(contract.focusScope).toBe('changed');
    expect(contract.expectedDeltaCount).toBe(1);
    expect(contract.expectedChanges).toContainEqual(
      expect.objectContaining({ field: 'units', from: 0, to: 10, compare: 'quantity' }),
    );
  });

  it('passes the correct agent and fails the duplicate, the wrong row and the extra row (A–D)', async () => {
    const compiled = await compile(LANE_REPORT);
    await expectOutcomes(compiled, LANE_REPORT.hidden, [
      ['A: correct', [book], 'PASS'],
      ['correct, with reads around it', [read, book, read, read], 'PASS'],
      ['B: duplicated side effect', [book, book], 'FAIL'],
      ['C: the right amount on the wrong row', [bookTo('L1')], 'FAIL'],
      ['D: the right row plus another row', [book, bookTo('L2')], 'FAIL'],
      ['nothing, claimed done', [], 'FAIL'],
    ]);
  });

  it('says what the duplicate did: the demonstrated change, and the one observed', async () => {
    const compiled = await compile(LANE_REPORT);
    const result = await run(compiled, LANE_REPORT.hidden, scripted('duplicate', [book, book]));
    expect(result.outcome).toBe('FAIL');
    expect(result.outcomeReason).toContain('+10');
    expect(result.outcomeReason).toContain('+20');
  });

  it('G: abstains when the case starts from a different value, unless the result contradicts every reading', async () => {
    const compiled = await compile(LANE_REPORT);
    // The unnamed lane already holds 5 when the case starts, not the demonstrated 0.
    const drifted = [...LANE_REPORT.hidden, { lane: null, units: 5 }];
    await expectOutcomes(compiled, drifted, [
      // 15 is "add 10"; "set to 10" would be 10. One demonstration cannot say which the job does.
      ['correct, from a drifted start', [book], 'ABSTAIN'],
      // 25 is neither.
      ['duplicate, from a drifted start', [book, book], 'FAIL'],
      ['nothing, from a drifted start', [], 'FAIL'],
    ]);
  });
});

describe('a report that adds up, where the job creates a new row (totals)', () => {
  const TOTALS: Variant = {
    id: 'lane-totals',
    hidden: [{ lane: 'L1', units: 7 }, { lane: 'L2', units: 5 }],
    read: (rows) => ({ span: 'all', total: sum(rows.map((row) => row['units'])), lines: lines(rows) }),
    actions: booking(4),
    demonstrate: { action: 'book', args: { note: 'Lane work' } },
  };

  it('reads the rows that add up to the total as quantities, never as their names', async () => {
    const { schema, contract } = await compile(TOTALS);
    const line = entityWith(schema, 'label');
    expect(line.idField).toBe('label');
    expect(line.fields.find((field) => field.name === 'units')).toEqual(expect.objectContaining({ totals: expect.stringMatching(/\.total$/) }));
    expect(contract.focusScope).toBe('created');
  });

  it('fails a duplicate contribution to the new row', async () => {
    const compiled = await compile(TOTALS);
    await expectOutcomes(compiled, TOTALS.hidden, [
      ['correct', [book], 'PASS'],
      ['duplicate', [book, book], 'FAIL'],
      ['an existing row instead', [bookTo('L1')], 'FAIL'],
      ['nothing', [], 'FAIL'],
    ]);
  });
});

describe('rows named by several dimensions together (compound identity)', () => {
  const CELLS: Variant = {
    id: 'cells',
    hidden: [
      { owner: 'ann', area: 'north', units: 3 },
      { owner: 'ann', area: 'south', units: 0 },
      { owner: 'bo', area: 'north', units: 8 },
    ],
    read: (rows) => ({ cells: rows.map((row) => ({ ...row })) }),
    actions: [
      {
        name: 'add',
        params: [{ name: 'owner', type: 'string' }, { name: 'area', type: 'string' }, { name: 'note', type: 'string' }],
        apply: (rows, args) => {
          const cell = rows.find((row) => row['owner'] === args['owner'] && row['area'] === args['area'])!;
          cell['units'] = Number(cell['units']) + 5;
        },
      },
    ],
    demonstrate: { action: 'add', args: { owner: 'ann', area: 'south', note: 'Cell work' } },
  };
  const add = (owner: string, area: string): ScriptedStep => ({ tool: 'add', args: { owner, area, note: 'Cell work' } });

  it('keys a cell by its dimensions, not by the quantity that happened to be unique', async () => {
    const { schema } = await compile(CELLS);
    const cell = entityWith(schema, 'units');
    expect([...(cell.keyFields ?? [])].sort()).toEqual(['area', 'owner']);
  });

  it('fails the duplicate and the wrong cell', async () => {
    const compiled = await compile(CELLS);
    await expectOutcomes(compiled, CELLS.hidden, [
      ['correct', [add('ann', 'south')], 'PASS'],
      ['duplicate', [add('ann', 'south'), add('ann', 'south')], 'FAIL'],
      // 3 + 5 = 8, the same as another cell: under a quantity key the two would collide.
      ['wrong cell', [add('ann', 'north')], 'FAIL'],
    ]);
  });
});

describe('a dimension that is null for one row', () => {
  const SLOTS: Variant = {
    id: 'slots',
    hidden: [{ ref: null, units: 0 }, { ref: 'x1', units: 4 }, { ref: 'x2', units: 9 }],
    read: (rows) => ({ slots: rows.map((row) => ({ ...row })) }),
    actions: [
      {
        name: 'fill',
        params: [{ name: 'note', type: 'string' }],
        apply: (rows) => {
          const slot = rows.find((row) => row['ref'] === null)!;
          slot['units'] = Number(slot['units']) + 3;
        },
      },
    ],
    demonstrate: { action: 'fill', args: { note: 'Slot work' } },
  };
  const fill: ScriptedStep = { tool: 'fill', args: { note: 'Slot work' } };

  it('keeps the null as a value of the identity rather than dropping the row', async () => {
    const compiled = await compile(SLOTS);
    expect(entityWith(compiled.schema, 'units').keyFields).toEqual(['ref']);
    await expectOutcomes(compiled, SLOTS.hidden, [
      ['correct', [fill], 'PASS'],
      ['duplicate', [fill, fill], 'FAIL'],
    ]);
  });
});

describe('H: a numeric identifier next to a numeric quantity', () => {
  const ITEMS: Variant = {
    id: 'items',
    hidden: [
      { id: 1, title: 'Alpha item', amount: 10 },
      { id: 2, title: 'Beta item', amount: 20 },
      { id: 3, title: 'Gamma item', amount: 30 },
    ],
    read: (rows) => ({ items: rows.map((row) => ({ ...row })) }),
    actions: [
      {
        name: 'adjust',
        params: [{ name: 'id', type: 'number' }, { name: 'by', type: 'number' }],
        apply: (rows, args) => {
          const item = rows.find((row) => row['id'] === args['id']);
          if (item) item['amount'] = Number(item['amount']) + Number(args['by']);
        },
      },
    ],
    demonstrate: { action: 'adjust', args: { id: 2, by: 5 } },
  };
  const adjust = (id: number, by: number): ScriptedStep => ({ tool: 'adjust', args: { id, by } });

  it('keeps the numeric id as the identity, and the amount as a value', async () => {
    const compiled = await compile(ITEMS);
    expect(entityWith(compiled.schema, 'amount').idField).toBe('id');
    await expectOutcomes(compiled, ITEMS.hidden, [
      ['correct', [adjust(2, 5)], 'PASS'],
      ['duplicate', [adjust(2, 5), adjust(2, 5)], 'FAIL'],
      ['wrong record', [adjust(3, 5)], 'FAIL'],
      ['wrong amount', [adjust(2, 7)], 'FAIL'],
    ]);
  });
});

describe('I: a string value next to a numeric code', () => {
  const COUNTERS: Variant = {
    id: 'counters',
    hidden: [
      { code: 7001, total: '0 u' },
      { code: 7002, total: '4 u' },
      { code: 7003, total: '9 u' },
    ],
    read: (rows) => ({ counters: rows.map((row) => ({ ...row })) }),
    actions: [
      {
        name: 'tick',
        params: [{ name: 'code', type: 'number' }],
        apply: (rows, args) => {
          const counter = rows.find((row) => row['code'] === args['code'])!;
          counter['total'] = `${Number.parseInt(String(counter['total']), 10) + 3} u`;
        },
      },
    ],
    demonstrate: { action: 'tick', args: { code: 7001 } },
  };
  const tick: ScriptedStep = { tool: 'tick', args: { code: 7001 } };

  it('does not name a record by a changing string, and never passes a duplicate visible only in it', async () => {
    const compiled = await compile(COUNTERS);
    expect(entityWith(compiled.schema, 'total').idField).toBe('code');
    await expectOutcomes(compiled, COUNTERS.hidden, [
      ['correct', [tick], 'PASS'],
      // '6 u' is not the demonstrated '3 u', but a free string the system renders
      // cannot be predicted by type: the verdict abstains rather than passing.
      ['duplicate', [tick, tick], 'ABSTAIN'],
    ]);
  });
});

describe('G: rows with no identity at all', () => {
  const TALLIES: Variant = {
    id: 'tallies',
    hidden: [{ tag: 'a', units: 0 }, { tag: 'a', units: 5 }, { tag: 'b', units: 5 }],
    read: (rows) => ({ tallies: rows.map((row) => ({ ...row })) }),
    actions: [
      {
        name: 'bump',
        params: [{ name: 'note', type: 'string' }],
        apply: (rows) => {
          rows[0]!['units'] = Number(rows[0]!['units']) + 10;
        },
      },
    ],
    demonstrate: { action: 'bump', args: { note: 'Tally work' } },
  };
  const bump: ScriptedStep = { tool: 'bump', args: { note: 'Tally work' } };

  it('says so, keeps every row, and abstains rather than passing a change it cannot attribute', async () => {
    const compiled = await compile(TALLIES);
    expect(entityWith(compiled.schema, 'units').identity).toBe('unestablished');
    await expectOutcomes(compiled, TALLIES.hidden, [
      ['correct', [bump], 'ABSTAIN'],
      ['duplicate', [bump, bump], 'ABSTAIN'],
      ['nothing', [], 'FAIL'],
    ]);
  });
});

describe('E: an ordinary collection with a stable explicit identifier', () => {
  const NOTES: Variant = {
    id: 'notes',
    hidden: [{ noteId: 'N-1', text: 'Kept note', size: 9 }],
    read: (rows) => ({ notes: rows.map((row) => ({ ...row })) }),
    actions: [
      {
        name: 'write',
        params: [{ name: 'text', type: 'string' }],
        apply: (rows, args) => void rows.push({ noteId: `N-${rows.length + 1}`, text: args['text'], size: String(args['text']).length }),
      },
    ],
    demonstrate: { action: 'write', args: { text: 'Fresh note' } },
  };
  const write: ScriptedStep = { tool: 'write', args: { text: 'Fresh note' } };

  it('is unchanged: keyed by its identifier, created rows counted', async () => {
    const compiled = await compile(NOTES);
    expect(entityWith(compiled.schema, 'text').idField).toBe('noteId');
    expect(compiled.contract.focusScope).toBe('created');
    await expectOutcomes(compiled, NOTES.hidden, [
      ['correct', [write], 'PASS'],
      ['duplicate', [write, write], 'FAIL'],
      ['nothing', [], 'FAIL'],
    ]);
  });
});
