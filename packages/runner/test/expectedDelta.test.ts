/**
 * Audit finding R-1, the false-negative half: "a record exists" is not "the
 * job was done".
 *
 * Once the baseline is fresh, a duplicate, a wrong value or a wrong entity is
 * still invisible to a check that only asks whether something was created.
 * The demonstration says more than that — how many records the job produced,
 * and which of their fields carried which arguments — and a case now checks
 * both.
 *
 * Two neutral jobs cover the two ways real servers carry values. In the first,
 * the system stores an argument inside a wrapper of its own (a subject framed
 * by an untrusted-data banner). In the second, every value arrives inside one
 * free-text argument (values inside a query). Names are meaningless on
 * purpose, and the environment declares no `mutates`, like an MCP server.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearEnvironments,
  defineEnvironment,
  registerEnvironment,
  stateFromRows,
  type CanonicalState,
  type EnvironmentRegistration,
  type EnvironmentSchema,
} from '@rigorrun/environment';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { applyReview, fromActionLog, rulesAwaitingReview, type Benchmark, type EnvironmentContract } from '@rigorrun/core';
import type { AgentAdapter } from '@rigorrun/agents';
import { runBenchmark } from '../src/index.ts';
import { LIVE_ID, LiveWorld, happyOnly, scripted } from './liveWorld.ts';

afterEach(() => clearEnvironments());

const SCHEMA: EnvironmentSchema = {
  entities: [
    {
      name: 'Entry',
      idField: 'entryId',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'entryId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'heading', type: 'string', nullable: false, role: 'freetext' },
        { name: 'target', type: 'string', nullable: false, role: 'identifier' },
        { name: 'size', type: 'number', nullable: false, role: 'quantity', unit: 'count', precision: 1 },
        // Assigned by the system on every write. Never an argument.
        { name: 'revision', type: 'number', nullable: false, role: 'quantity', unit: 'count', precision: 1 },
      ],
    },
    {
      name: 'Trail',
      idField: 'trailId',
      mutable: false,
      appendOnly: true,
      fields: [
        { name: 'trailId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'text', type: 'string', nullable: false, role: 'freetext' },
      ],
    },
  ],
  relationships: [],
};

const EMPTY = stateFromRows(SCHEMA, { Entry: [], Trail: [] });

const NEUTRAL = defineEnvironment({
  id: 'neutral-desk',
  name: 'Neutral desk',
  description: 'Two ways of carrying the same values.',
  schema: SCHEMA,
  presentation: {
    label: 'Neutral',
    tagline: 'nothing',
    accent: '#334155',
    mark: 'N',
    navEntities: ['Entry'],
    focusEntity: 'Entry',
  },
  fixtures: [{ id: 'empty', title: 'Empty', summary: 'nothing yet', state: EMPTY, config: {}, request: {} }],
  actions: [
    {
      name: 'list_entries',
      description: 'Every entry.',
      readOnly: true,
      mutates: [],
      enforcement: 'none',
      params: [],
      handle: (_args, ctx) => ({ ok: true, data: Object.values(ctx.state.entities['Entry'] ?? {}) }),
    },
    {
      name: 'post',
      description: 'Posts an entry.',
      readOnly: false,
      mutates: [],
      enforcement: 'none',
      params: [
        { name: 'target', type: 'string', required: true },
        { name: 'heading', type: 'string', required: true },
      ],
      handle: (args, ctx) => ({
        ok: true,
        data: ctx.insert('Entry', {
          entryId: ctx.nextId('ENT'),
          // The system frames what an outsider wrote, as mail servers do.
          heading: `<<external>> ${String(args['heading'])} <<end>>`,
          target: String(args['target']),
          size: 1,
          revision: 1,
        }),
      }),
    },
    {
      name: 'run',
      description: 'Runs a statement.',
      readOnly: false,
      mutates: [],
      enforcement: 'none',
      params: [{ name: 'text', type: 'string', required: true }],
      handle: (args, ctx) => {
        const match = /heading=([^;]+);target=([^;]+);size=(\d+)/.exec(String(args['text']));
        if (!match) return { ok: false, error: { code: 'BAD_STATEMENT', message: 'unparseable' } };
        return {
          ok: true,
          data: ctx.insert('Entry', {
            entryId: ctx.nextId('ENT'),
            heading: match[1]!,
            target: match[2]!,
            size: Number(match[3]),
            revision: 1,
          }),
        };
      },
    },
    {
      name: 'note',
      description: 'Appends to the trail.',
      readOnly: false,
      mutates: [],
      enforcement: 'none',
      params: [{ name: 'text', type: 'string', required: true }],
      handle: (args, ctx) => ({
        ok: true,
        data: ctx.insert('Trail', { trailId: ctx.nextId('TRL'), text: String(args['text']) }),
      }),
    },
    {
      name: 'remove',
      description: 'Removes an entry.',
      readOnly: false,
      mutates: [],
      enforcement: 'none',
      params: [{ name: 'entryId', type: 'string', required: true, entityRef: 'Entry' }],
      handle: (args, ctx) => {
        const table = ctx.state.entities['Entry'] ?? {};
        const id = String(args['entryId']);
        const row = table[id];
        if (!row) return { ok: false, error: { code: 'NOT_FOUND', message: 'no such entry' } };
        Reflect.deleteProperty(table, id);
        return { ok: true, data: row };
      },
    },
  ],
});

function registrationFor(resetTo: CanonicalState): EnvironmentRegistration {
  return {
    id: LIVE_ID,
    name: NEUTRAL.name,
    description: NEUTRAL.description,
    fixtures: NEUTRAL.fixtures,
    create: () => new LiveWorld(NEUTRAL.create(), { resetTo }),
  };
}

async function suiteFor(
  action: string,
  args: Record<string, unknown>,
): Promise<{ contract: EnvironmentContract; benchmark: Benchmark }> {
  const registration = registrationFor(EMPTY);
  clearEnvironments();
  registerEnvironment(registration);
  const recorder = registration.create();
  await recorder.reset();
  const before = await recorder.getState();
  await recorder.executeAction(action, args);
  const after = await recorder.getState();
  const trace = fromActionLog([{ at: 0, action, args, changed: true }], {
    environmentId: LIVE_ID,
    id: `trace_${action}`,
    name: 'one entry',
    before,
    after,
  });
  const draft = induceContract(registration.create(), trace, {
    contractId: `ec_${action}`,
    createdAt: '2026-09-14T00:00:00.000Z',
    goal: 'Record one entry',
  }).contract;
  const contract = applyReview(draft, {
    confirmedRuleIds: [],
    rejectedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id),
  });
  // The generation snapshot holds the demonstrated entry, as it does in the product.
  const fixture = { id: 'live', title: 'live', summary: 'snapshot', state: after, config: {}, request: args };
  const { benchmark } = await generateBenchmark(registration.create(), contract, [fixture]);
  return { contract, benchmark: happyOnly(benchmark) };
}

async function outcomeIn(benchmark: Benchmark, world: CanonicalState, agent: AgentAdapter) {
  clearEnvironments();
  registerEnvironment(registrationFor(world));
  const result = await runBenchmark(benchmark, [agent]);
  const [only] = result.caseResults;
  return only!;
}

describe('a value the system wraps in its own framing', () => {
  const POST = { target: 'north-desk', heading: 'Spring plan' };
  const accumulated = stateFromRows(SCHEMA, {
    Entry: [{ entryId: 'ENT-0001', heading: '<<external>> Spring plan <<end>>', target: 'north-desk', size: 1, revision: 1 }],
    Trail: [],
  });

  it('observes which fields carry which arguments, and how many records the job makes', async () => {
    const { contract } = await suiteFor('post', POST);
    expect(contract.argumentBindings.map((b) => [b.field, b.param, b.mode])).toEqual([
      ['heading', 'heading', 'field_contains_param'],
      ['target', 'target', 'equals'],
    ]);
    expect(contract.expectedDeltaCount).toBe(1);
  });

  const agents = {
    correct: scripted('correct', [{ tool: 'post', args: POST }]),
    duplicate: scripted('duplicate', [{ tool: 'post', args: POST }, { tool: 'post', args: POST }]),
    'wrong value': scripted('wrong-heading', [{ tool: 'post', args: { ...POST, heading: 'Autumn plan' } }]),
    'near-miss value': scripted('near-miss', [{ tool: 'post', args: { ...POST, heading: 'Spring pla' } }]),
    'wrong target': scripted('wrong-target', [{ tool: 'post', args: { ...POST, target: 'south-desk' } }]),
    'wrong entity': scripted('wrong-entity', [{ tool: 'note', args: { text: 'north-desk Spring plan' } }]),
    'false claim': scripted('false-claim', [], 'Posted it.'),
    'read only': scripted('reads', [{ tool: 'list_entries' }], 'Posted it.'),
  };

  for (const [worldName, world] of [['clean', EMPTY], ['accumulated', accumulated]] as const) {
    it(`passes the correct agent and fails every wrong one (${worldName} world)`, async () => {
      const { benchmark } = await suiteFor('post', POST);
      for (const [name, agent] of Object.entries(agents)) {
        const result = await outcomeIn(benchmark, world, agent);
        expect(result.outcome, `${name}: ${result.outcomeReason}`).toBe(name === 'correct' ? 'PASS' : 'FAIL');
      }
    });
  }

  it('names the duplicate for what it is', async () => {
    const { benchmark } = await suiteFor('post', POST);
    const result = await outcomeIn(benchmark, EMPTY, agents.duplicate);
    const exact = result.assertions.find((a) => a.assertionId === 'success__exactly_as_demonstrated');
    expect(exact?.status).toBe('FAIL');
    expect(result.assertions.find((a) => a.assertionId === 'success__performed')?.status).toBe('PASS');
  });
});

describe('values that arrive inside one free-text argument', () => {
  const TEXT = { text: 'put heading=Spring plan;target=north-desk;size=17 limit 1' };
  const accumulated = stateFromRows(SCHEMA, {
    Entry: [{ entryId: 'ENT-0001', heading: 'Spring plan', target: 'north-desk', size: 17, revision: 1 }],
    Trail: [],
  });

  it('finds the field values inside the argument, as whole tokens, and never binds a coincidence', async () => {
    const { contract } = await suiteFor('run', TEXT);
    expect(contract.argumentBindings.map((b) => [b.field, b.param, b.mode])).toEqual([
      ['heading', 'text', 'param_contains_field'],
      ['size', 'text', 'param_contains_field'],
      ['target', 'text', 'param_contains_field'],
    ]);
    // `revision` is 1, and "1" is in the text. One character is not evidence.
    expect(contract.argumentBindings.map((b) => b.field)).not.toContain('revision');
  });

  const agents = {
    correct: scripted('correct', [{ tool: 'run', args: TEXT }]),
    'correct, worded differently': scripted('reworded', [
      { tool: 'list_entries' },
      { tool: 'run', args: { text: 'heading=Spring plan;target=north-desk;size=17' } },
    ]),
    duplicate: scripted('duplicate', [{ tool: 'run', args: TEXT }, { tool: 'run', args: TEXT }]),
    'wrong value': scripted('wrong-size', [{ tool: 'run', args: { text: 'put heading=Spring plan;target=north-desk;size=71' } }]),
    'near-miss value': scripted('near-miss', [{ tool: 'run', args: { text: 'put heading=Spring plans;target=north-desk;size=17' } }]),
    'wrong entity': scripted('wrong-entity', [{ tool: 'note', args: { text: TEXT.text } }]),
    'false claim': scripted('false-claim', [], 'Ran it.'),
  };

  for (const [worldName, world] of [['clean', EMPTY], ['accumulated', accumulated]] as const) {
    it(`passes correct agents and fails every wrong one (${worldName} world)`, async () => {
      const { benchmark } = await suiteFor('run', TEXT);
      for (const [name, agent] of Object.entries(agents)) {
        const result = await outcomeIn(benchmark, world, agent);
        expect(result.outcome, `${name}: ${result.outcomeReason}`).toBe(name.startsWith('correct') ? 'PASS' : 'FAIL');
      }
    });
  }
});

describe('a job that changes an existing record, named by its identifier', () => {
  const TICKETS: EnvironmentSchema = {
    entities: [
      {
        name: 'Ticket',
        idField: 'ticketId',
        mutable: true,
        appendOnly: false,
        fields: [
          { name: 'ticketId', type: 'string', nullable: false, role: 'identifier' },
          { name: 'subject', type: 'string', nullable: false, role: 'freetext' },
          { name: 'state', type: 'enum', nullable: false, role: 'status', enumValues: ['closed', 'open'] },
        ],
      },
    ],
    relationships: [],
  };
  // Two open tickets that are identical except for their identifier.
  const OPEN = stateFromRows(TICKETS, {
    Ticket: [
      { ticketId: 'T-1', subject: 'Printer', state: 'open' },
      { ticketId: 'T-2', subject: 'Printer', state: 'open' },
      { ticketId: 'T-3', subject: 'Badge', state: 'closed' },
    ],
  });
  const TICKET_DESK = defineEnvironment({
    id: 'ticket-desk',
    name: 'Ticket desk',
    description: 'Tickets that can be closed.',
    schema: TICKETS,
    presentation: { label: 'Tickets', tagline: 'nothing', accent: '#334155', mark: 'T', navEntities: ['Ticket'], focusEntity: 'Ticket' },
    fixtures: [{ id: 'open', title: 'Open', summary: 'two open twins', state: OPEN, config: {}, request: {} }],
    actions: [
      {
        name: 'list_tickets',
        description: 'Every ticket.',
        readOnly: true,
        mutates: [],
        enforcement: 'none',
        params: [],
        handle: (_args, ctx) => ({ ok: true, data: Object.values(ctx.state.entities['Ticket'] ?? {}) }),
      },
      {
        name: 'close_ticket',
        description: 'Closes a ticket.',
        readOnly: false,
        mutates: [],
        enforcement: 'none',
        params: [{ name: 'ticketId', type: 'string', required: true, entityRef: 'Ticket' }],
        // Idempotent: closing a closed ticket changes nothing.
        handle: (args, ctx) => {
          const row = ctx.update('Ticket', args['ticketId'], { state: 'closed' });
          return row ? { ok: true, data: row } : { ok: false, error: { code: 'NOT_FOUND', message: 'no such ticket' } };
        },
      },
    ],
  });
  const registration: EnvironmentRegistration = {
    id: LIVE_ID,
    name: TICKET_DESK.name,
    description: TICKET_DESK.description,
    fixtures: TICKET_DESK.fixtures,
    create: () => new LiveWorld(TICKET_DESK.create(), { resetTo: OPEN }),
  };

  async function closingSuite(): Promise<{ contract: EnvironmentContract; benchmark: Benchmark }> {
    clearEnvironments();
    registerEnvironment(registration);
    const recorder = registration.create();
    await recorder.reset();
    const before = await recorder.getState();
    await recorder.executeAction('close_ticket', { ticketId: 'T-1' });
    const after = await recorder.getState();
    const trace = fromActionLog([{ at: 0, action: 'close_ticket', args: { ticketId: 'T-1' }, changed: true }], {
      environmentId: LIVE_ID,
      id: 'trace_close',
      name: 'close one ticket',
      before,
      after,
    });
    const draft = induceContract(registration.create(), trace, {
      contractId: 'ec_close',
      createdAt: '2026-09-14T00:00:00.000Z',
      goal: 'Close the printer ticket',
    }).contract;
    const contract = applyReview(draft, {
      confirmedRuleIds: [],
      rejectedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id),
    });
    const fixture = { id: 'live', title: 'live', summary: 'snapshot', state: after, config: {}, request: { ticketId: 'T-1' } };
    const { benchmark } = await generateBenchmark(registration.create(), contract, [fixture]);
    return { contract, benchmark: happyOnly(benchmark) };
  }

  it('binds the identifier of the record the job changes, by equality', async () => {
    const { contract } = await closingSuite();
    expect(contract.focusScope).toBe('changed');
    expect(contract.argumentBindings.map((b) => [b.field, b.param, b.mode])).toContainEqual(['ticketId', 'ticketId', 'equals']);
    expect(contract.expectedDeltaCount).toBe(1);
  });

  it('passes closing the named ticket and fails closing its identical twin', async () => {
    const { benchmark } = await closingSuite();
    const close = (ticketId: string) => ({ tool: 'close_ticket', args: { ticketId } });
    const agents: [string, AgentAdapter, 'PASS' | 'FAIL'][] = [
      ['correct', scripted('correct', [close('T-1')]), 'PASS'],
      ['correct, repeated (idempotent)', scripted('repeat', [close('T-1'), { tool: 'list_tickets' }, close('T-1')]), 'PASS'],
      ['wrong twin', scripted('twin', [close('T-2')]), 'FAIL'],
      ['both twins', scripted('both', [close('T-1'), close('T-2')]), 'FAIL'],
      ['nothing', scripted('nothing', [], 'Closed it.'), 'FAIL'],
    ];
    for (const [name, agent, expected] of agents) {
      clearEnvironments();
      registerEnvironment(registration);
      const [result] = (await runBenchmark(benchmark, [agent])).caseResults;
      expect(result!.outcome, `${name}: ${result!.outcomeReason}`).toBe(expected);
    }
  });
});

/**
 * Audit AFTER-1: an agent that did the job and also deleted another record of
 * the same kind passed, because the checks asked only what was created. The
 * expected final state is the starting world plus the demonstrated delta, and a
 * record the demonstration did not delete is part of that world.
 *
 * Deletions of this kind are held to the demonstration exactly here. Changes to
 * other records, of this kind and every other, are held by the frame check
 * (frame.test.ts, audit IO-5): a field the reads themselves change is set aside
 * only when two readings with nothing in between prove it.
 */
describe('records the job never deletes', () => {
  const POST = { target: 'north-desk', heading: 'Spring plan' };
  const OTHERS = stateFromRows(SCHEMA, {
    Entry: [
      { entryId: 'ENT-0500', heading: 'Winter plan', target: 'south-desk', size: 3, revision: 2 },
      { entryId: 'ENT-0501', heading: 'Summer plan', target: 'east-desk', size: 5, revision: 1 },
    ],
    Trail: [],
  });
  const post = { tool: 'post', args: POST };
  const remove = (entryId: string) => ({ tool: 'remove', args: { entryId } });

  it('observes that the demonstration deleted nothing', async () => {
    const { contract } = await suiteFor('post', POST);
    expect(contract.expectedDeletedCount).toBe(0);
  });

  it('fails an agent that does the job and deletes a record it was never asked to touch', async () => {
    const { benchmark } = await suiteFor('post', POST);
    const extraDelete = scripted('extra-delete', [post, remove('ENT-0500')]);
    const agents: [string, AgentAdapter, 'PASS' | 'FAIL'][] = [
      ['correct', scripted('correct', [post]), 'PASS'],
      ['correct, then deletes another entry', extraDelete, 'FAIL'],
      ['deletes another entry first, then does the job', scripted('delete-first', [remove('ENT-0501'), post]), 'FAIL'],
      ['deletes instead of doing the job', scripted('delete-only', [remove('ENT-0500')]), 'FAIL'],
    ];
    for (const [name, agent, expected] of agents) {
      const result = await outcomeIn(benchmark, OTHERS, agent);
      expect(result.outcome, `${name}: ${result.outcomeReason}`).toBe(expected);
    }
    const result = await outcomeIn(benchmark, OTHERS, extraDelete);
    expect(result.assertions.find((a) => a.assertionId === 'success__performed')?.status).toBe('PASS');
    expect(result.assertions.find((a) => a.assertionId === 'success__nothing_else_deleted')?.status).toBe('FAIL');
  });

  it('passes a job whose demonstration deletes, and holds it to exactly that many', async () => {
    clearEnvironments();
    const registration = registrationFor(OTHERS);
    registerEnvironment(registration);
    const recorder = registration.create();
    await recorder.reset();
    const before = await recorder.getState();
    await recorder.executeAction('remove', { entryId: 'ENT-0500' });
    await recorder.executeAction('post', POST);
    const after = await recorder.getState();
    const trace = fromActionLog(
      [
        { at: 0, action: 'remove', args: { entryId: 'ENT-0500' }, changed: true },
        { at: 1, action: 'post', args: POST, changed: true },
      ],
      { environmentId: LIVE_ID, id: 'trace_replace', name: 'replace an entry', before, after },
    );
    const draft = induceContract(registration.create(), trace, {
      contractId: 'ec_replace',
      createdAt: '2026-09-14T00:00:00.000Z',
      goal: 'Replace the winter plan with the spring plan',
    }).contract;
    const contract = applyReview(draft, {
      confirmedRuleIds: [],
      rejectedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id),
    });
    expect(contract.expectedDeletedCount).toBe(1);
    const fixture = { id: 'live', title: 'live', summary: 'snapshot', state: after, config: {}, request: POST };
    const benchmark = happyOnly((await generateBenchmark(registration.create(), contract, [fixture])).benchmark);
    const agents: [string, AgentAdapter, 'PASS' | 'FAIL'][] = [
      ['correct', scripted('correct', [remove('ENT-0500'), post]), 'PASS'],
      ['correct, in the other order', scripted('reordered', [post, remove('ENT-0500')]), 'PASS'],
      ['posts but never deletes', scripted('no-delete', [post]), 'FAIL'],
      ['deletes both entries', scripted('delete-both', [remove('ENT-0500'), remove('ENT-0501'), post]), 'FAIL'],
    ];
    for (const [name, agent, expected] of agents) {
      const result = await outcomeIn(benchmark, OTHERS, agent);
      expect(result.outcome, `${name}: ${result.outcomeReason}`).toBe(expected);
    }
  });
});
