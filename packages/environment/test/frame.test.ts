/**
 * Audit IO-5: what a job changed, for every kind of record, and what two
 * readings with nothing in between prove about the reads themselves.
 */
import { describe, expect, it } from 'vitest';
import {
  demonstratedFrame,
  diffStates,
  frameObservation,
  readStability,
  stateFromRows,
  type EnvironmentSchema,
} from '@rigorrun/environment';

const SCHEMA: EnvironmentSchema = {
  entities: [
    {
      name: 'Entry',
      idField: 'entryId',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'entryId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'size', type: 'number', nullable: false, role: 'quantity', unit: 'count', precision: 1 },
        { name: 'pinned', type: 'boolean', nullable: false, role: 'flag' },
      ],
    },
    {
      name: 'Line',
      idField: 'label',
      identity: 'unestablished',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'label', type: 'string', nullable: false, role: 'freetext' },
        { name: 'units', type: 'number', nullable: false, role: 'quantity', unit: 'count', precision: 1 },
      ],
    },
    {
      name: 'Note',
      idField: 'noteId',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'noteId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'entryId', type: 'string', nullable: true, role: 'identifier' },
      ],
    },
  ],
  relationships: [
    { name: 'entry', from: 'Note', to: 'Entry', via: { kind: 'fk', field: 'entryId' }, cardinality: 'one', required: false },
  ],
};

const entry = (entryId: string, size = 1, pinned = false) => ({ entryId, size, pinned });

describe('readStability', () => {
  it('finds the fields that differ between two readings of the same record', () => {
    const first = stateFromRows(SCHEMA, { Entry: [entry('E1', 1, false)] });
    const second = stateFromRows(SCHEMA, { Entry: [entry('E1', 1, true)] });
    expect(readStability(SCHEMA, first, second)['Entry']).toEqual({ volatileFields: ['pinned'], membershipUnstable: false });
    expect(readStability(SCHEMA, first, second)['Note']).toEqual({ volatileFields: [], membershipUnstable: false });
  });

  it('marks membership unstable when two readings disagree on which records exist', () => {
    const first = stateFromRows(SCHEMA, { Entry: [entry('E1')] });
    const second = stateFromRows(SCHEMA, { Entry: [entry('E1'), entry('E2')] });
    expect(readStability(SCHEMA, first, second)['Entry']).toEqual({ volatileFields: [], membershipUnstable: true });
  });

  it('sees a read-flipped value on a record with no established identity as unstable membership', () => {
    const first = stateFromRows(SCHEMA, { Line: [{ label: 'a', units: 1 }] });
    const second = stateFromRows(SCHEMA, { Line: [{ label: 'a', units: 2 }] });
    expect(readStability(SCHEMA, first, second)['Line']?.membershipUnstable).toBe(true);
  });
});

describe('frameObservation', () => {
  it('summarises created, deleted and changed records for every entity, including relationship fields', () => {
    const before = stateFromRows(SCHEMA, {
      Entry: [entry('E1', 1), entry('E3', 3)],
      Note: [{ noteId: 'N1', entryId: null }],
    });
    const after = stateFromRows(SCHEMA, {
      Entry: [entry('E1', 5), entry('E2', 2)],
      Note: [{ noteId: 'N1', entryId: 'E1' }],
    });
    const stable = readStability(SCHEMA, before, before);
    const flipped = readStability(SCHEMA, after, stateFromRows(SCHEMA, { Entry: [entry('E1', 5, true), entry('E2', 2)], Note: [{ noteId: 'N1', entryId: 'E1' }] }));
    const observed = frameObservation(SCHEMA, diffStates(SCHEMA, before, after), stable, flipped);

    expect(observed.proof).toEqual({ baseline: 'double_read', final: 'double_read' });
    expect(observed.entities['Entry']).toEqual({
      created: ['E2'],
      deleted: ['E3'],
      updated: [{ key: 'E1', fields: ['size'] }],
      volatileFields: ['pinned'],
      membershipUnstable: false,
    });
    expect(observed.entities['Note']).toEqual({
      created: [],
      deleted: [],
      updated: [{ key: 'N1', fields: ['entryId'] }],
      volatileFields: [],
      membershipUnstable: false,
    });
    expect(observed.entities['Line']).toEqual({ created: [], deleted: [], updated: [], volatileFields: [], membershipUnstable: false });
  });

  it('says when the starting world was installed rather than read', () => {
    const world = stateFromRows(SCHEMA, { Entry: [entry('E1')] });
    const observed = frameObservation(SCHEMA, [], 'installed_seed', readStability(SCHEMA, world, world));
    expect(observed.proof.baseline).toBe('installed_seed');
  });
});

describe('demonstratedFrame', () => {
  it('builds the demonstrated frame for every schema entity, touched or not', () => {
    const before = stateFromRows(SCHEMA, { Entry: [entry('E1', 1), entry('E3', 3)], Note: [{ noteId: 'N1', entryId: null }] });
    const after = stateFromRows(SCHEMA, { Entry: [entry('E1', 5), entry('E2', 2)], Note: [{ noteId: 'N1', entryId: 'E1' }] });
    expect(demonstratedFrame(SCHEMA, before, after)).toEqual({
      entities: {
        Entry: { preExistingRows: 2, created: 1, deleted: 1, updatedRows: 1, updatedFields: ['size'], identity: 'named' },
        Line: { preExistingRows: 0, created: 0, deleted: 0, updatedRows: 0, updatedFields: [], identity: 'unestablished' },
        Note: { preExistingRows: 1, created: 0, deleted: 0, updatedRows: 1, updatedFields: ['entryId'], identity: 'named' },
      },
    });
  });

  it('counts a record once however many of its fields changed, and lists the fields', () => {
    const before = stateFromRows(SCHEMA, { Entry: [entry('E1', 1, false), entry('E2', 1, false)] });
    const after = stateFromRows(SCHEMA, { Entry: [entry('E1', 4, true), entry('E2', 1, false)] });
    expect(demonstratedFrame(SCHEMA, before, after).entities['Entry']).toMatchObject({ updatedRows: 1, updatedFields: ['pinned', 'size'] });
  });
});
