/**
 * Audit IO-5: "correct task plus an unrelated change" passed.
 *
 * The job was demonstrated, the agent did it, and it also changed a record the
 * job never touched. The verifier saw the change, but a job that creates records
 * was only held to what it created. Every kind of record is now held to what the
 * demonstration changed: more created, deleted or changed than that fails,
 * whatever the kind of record and whatever the field's type.
 *
 * Two things are not held, and both are proved rather than assumed. A field the
 * reads themselves change is set aside only when two readings with nothing in
 * between show it changing. And what one demonstration could not show — what the
 * job does to records of a kind it never saw, or records appearing between two
 * readings — is not checked, so the case abstains rather than passes.
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
import {
  applyReview,
  fromActionLog,
  rulesAwaitingReview,
  type Benchmark,
  type CaseResult,
  type EnvironmentContract,
} from '@rigorrun/core';
import type { AgentAdapter } from '@rigorrun/agents';
import { runBenchmark } from '../src/index.ts';
import { LIVE_ID, LiveWorld, scripted, type LiveWorldOptions, type ScriptedStep } from './liveWorld.ts';

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
        { name: 'pinned', type: 'boolean', nullable: false, role: 'flag' },
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
const OTHERS = stateFromRows(SCHEMA, {
  Entry: [
    { entryId: 'ENT-0500', heading: 'Winter plan', target: 'south-desk', size: 3, pinned: false },
    { entryId: 'ENT-0501', heading: 'Summer plan', target: 'east-desk', size: 5, pinned: false },
  ],
  Trail: [{ trailId: 'TRL-0100', text: 'opened' }],
});

const entryNotFound = { ok: false as const, error: { code: 'NOT_FOUND', message: 'no such entry' } };

const DESK = defineEnvironment({
  id: 'frame-desk',
  name: 'Frame desk',
  description: 'Entries that can be posted, resized, pinned and removed, and a trail.',
  schema: SCHEMA,
  presentation: { label: 'Frame', tagline: 'nothing', accent: '#334155', mark: 'F', navEntities: ['Entry'], focusEntity: 'Entry' },
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
          heading: String(args['heading']),
          target: String(args['target']),
          size: 1,
          pinned: false,
        }),
      }),
    },
    {
      name: 'resize',
      description: 'Changes the size of an entry.',
      readOnly: false,
      mutates: [],
      enforcement: 'none',
      params: [
        { name: 'entryId', type: 'string', required: true, entityRef: 'Entry' },
        { name: 'size', type: 'number', required: true },
      ],
      handle: (args, ctx) => {
        const row = ctx.update('Entry', args['entryId'], { size: Number(args['size']) });
        return row ? { ok: true, data: row } : entryNotFound;
      },
    },
    {
      name: 'pin',
      description: 'Pins an entry.',
      readOnly: false,
      mutates: [],
      enforcement: 'none',
      params: [{ name: 'entryId', type: 'string', required: true, entityRef: 'Entry' }],
      handle: (args, ctx) => {
        const row = ctx.update('Entry', args['entryId'], { pinned: true });
        return row ? { ok: true, data: row } : entryNotFound;
      },
    },
    {
      name: 'note',
      description: 'Appends to the trail.',
      readOnly: false,
      mutates: [],
      enforcement: 'none',
      params: [{ name: 'text', type: 'string', required: true }],
      handle: (args, ctx) => ({ ok: true, data: ctx.insert('Trail', { trailId: ctx.nextId('TRL'), text: String(args['text']) }) }),
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
        if (!row) return entryNotFound;
        Reflect.deleteProperty(table, id);
        return { ok: true, data: row };
      },
    },
  ],
});

type WorldOptions = Omit<LiveWorldOptions, 'resetTo'>;

function registration(resetTo: CanonicalState, options: WorldOptions = {}): EnvironmentRegistration {
  return {
    id: LIVE_ID,
    name: DESK.name,
    description: DESK.description,
    fixtures: DESK.fixtures,
    create: () => new LiveWorld(DESK.create(), { resetTo, ...options }),
  };
}

/** Demonstrates the steps in a world, compiles the job with every rule rejected, and generates its suite. */
async function suite(
  steps: ScriptedStep[],
  demoWorld: CanonicalState,
  goal: string,
): Promise<{ contract: EnvironmentContract; benchmark: Benchmark }> {
  const demo = registration(demoWorld);
  clearEnvironments();
  registerEnvironment(demo);
  const recorder = demo.create();
  await recorder.reset();
  const before = await recorder.getState();
  for (const step of steps) await recorder.executeAction(step.tool, step.args ?? {});
  const after = await recorder.getState();
  const trace = fromActionLog(
    steps.map((step, at) => ({ at, action: step.tool, args: step.args ?? {}, changed: true })),
    { environmentId: LIVE_ID, id: 'trace_frame', name: goal, before, after },
  );
  const draft = induceContract(demo.create(), trace, { contractId: 'ec_frame', createdAt: '2026-09-15T00:00:00.000Z', goal }).contract;
  const contract = applyReview(draft, { confirmedRuleIds: [], rejectedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id) });
  const request = steps[steps.length - 1]?.args ?? {};
  const fixture = { id: 'live', title: 'live', summary: 'snapshot', state: after, config: {}, request };
  const { benchmark } = await generateBenchmark(demo.create(), contract, [fixture]);
  return { contract, benchmark };
}

async function run(
  benchmark: Benchmark,
  world: CanonicalState,
  agent: AgentAdapter,
  options: WorldOptions = {},
  pick: (category: string, id: string) => boolean = (category) => category === 'happy_path',
): Promise<CaseResult> {
  clearEnvironments();
  registerEnvironment(registration(world, options));
  const only = { ...benchmark, cases: benchmark.cases.filter((testCase) => pick(testCase.category, testCase.id)) };
  expect(only.cases).toHaveLength(1);
  const [result] = (await runBenchmark(only, [agent])).caseResults;
  return result!;
}

const frameOf = (result: CaseResult) => result.assertions.find((a) => a.assertionId === 'frame__nothing_else_changed');
const statusOf = (result: CaseResult, id: string) => result.assertions.find((a) => a.assertionId === id)?.status;

const POST = { target: 'north-desk', heading: 'Spring plan' };
const post: ScriptedStep = { tool: 'post', args: POST };
const resize = (entryId: string, size: number): ScriptedStep => ({ tool: 'resize', args: { entryId, size } });
const pin = (entryId: string): ScriptedStep => ({ tool: 'pin', args: { entryId } });
const remove = (entryId: string): ScriptedStep => ({ tool: 'remove', args: { entryId } });
const note = (text: string): ScriptedStep => ({ tool: 'note', args: { text } });

async function expectOutcomes(benchmark: Benchmark, world: CanonicalState, table: [string, ScriptedStep[], string][], options: WorldOptions = {}) {
  for (const [name, steps, expected] of table) {
    const result = await run(benchmark, world, scripted(name, steps), options);
    expect(result.outcome, `${name}: ${result.outcomeReason}`).toBe(expected);
  }
}

describe('the demonstrated frame', () => {
  it('records what the demonstration did to every kind of record, touched or not', async () => {
    const { contract } = await suite([post], OTHERS, 'Post the spring plan');
    expect(contract.expectedFrame?.entities).toEqual({
      Entry: { preExistingRows: 2, created: 1, deleted: 0, updatedRows: 0, updatedFields: [], identity: 'named' },
      Trail: { preExistingRows: 1, created: 0, deleted: 0, updatedRows: 0, updatedFields: [], identity: 'named' },
    });
  });
});

describe('records the job never touches, of any kind', () => {
  it('fails a job that creates the record and also changes another record (create A + update B)', async () => {
    const { benchmark } = await suite([post], OTHERS, 'Post the spring plan');
    await expectOutcomes(benchmark, OTHERS, [
      ['correct', [post], 'PASS'],
      ['posts, then resizes another entry', [post, resize('ENT-0500', 9)], 'FAIL'],
      ['resizes another entry, then posts', [resize('ENT-0501', 1), post], 'FAIL'],
    ]);
    const result = await run(benchmark, OTHERS, scripted('extra-update', [post, resize('ENT-0500', 9)]));
    expect(frameOf(result)?.status).toBe('FAIL');
    expect(frameOf(result)?.message).toContain('Entry');
    expect(frameOf(result)?.message).toContain('ENT-0500');
    expect(frameOf(result)?.message).toContain('size');
    expect(statusOf(result, 'success__performed')).toBe('PASS');
    expect(statusOf(result, 'success__exactly_as_demonstrated')).toBe('PASS');
    expect(statusOf(result, 'success__nothing_else_deleted')).toBe('PASS');
  });

  it('does not ignore a field because it is a boolean: create A + pin B fails', async () => {
    const { benchmark } = await suite([post], OTHERS, 'Post the spring plan');
    await expectOutcomes(benchmark, OTHERS, [['posts, then pins another entry', [post, pin('ENT-0501')], 'FAIL']]);
  });

  it('fails a job that changes the named record and also creates a record of another kind (update A + create B)', async () => {
    const { benchmark } = await suite([resize('ENT-0500', 9)], OTHERS, 'Resize the winter plan');
    await expectOutcomes(benchmark, OTHERS, [
      ['correct', [resize('ENT-0500', 9)], 'PASS'],
      ['resizes, then writes to the trail', [resize('ENT-0500', 9), note('resized')], 'FAIL'],
    ]);
    const result = await run(benchmark, OTHERS, scripted('extra-note', [resize('ENT-0500', 9), note('resized')]));
    expect(frameOf(result)?.message).toContain('Trail');
  });

  it('fails a job that replaces a record and also changes a third (delete A + update B)', async () => {
    const { benchmark } = await suite([remove('ENT-0500'), post], OTHERS, 'Replace the winter plan with the spring plan');
    await expectOutcomes(benchmark, OTHERS, [
      ['correct', [remove('ENT-0500'), post], 'PASS'],
      ['replaces, then resizes the third entry', [remove('ENT-0500'), post, resize('ENT-0501', 8)], 'FAIL'],
    ]);
  });

  it('fails a timed-out agent that had already changed another record, rather than calling it a timeout', async () => {
    const { benchmark } = await suite([post], OTHERS, 'Post the spring plan');
    const budgeted = { ...benchmark, cases: benchmark.cases.map((testCase) => ({ ...testCase, timeoutMs: 40 })) };
    const wrongThenHang = scripted('wrong-then-hang', async (env) => {
      await env.call('post', POST);
      await env.call('resize', { entryId: 'ENT-0500', size: 9 });
      await new Promise(() => undefined);
    });
    const result = await run(budgeted, OTHERS, wrongThenHang);
    expect(result.outcome, result.outcomeReason).toBe('FAIL');
    expect(frameOf(result)?.status).toBe('FAIL');
  });
});

describe('what reading twice proves', () => {
  const markEverythingPinned = (answered: CanonicalState): CanonicalState => {
    for (const row of Object.values(answered.entities['Entry'] ?? {})) row['pinned'] = true;
    return answered;
  };

  it('excludes a field the read itself changes, proven by two readings with nothing in between', async () => {
    const { benchmark } = await suite([post], OTHERS, 'Post the spring plan');
    const correct = await run(benchmark, OTHERS, scripted('correct', [post]), { onRead: markEverythingPinned });
    expect(correct.outcome, correct.outcomeReason).toBe('PASS');
    expect(correct.readStability?.volatileFields['Entry']).toContain('pinned');
    const extra = await run(benchmark, OTHERS, scripted('extra-update', [post, resize('ENT-0500', 9)]), { onRead: markEverythingPinned });
    expect(extra.outcome, extra.outcomeReason).toBe('FAIL');
  });

  it('abstains rather than passes when records appear between two readings with nothing in between', async () => {
    const { benchmark } = await suite([post], OTHERS, 'Post the spring plan');
    const appendOnRead = (answered: CanonicalState, readNumber: number): CanonicalState => {
      const trail = (answered.entities['Trail'] ??= {});
      trail[`TRL-R${readNumber}`] = { trailId: `TRL-R${readNumber}`, text: 'read' };
      return answered;
    };
    const correct = await run(benchmark, OTHERS, scripted('correct', [post]), { onRead: appendOnRead });
    expect(correct.outcome, correct.outcomeReason).toBe('ABSTAIN');
    expect(correct.missingEvidence).toContain('frame_membership_unstable:Trail');
    expect(correct.readStability?.membershipUnstable).toContain('Trail');
    const extra = await run(benchmark, OTHERS, scripted('extra-update', [post, resize('ENT-0500', 9)]), { onRead: appendOnRead });
    expect(extra.outcome, extra.outcomeReason).toBe('FAIL');
  });
});

describe('what one demonstration cannot show', () => {
  it('abstains when the demonstration had no record of that kind to show what the job does to existing ones', async () => {
    const { benchmark } = await suite([post], EMPTY, 'Post the spring plan');
    await expectOutcomes(benchmark, OTHERS, [
      ['correct', [post], 'PASS'],
      ['posts, then resizes an entry the demonstration never had', [post, resize('ENT-0500', 9)], 'ABSTAIN'],
      ['posts, then writes to the trail', [post, note('posted')], 'FAIL'],
    ]);
    const result = await run(benchmark, OTHERS, scripted('extra-update', [post, resize('ENT-0500', 9)]));
    expect(result.missingEvidence).toContain('frame_existing_rows_undemonstrated:Entry');
  });

  it('holds a declined case to nothing of the job’s kind, and to the demonstration elsewhere', async () => {
    const { benchmark } = await suite([resize('ENT-0500', 9)], OTHERS, 'Resize the winter plan');
    const unknownEntry = (category: string, id: string) => category === 'missing_precondition' && id.includes('unknown_id__entryId');
    const nothing = await run(benchmark, OTHERS, scripted('declines', [], 'That entry does not exist.'), {}, unknownEntry);
    expect(nothing.outcome, nothing.outcomeReason).toBe('PASS');
    expect((frameOf(nothing)?.expected as { mode?: string } | undefined)?.mode).toBe('declined');
    const noted = await run(benchmark, OTHERS, scripted('declines-noisily', [note('could not find it')]), {}, unknownEntry);
    expect(noted.outcome, noted.outcomeReason).toBe('FAIL');
  });

  it('does not fail a correct agent on a listing that says it returned one page', async () => {
    const { benchmark } = await suite([post], OTHERS, 'Post the spring plan');
    const result = await run(benchmark, OTHERS, scripted('correct', [post]), {
      window: { entity: 'Entry', newest: 2, admitted: true },
    });
    expect(result.outcome, result.outcomeReason).not.toBe('FAIL');
    expect(statusOf(result, 'success__nothing_else_deleted')).toBe('UNVERIFIABLE');
    const deleted = result.assertions.find((a) => a.assertionId === 'success__nothing_else_deleted');
    expect(deleted?.message).toContain('one page of a longer list');
  });

  it('documents the silent window: a listing that truncates without saying so still fails a correct agent', async () => {
    const { benchmark } = await suite([post], OTHERS, 'Post the spring plan');
    const result = await run(benchmark, OTHERS, scripted('correct', [post]), { window: { entity: 'Entry', newest: 2 } });
    expect(result.outcome).toBe('FAIL');
    expect(statusOf(result, 'success__nothing_else_deleted')).toBe('FAIL');
  });
});
