/**
 * Rows out of payloads, through the same rewrite induction uses.
 */
import { describe, expect, it } from 'vitest';
import type { EntitySchema, EnvironmentSchema } from '@rigorrun/environment';
import { rowsFromPayload, stateFromPayloads } from '../src/index.ts';

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
