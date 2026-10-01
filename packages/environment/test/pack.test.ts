/**
 * The pack contract, against a fake session that records what it is asked.
 *
 * The fake knows nothing about any business. These tests are about what the
 * adapter promises the runner: one case's scope and bindings never leak into
 * another's, a world it cannot install is refused rather than pretended, and
 * what it can claim is declared honestly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  PackEnvironment,
  StateReadError,
  capabilityLimits,
  clearPacks,
  emptyState,
  getPack,
  hasPack,
  isolationLevel,
  listPacks,
  mayRepeatMutatingCases,
  registerPack,
  verificationStrength,
  type CanonicalState,
  type PackCaseContext,
  type PackDefinition,
  type PackScope,
  type PackSession,
  type SafetyMode,
} from '../src/index.ts';
import { TEST_SCHEMA } from './support.ts';

const CTX: PackCaseContext = { runId: 'run_1', caseId: 'case_a', agentId: 'agent_1', attempt: 0 };

interface FakeSession extends PackSession {
  reads: (PackScope | null)[];
  made: { recipe: unknown; ctx: PackCaseContext }[];
  executed: { name: string; args: Record<string, unknown> }[];
}

function fakeSession(
  options: { safety?: SafetyMode; simulated?: boolean; reality?: boolean } = {},
): FakeSession {
  let next = 0;
  const session: FakeSession = {
    system: 'The fake system',
    safety: options.safety ?? 'staging',
    simulated: options.simulated ?? true,
    reads: [],
    made: [],
    executed: [],
    async materialize(recipe, ctx) {
      session.made.push({ recipe, ctx });
      next += 1;
      return {
        bindings: { item: `it_${next}` },
        scope: {
          description: `Item it_${next} and what hangs off it.`,
          data: { ids: [`it_${next}`] },
        },
      };
    },
    async read(scope) {
      session.reads.push(scope);
      return emptyState(TEST_SCHEMA);
    },
    actions: () => [
      {
        name: 'touch',
        description: 'Touch an item.',
        params: [],
        mutates: [],
        readOnly: false,
        enforcement: 'none',
      },
    ],
    async execute(name, args) {
      session.executed.push({ name, args });
      return name === 'touch'
        ? { ok: true, data: { touched: true } }
        : { ok: false, error: { code: 'NO', message: 'no such action' } };
    },
    async close() {},
  };
  if (options.reality !== false) {
    session.reality = (_seed, _final, bindings) => [
      `${bindings['item'] ?? 'nothing'} was looked at.`,
    ];
  }
  return session;
}

const PACK: PackDefinition = {
  id: 'fake',
  name: 'Fake pack',
  description: 'A pack that exists only in this test.',
  schema: TEST_SCHEMA,
  open: async () => fakeSession(),
  describeAction: (config) => `call the fake system in ${config.mode} mode`,
};

afterEach(() => clearPacks());

describe('the pack registry', () => {
  it('finds a registered pack by id, and lists packs in a stable order', () => {
    registerPack({ ...PACK, id: 'zeta' });
    registerPack(PACK);
    expect(hasPack('fake')).toBe(true);
    expect(getPack('fake').name).toBe('Fake pack');
    expect(listPacks().map((pack) => pack.id)).toEqual(['fake', 'zeta']);
  });

  it('names what is registered when asked for something that is not', () => {
    registerPack(PACK);
    expect(hasPack('missing')).toBe(false);
    expect(() => getPack('missing')).toThrow(/Unknown pack "missing".*fake/);
  });

  it('refuses a pack whose schema is invalid, before anything can use it', () => {
    const broken = {
      ...PACK,
      schema: { entities: [{ ...TEST_SCHEMA.entities[0]!, idField: 'nope' }], relationships: [] },
    };
    expect(() => registerPack(broken)).toThrow(/invalid schema/);
    expect(hasPack('fake')).toBe(false);
  });
});

describe('a pack environment', () => {
  it('declares what it can do, and what that lets a run claim', () => {
    const environment = new PackEnvironment(
      PACK,
      fakeSession({ safety: 'staging', simulated: true }),
    );
    const caps = environment.capabilities();
    expect(caps).toMatchObject({
      discovery: 'declared-schema',
      stateRead: 'designated-reads',
      stateReadIndependence: 'independent',
      seed: 'materialized',
      reset: 'namespace',
      safety: 'staging',
      simulated: true,
    });
    expect(isolationLevel(caps)).toBe('FRESH_OBJECTS');
    expect(mayRepeatMutatingCases(caps)).toBe(true);
    expect(verificationStrength(caps)).toBe('PARTIAL');
    expect(
      capabilityLimits(caps)
        .map((limit) => limit.id)
        .sort(),
    ).toEqual(['scoped_state_read', 'simulated']);
    expect(environment.capabilities().simulated).toBe(true);
    expect(
      new PackEnvironment(PACK, fakeSession({ simulated: false })).capabilities().simulated,
    ).toBe(false);
  });

  it('reads the scope the case materialized, and reports it with the bindings', async () => {
    const session = fakeSession();
    const environment = new PackEnvironment(PACK, session);
    await environment.reset();
    const made = await environment.materialize({ recipe: { size: 25 } }, CTX);
    expect(made).toEqual({
      bindings: { item: 'it_1' },
      readScope: 'Item it_1 and what hangs off it.',
    });
    expect(session.made).toEqual([{ recipe: { size: 25 }, ctx: CTX }]);

    await environment.getState();
    expect(session.reads).toEqual([
      { description: 'Item it_1 and what hangs off it.', data: { ids: ['it_1'] } },
    ]);
  });

  it('forgets the scope on reset, and touches nothing in the system', async () => {
    const session = fakeSession();
    const environment = new PackEnvironment(PACK, session);
    await environment.materialize({ recipe: {} }, CTX);
    await environment.reset();
    await environment.getState();
    expect(session.reads).toEqual([null]);
    expect(session.executed).toEqual([]);
  });

  it('keeps each case to its own records over one shared session', async () => {
    const session = fakeSession();
    const first = new PackEnvironment(PACK, session);
    const second = new PackEnvironment(PACK, session);
    await first.materialize({ recipe: {} }, CTX);
    await second.materialize({ recipe: {} }, { ...CTX, attempt: 1 });
    await first.getState();
    await second.getState();
    expect(session.reads.map((scope) => scope?.data)).toEqual([
      { ids: ['it_1'] },
      { ids: ['it_2'] },
    ]);
    expect(session.made.map((entry) => entry.ctx.attempt)).toEqual([0, 1]);
  });

  it('refuses a case with no recipe rather than reading an empty world as its start', async () => {
    const session = fakeSession();
    await expect(new PackEnvironment(PACK, session).materialize({}, CTX)).rejects.toThrow(
      /no recipe/,
    );
    expect(session.made).toEqual([]);
  });

  it('creates nothing in a system marked production', async () => {
    const session = fakeSession({ safety: 'production' });
    await expect(
      new PackEnvironment(PACK, session).materialize({ recipe: {} }, CTX),
    ).rejects.toThrow(/production/);
    expect(session.made).toEqual([]);
  });

  it('refuses to install a world or travel back to one', async () => {
    const environment = new PackEnvironment(PACK, fakeSession());
    expect(() => environment.seed(emptyState(TEST_SCHEMA))).toThrow(/materialize\(\)/);
    const snapshot = await environment.snapshot();
    expect(() => environment.restore(snapshot)).toThrow(/cannot go back/);
  });

  it('passes calls to the session and logs them as its own evidence', async () => {
    const session = fakeSession();
    const environment = new PackEnvironment(PACK, session);
    expect(environment.getActions().map((action) => action.name)).toEqual(['touch']);
    expect(await environment.executeAction('touch', { id: 'it_1' })).toEqual({
      ok: true,
      data: { touched: true },
    });
    expect(await environment.executeAction('other', {})).toMatchObject({ ok: false });
    const events = environment.getEvents();
    expect(events.map((event) => [event.type, event.ordinal, event.ok])).toEqual([
      ['touch', 0, true],
      ['other', 1, false],
    ]);
    expect(events[1]?.error).toBe('no such action');
    // A copy, so a reader cannot rewrite the record.
    events[0]!.ok = false;
    expect(environment.getEvents()[0]?.ok).toBe(true);
    await environment.reset();
    expect(environment.getEvents()).toEqual([]);
  });

  it('lets a read failure through, so an unknown world is never taken for an empty one', async () => {
    const session = fakeSession();
    session.read = async () => {
      throw new StateReadError('list items', 'the system did not answer');
    };
    await expect(new PackEnvironment(PACK, session).getState()).rejects.toBeInstanceOf(
      StateReadError,
    );
  });

  it('gives the system’s own account with the case’s bindings, when the pack has one', async () => {
    const environment = new PackEnvironment(PACK, fakeSession());
    await environment.materialize({ recipe: {} }, CTX);
    const state: CanonicalState = emptyState(TEST_SCHEMA);
    expect(environment.describeReality(state, state)).toEqual({
      system: 'The fake system',
      lines: ['it_1 was looked at.'],
    });
    const silent = new PackEnvironment(PACK, fakeSession({ reality: false }));
    expect(silent.describeReality(state, state)).toBeUndefined();
  });

  it('presents itself from the schema when the pack declares nothing', () => {
    const hints = new PackEnvironment(PACK, fakeSession()).describePresentation();
    expect(hints.label).toBe('Fake pack');
    expect(hints.navEntities).toEqual(TEST_SCHEMA.entities.map((entity) => entity.name));
  });
});
