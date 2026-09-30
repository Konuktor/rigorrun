/**
 * Rows out of payloads, through the same rewrite induction uses.
 */
import { describe, expect, it } from 'vitest';
import { recordKey, type EntitySchema, type EnvironmentSchema } from '@rigorrun/environment';
import { IdentityConflictError, rowsFromPayload, stateFromPayloads } from '../src/index.ts';

const ROW: EntitySchema = {
  name: 'Row',
  idField: 'id',
  fields: [
    { name: 'id', type: 'number', nullable: false, role: 'identifier' },
    { name: 'title', type: 'string', nullable: false, role: 'freetext' },
    { name: 'status', type: 'enum', nullable: false, role: 'status', enumValues: ['done', 'open'] },
    { name: 'amount', type: 'number', nullable: false, role: 'quantity', unit: 'count', precision: 0.1 },
    { name: 'owner', type: 'string', nullable: false, role: 'actor' },
  ],
  mutable: true,
  appendOnly: false,
};

const cell = (kind: string, value: unknown) => ({ kind, value });
const TABLE = {
  rows: [
    { columns: { amount: cell('Real', 120.5), id: cell('Integer', 1), owner: cell('Text', 'ada'), status: cell('Text', 'open'), title: cell('Text', 'Prepare invoice') } },
    { columns: { amount: cell('Real', 80), id: cell('Integer', 2), owner: cell('Text', 'bo'), status: cell('Text', 'open'), title: cell('Text', 'Review contract') } },
  ],
  rows_changed: 0,
};

describe('rowsFromPayload', () => {
  it('finds rows behind tagged cells and a uniform wrapper', () => {
    expect(rowsFromPayload(TABLE, ROW)).toEqual([
      { id: 1, title: 'Prepare invoice', status: 'open', amount: 120.5, owner: 'ada' },
      { id: 2, title: 'Review contract', status: 'open', amount: 80, owner: 'bo' },
    ]);
  });

  it('still finds plain rows', () => {
    expect(rowsFromPayload({ rows: [{ id: 3, title: 'x', status: 'done', amount: 0, owner: 'ada' }] }, ROW)).toHaveLength(1);
  });

  it('keys state by the row identifier, not by cell values', () => {
    const schema: EnvironmentSchema = { entities: [ROW], relationships: [] };
    const state = stateFromPayloads([TABLE], schema);
    expect(Object.keys(state.entities['Row'] ?? {}).sort()).toEqual(['1', '2']);
  });
});

/**
 * Audit N-1: one canonical record key. A row is stored under its identity —
 * one field, several fields, or (with no identity) its own content — and no
 * observed row silently disappears.
 */
describe('record keys', () => {
  const entity = (over: Partial<EntitySchema> & Record<string, unknown>, fields: string[]): EntitySchema =>
    ({
      name: 'Cell',
      idField: fields[0]!,
      fields: fields.map((name) => ({ name, type: 'string', nullable: true, role: 'freetext' })),
      mutable: true,
      appendOnly: false,
      ...over,
    }) as EntitySchema;
  const schemaOf = (e: EntitySchema): EnvironmentSchema => ({ entities: [e], relationships: [] });

  it('keys a row by several fields together, so rows sharing one of them stay apart', () => {
    const cell = entity({ keyFields: ['owner', 'area'] }, ['owner', 'area', 'units']);
    const rows = [{ owner: 'ann', area: 'north', units: 3 }, { owner: 'ann', area: 'south', units: 0 }, { owner: 'bo', area: 'north', units: 8 }];
    const table = stateFromPayloads([{ cells: rows }], schemaOf(cell)).entities['Cell'] ?? {};
    expect(Object.keys(table)).toHaveLength(3);
    expect(Object.keys(table).sort()).toEqual(rows.map((row) => recordKey(cell, row)).sort());
  });

  it('keeps a row whose identity is null', () => {
    const slot = entity({ name: 'Slot', keyFields: ['ref'] }, ['ref', 'units']);
    const rows = [{ ref: null, units: 0 }, { ref: 'x1', units: 4 }];
    expect(Object.keys(stateFromPayloads([{ slots: rows }], schemaOf(slot)).entities['Slot'] ?? {})).toHaveLength(2);
  });

  it('with no identity, keeps two identical rows as two', () => {
    const tally = entity({ name: 'Tally', identity: 'unestablished' }, ['tag', 'units']);
    const rows = [{ tag: 'a', units: 5 }, { tag: 'a', units: 5 }, { tag: 'b', units: 5 }];
    expect(Object.keys(stateFromPayloads([{ tallies: rows }], schemaOf(tally)).entities['Tally'] ?? {})).toHaveLength(3);
  });

  it('refuses two different rows that claim one identity in one answer', () => {
    const schema: EnvironmentSchema = { entities: [ROW], relationships: [] };
    const rows = [
      { id: 1, title: 'Prepare invoice', status: 'open', amount: 1, owner: 'ada' },
      { id: 1, title: 'Prepare invoice', status: 'done', amount: 1, owner: 'ada' },
    ];
    expect(() => stateFromPayloads([{ rows }], schema)).toThrow(IdentityConflictError);
  });

  it('merges a partial copy of the same record rather than refusing it', () => {
    const schema: EnvironmentSchema = { entities: [ROW], relationships: [] };
    const payload = {
      rows: [{ id: 1, title: 'Prepare invoice', status: 'open', amount: 1, owner: 'ada' }],
      current: { id: 1, title: 'Prepare invoice', status: 'open' },
    };
    const table = stateFromPayloads([payload], schema).entities['Row'] ?? {};
    expect(Object.values(table)).toEqual([{ id: 1, title: 'Prepare invoice', status: 'open', amount: 1, owner: 'ada' }]);
  });

  it('keeps a single-field key exactly as before', () => {
    expect(recordKey(ROW, { id: 7, title: 'x' })).toBe('7');
  });
});

/**
 * A read that answered with one page of a longer list. What is outside the
 * page is not absent, so the kinds of record it returned are marked windowed
 * and every check on which of them exist is not made (requalification PLAN §147).
 */
describe('a read that returned one page of a longer list', () => {
  const schema: EnvironmentSchema = { entities: [ROW], relationships: [] };
  const row = (id: number) => ({ id, title: 't', status: 'open', amount: 1, owner: 'ada' });

  it('is marked windowed when the answer says there is more', () => {
    expect(stateFromPayloads([{ data: [row(1)], has_more: true }], schema).windowed?.['Row']).toMatch(/has_more/);
    expect(
      stateFromPayloads([{ items: [row(1)], pagination: { next_cursor: 'abc' } }], schema).windowed?.['Row'],
    ).toMatch(/next_cursor/);
    expect(stateFromPayloads([{ results: [row(1)], total: 40 }], schema).windowed?.['Row']).toMatch(/40/);
  });

  it('is marked windowed when a read called with a limit came back full', () => {
    const state = stateFromPayloads([{ rows: [row(1), row(2)] }], schema, [{ tool: 'list_rows', args: { limit: 2 } }]);
    expect(state.windowed?.['Row']).toMatch(/list_rows.*limit/);
  });

  it('leaves a complete answer alone', () => {
    expect(
      stateFromPayloads([{ data: [row(1)], has_more: false, next_cursor: null, total: 1 }], schema).windowed,
    ).toBeUndefined();
    expect(
      stateFromPayloads([{ rows: [row(1)] }], schema, [{ tool: 'list_rows', args: { limit: 2 } }]).windowed,
    ).toBeUndefined();
  });

  it('never reads a record’s own fields as a page marker', () => {
    const ORDER: EntitySchema = {
      name: 'Order',
      idField: 'id',
      fields: [
        { name: 'id', type: 'number', nullable: false, role: 'identifier' },
        { name: 'total', type: 'number', nullable: false, role: 'quantity', unit: 'count', precision: 1 },
        { name: 'next', type: 'string', nullable: true, role: 'freetext' },
      ],
      mutable: true,
      appendOnly: false,
    };
    const orders: EnvironmentSchema = { entities: [ORDER], relationships: [] };
    expect(stateFromPayloads([{ orders: [{ id: 1, total: 500, next: 'ship' }] }], orders).windowed).toBeUndefined();
  });
});
