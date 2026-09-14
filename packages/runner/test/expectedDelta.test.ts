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
