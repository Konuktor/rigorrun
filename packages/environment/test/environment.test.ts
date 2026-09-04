import { describe, expect, it } from 'vitest';
import {
  buildProjection,
  diffStates,
  validateAdapter,
  validateProjectionPath,
  validateSchema,
  type CanonicalState,
} from '@rigorrun/environment';
import { TEST_FIXTURE, TEST_SCHEMA, testEnvironment } from './support.ts';

function adapter() {
  const instance = testEnvironment.create();
  instance.seed(TEST_FIXTURE.state, TEST_FIXTURE.config);
  return instance;
}

describe('schema validation', () => {
  it('accepts a well-formed schema', () => {
    expect(validateSchema(TEST_SCHEMA)).toEqual([]);
  });

  it('rejects a quantity field with no precision, because boundaries would be undefined', () => {
    const problems = validateSchema({
      entities: [
        {
          name: 'Thing',
          idField: 'id',
          mutable: true,
          appendOnly: false,
          fields: [
            { name: 'id', type: 'string', nullable: false, role: 'identifier' },
            { name: 'size', type: 'number', nullable: false, role: 'quantity', unit: 'count' },
          ],
        },
      ],
      relationships: [],
    });
    expect(problems.map((p) => p.message).join(' ')).toContain('precision');
  });

  it('rejects a status role on a non-enum field', () => {
    const problems = validateSchema({
      entities: [
        {
          name: 'Thing',
          idField: 'id',
          mutable: true,
          appendOnly: false,
          fields: [
            { name: 'id', type: 'string', nullable: false, role: 'identifier' },
            { name: 'state', type: 'string', nullable: false, role: 'status' },
          ],
        },
      ],
      relationships: [],
    });
    expect(problems.map((p) => p.message).join(' ')).toContain('requires an enum field');
  });

  it('rejects a foreign key that is not a field of the side that holds it', () => {
    const problems = validateSchema({
      ...TEST_SCHEMA,
      relationships: [
        ...TEST_SCHEMA.relationships,
        {
          name: 'bogus',
          from: 'Claim',
          to: 'Account',
          via: { kind: 'fk', field: 'nope' },
          cardinality: 'one',
          required: false,
        },
      ],
    });
    expect(problems.map((p) => p.message).join(' ')).toContain('nope');
  });
});

describe('the adapter enforces integrity, never policy', () => {
  it('refuses an action naming a row that does not exist', async () => {
    const env = adapter();
    const result = await env.executeAction('fileClaim', {
      accountId: 'ACC-NOPE',
      itemId: 'ITM-1',
      amount: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('allows a claim against an item belonging to a different account', async () => {
    // If the environment blocked this, RigorRun would have nothing to catch.
    const env = adapter();
    const result = await env.executeAction('fileClaim', {
      accountId: 'ACC-2',
      itemId: 'ITM-1',
      amount: 10,
    });
    expect(result.ok).toBe(true);
  });

  it('allows a claim with no permit at any amount', async () => {
    const env = adapter();
    expect(
      (await env.executeAction('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 5000 }))
        .ok,
    ).toBe(true);
  });

  it('refuses a wrongly typed parameter', async () => {
    const env = adapter();
    const result = await env.executeAction('fileClaim', {
      accountId: 'ACC-1',
      itemId: 'ITM-1',
      amount: 'lots',
    });
    expect(result.error?.code).toBe('BAD_PARAM_TYPE');
  });
});

describe('snapshot and restore', () => {
  it('round-trips exactly', async () => {
    const env = adapter();
    const before = await env.snapshot();
    await env.executeAction('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 });
    expect(Object.keys((await env.getState()).entities['Claim'] ?? {})).toHaveLength(1);
    await env.restore(before);
    expect(Object.keys((await env.getState()).entities['Claim'] ?? {})).toHaveLength(0);
    expect(await env.getEvents()).toEqual([]);
  });
});

describe('state delta', () => {
  it('reports a created row, a field change and a link, and nothing else', async () => {
    const env = adapter();
    const seed = await env.getState();
    await env.executeAction('requestPermit', { itemId: 'ITM-1' });
    await env.executeAction('fileClaim', {
      accountId: 'ACC-1',
      itemId: 'ITM-1',
      amount: 30,
      permitId: 'PRM-9001',
    });
    const final = await env.getState();

    const deltas = diffStates(TEST_SCHEMA, seed, final);
    const kinds = deltas.map((delta) => `${delta.kind}:${delta.entity}`);
    expect(kinds).toEqual(['entity_created:Claim', 'entity_created:Permit']);
  });

  it('separates a relationship being set from an ordinary field change', async () => {
    const seed: CanonicalState = {
      entities: {
        Account: {},
        Item: {},
        Permit: { 'PRM-1': { permitId: 'PRM-1', itemId: 'ITM-1', approver: null, state: 'pending' } },
        Claim: {},
        LogEntry: {},
      },
    };
    const final: CanonicalState = {
      entities: {
        ...seed.entities,
        Permit: {
          'PRM-1': { permitId: 'PRM-1', itemId: 'ITM-2', approver: 'a', state: 'granted' },
        },
      },
    };
    const deltas = diffStates(TEST_SCHEMA, seed, final);
    expect(deltas.map((d) => d.kind).sort()).toEqual([
      'field_changed',
      'field_changed',
      'relationship_set',
    ]);
  });

  it('is byte-identical for the same inputs', async () => {
    const run = async () => {
      const env = adapter();
      const seed = await env.getState();
      await env.executeAction('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 });
      return JSON.stringify(diffStates(TEST_SCHEMA, seed, await env.getState()));
    };
    expect(await run()).toBe(await run());
  });
});

describe('the generic projection', () => {
  async function project() {
    const env = adapter();
    const seed = await env.getState();
    await env.executeAction('requestPermit', { itemId: 'ITM-1' });
    await env.executeAction('fileClaim', {
      accountId: 'ACC-2',
      itemId: 'ITM-1',
      amount: 30,
      permitId: 'PRM-9001',
    });
    await env.executeAction('writeLog', { action: 'filed', detail: 'claim CLM-9001 filed' });
    return buildProjection(TEST_SCHEMA, {
      seed,
      final: await env.getState(),
      events: await env.getEvents(),
      knownEventTypes: env.getActions().map((action) => action.name),
    });
  }

  it('lists rows created during the work', async () => {
    const { derived } = await project();
    expect(derived.created['Claim']).toHaveLength(1);
    expect(derived.created['Permit']).toHaveLength(1);
  });

  it('hoists a related row onto the row that names it', async () => {
    const { derived } = await project();
    const claim = derived.created['Claim']?.[0];
    expect(claim?.['item__state']).toBe('active');
    expect(claim?.['permit__state']).toBe('granted');
    expect(claim?.['permit__exists']).toBe(true);
  });

  it('reaches two hops, which is what "the item belongs to a premium account" needs', async () => {
    const { derived } = await project();
    expect(derived.created['Claim']?.[0]?.['item__account__tier']).toBe('standard');
  });

  it('reports the related row as it was at seed time, not only as it is now', async () => {
    const { derived } = await project();
    // The permit did not exist when work began, so its seed view is empty.
    expect(derived.created['Claim']?.[0]?.['seed__permit__exists']).toBe(false);
    expect(derived.created['Claim']?.[0]?.['seed__item__state']).toBe('active');
  });

  it('computes agreement between two paths that reach the same kind of thing', async () => {
    const { derived } = await project();
    const claim = derived.created['Claim']?.[0];
    // The claim names ACC-2 but the item belongs to ACC-1. No hand-written
    // "ownedByClaimAccount" field exists anywhere; this is derived from the
    // declared relationships alone.
    expect(claim?.['agrees__accountId__vs__item__accountId']).toBe(false);
  });

  it('never compares a foreign key with the id it resolves to', async () => {
    const { keys } = await project();
    const trivial = (keys.rowFields['Claim'] ?? []).filter((name) =>
      /^agrees__itemId__vs__item__itemId$/.test(name),
    );
    expect(trivial).toEqual([]);
  });

  it('answers whether an append-only entry references what was created', async () => {
    const { derived } = await project();
    expect(derived.refs['LogEntry__Claim']).toBe(true);
  });

  it('does not report a reference when only a longer id matches', async () => {
    const env = adapter();
    const seed = await env.getState();
    await env.executeAction('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 });
    // CLM-9001 exists; the log mentions CLM-90010, which is a different row.
    await env.executeAction('writeLog', { action: 'filed', detail: 'claim CLM-90010 filed' });
    const { derived } = buildProjection(TEST_SCHEMA, {
      seed,
      final: await env.getState(),
      events: await env.getEvents(),
    });
    expect(derived.refs['LogEntry__Claim']).toBe(false);
  });

  it('publishes event ordinals so ordering is a numeric comparison', async () => {
    const { derived } = await project();
    expect(derived.events.occurred['requestPermit']).toBe(true);
    expect(derived.events.firstOrdinalOf['requestPermit']).toBeLessThan(
      derived.events.firstOrdinalOf['fileClaim'] ?? 0,
    );
    expect(derived.events.firstOrdinalOf['getItem']).toBe(-1);
  });

  it('counts rows and buckets small enums', async () => {
    const { derived } = await project();
    expect(derived.count['Claim']?.created).toBe(1);
    expect(derived.count['Permit']?.by['state']?.['granted']).toBe(1);
  });

  it('produces identical keys on repeated runs', async () => {
    const a = await project();
    const b = await project();
    expect(JSON.stringify(a.keys)).toBe(JSON.stringify(b.keys));
    expect(JSON.stringify(a.derived)).toBe(JSON.stringify(b.derived));
  });

  it('stays well inside the key budget on a five-entity schema', async () => {
    const { keys } = await project();
    expect(keys.truncated).toBe(false);
    expect(keys.keyCount).toBeLessThan(400);
  });
});

describe('projection path validation', () => {
  it('accepts a path the projection can answer', async () => {
    const env = adapter();
    const seed = await env.getState();
    await env.executeAction('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 });
    const { keys } = buildProjection(TEST_SCHEMA, { seed, final: await env.getState() });
    expect(validateProjectionPath(keys, 'derived.created.Claim[amount>50]')).toBeNull();
    expect(validateProjectionPath(keys, 'derived.created.Claim.length')).toBeNull();
  });

  it('rejects a path with a misspelled field instead of letting it pass forever', async () => {
    const env = adapter();
    const seed = await env.getState();
    await env.executeAction('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 });
    const { keys } = buildProjection(TEST_SCHEMA, { seed, final: await env.getState() });
    expect(validateProjectionPath(keys, 'derived.created.Claim[amonut>50]')).toContain('amonut');
    expect(validateProjectionPath(keys, 'derived.created.Nope')).toContain('Nope');
  });
});

describe('the conformance kit', () => {
  it('passes the environment it ships with', async () => {
    const problems = await validateAdapter(
      () => testEnvironment.create(),
      testEnvironment.fixtures,
      {
        probe: [
          { action: 'requestPermit', args: { itemId: 'ITM-1' } },
          { action: 'fileClaim', args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 } },
        ],
      },
    );
    expect(problems).toEqual([]);
  });

  it('catches a fixture that violates its own schema', async () => {
    const problems = await validateAdapter(() => testEnvironment.create(), [
      {
        ...TEST_FIXTURE,
        state: {
          entities: {
            ...TEST_FIXTURE.state.entities,
            Item: {
              'ITM-9': { itemId: 'ITM-9', accountId: 'ACC-NOPE', value: 1, state: 'unheard-of' },
            },
          },
        },
      },
    ]);
    const messages = problems.map((problem) => problem.message).join(' ');
    expect(messages).toContain('not a declared enum value');
    expect(messages).toContain('does not exist');
  });
});
