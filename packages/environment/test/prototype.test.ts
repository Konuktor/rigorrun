/**
 * A record id is data, even when it is "__proto__".
 *
 * RigorRun reads records from systems it does not control — including servers
 * it is auditing because nobody trusts them. A table keyed by record id that is
 * written with `table[key] = row` turns an id of "__proto__" into a write to the
 * table's prototype, and from there possibly to every object's. The id must land
 * as an ordinary own entry, and nothing else may change.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defineEnvironment, stateFromRows, type EnvironmentSchema } from '../src/index.ts';

const SCHEMA: EnvironmentSchema = {
  entities: [
    {
      name: 'Item',
      idField: 'itemId',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'itemId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'polluted', type: 'boolean', nullable: true, role: 'flag' },
      ],
    },
  ],
  relationships: [],
};

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>)['polluted'];
});

describe('a record whose id is __proto__', () => {
  it('is an ordinary own entry when a state is built from rows', () => {
    const state = stateFromRows(SCHEMA, { Item: [{ itemId: '__proto__', polluted: true }] });
    const table = state.entities['Item']!;
    expect(Object.keys(table)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(table)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('is an ordinary own entry when an in-memory environment inserts it', async () => {
    const environment = defineEnvironment({
      id: 'proto',
      name: 'proto',
      description: '',
      schema: SCHEMA,
      presentation: { label: 'proto', tagline: '', accent: '#334155', mark: 'P', navEntities: ['Item'], focusEntity: 'Item' },
      fixtures: [],
      actions: [
        {
          name: 'add',
          description: 'add',
          readOnly: false,
          mutates: ['Item'],
          enforcement: 'none',
          params: [],
          handle: (_args, ctx) => {
            ctx.insert('Item', { itemId: '__proto__', polluted: true });
            return { ok: true };
          },
        },
      ],
    }).create();
    await environment.executeAction('add', {});
    const state = await environment.getState();
    expect(Object.keys(state.entities['Item'] ?? {})).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
