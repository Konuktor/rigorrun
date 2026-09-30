/**
 * Audit N-1: which field names a record, decided by structure and by what the
 * demonstration changed — never by a field's name or by "numbers are
 * quantities".
 *
 * Every payload here is labelled with the nominated read it answered and
 * whether it was read before or after the job, the way the daemon labels the
 * demonstration's reads.
 */
import { describe, expect, it } from 'vitest';
import { applySchemaAnswers, induceSchema, type PayloadObservation } from '../src/index.ts';

type Entity = ReturnType<typeof induceSchema>['schema']['entities'][number] & { keyFields?: string[]; identity?: string };

const readings = (before: unknown, after: unknown, read = '0:read'): PayloadObservation[] =>
  [
    { tool: 'before', payload: before, reading: { read, moment: 'before' } },
    { tool: 'after', payload: after, reading: { read, moment: 'after' } },
  ] as PayloadObservation[];

const entityWith = (result: ReturnType<typeof induceSchema>, field: string): Entity =>
  result.schema.entities.find((entity) => entity.fields.some((candidate) => candidate.name === field)) as Entity;

describe('F: a value the job changed is never the identity', () => {
  const before = { lines: [{ ref: null, label: '(none)', units: 0 }, { ref: 'L1', label: 'Lane one', units: 225 }, { ref: 'L2', label: 'Lane two', units: 315 }] };
  const after = { lines: [{ ref: null, label: '(none)', units: 10 }, { ref: 'L1', label: 'Lane one', units: 225 }, { ref: 'L2', label: 'Lane two', units: 315 }] };

  it('names the row by the field that stayed the same, and says why', () => {
    const result = induceSchema(readings(before, after));
    const line = entityWith(result, 'units');
    expect(line.idField).toBe('label');
    expect(line.keyFields).toBeUndefined();
    expect(line.fields.find((field) => field.name === 'units')?.role).toBe('quantity');
    const question = result.questions.find((q) => q.id === `q_id_${line.name}`)!;
    expect(question.proposed).toBe('label');
    expect(question.evidence).toMatch(/units/);
  });

  it('reads a single record the same way across its two readings', () => {
    const result = induceSchema(readings({ span: 'all', total: 12, scope: 'team' }, { span: 'all', total: 16, scope: 'team' }));
    expect(entityWith(result, 'total').idField).not.toBe('total');
  });

  it('without readings, has no change evidence and keeps the earlier choice', () => {
    const result = induceSchema([{ tool: 't', payload: before }, { tool: 't', payload: after }]);
    // Documented, not endorsed: with nothing saying the two answers are the same
    // read, the distinct-value ranking still decides.
    expect(entityWith(result, 'units').idField).toBeDefined();
  });
});

describe('H: a numeric identifier stays an identifier', () => {
  it('keeps `id` when a numeric amount changes', () => {
    const rows = (amount: number) => ({
      items: [
        { id: 1, title: 'Alpha item', amount: 10 },
        { id: 2, title: 'Beta item', amount },
        { id: 3, title: 'Gamma item', amount: 30 },
      ],
    });
    const result = induceSchema(readings(rows(20), rows(25)));
    const item = entityWith(result, 'amount');
    expect(item.idField).toBe('id');
    expect(item.fields.find((field) => field.name === 'id')?.role).toBe('identifier');
  });
});

describe('I: identity is not decided by type', () => {
  it('rejects a changing string and keeps a stable number', () => {
    const rows = (total: string) => ({ counters: [{ code: 7001, total }, { code: 7002, total: '4 u' }, { code: 7003, total: '9 u' }] });
    expect(entityWith(induceSchema(readings(rows('0 u'), rows('3 u'))), 'total').idField).toBe('code');
  });

  it('rejects a changing number and keeps a stable string', () => {
    const rows = (count: number) => ({ tags: [{ tag: 'north-desk', count }, { tag: 'south-desk', count: 4 }, { tag: 'east-desk', count: 9 }] });
    expect(entityWith(induceSchema(readings(rows(0), rows(3))), 'count').idField).toBe('tag');
  });
});

describe('compound and nullable identities', () => {
  it('names a row by several stable dimensions when no single field does', () => {
    const cells = (units: number) => ({
      cells: [{ owner: 'ann', area: 'north', units: 3 }, { owner: 'ann', area: 'south', units }, { owner: 'bo', area: 'north', units: 8 }],
    });
    const cell = entityWith(induceSchema(readings(cells(0), cells(5))), 'units');
    expect([...(cell.keyFields ?? [])].sort()).toEqual(['area', 'owner']);
    expect(cell.keyFields).toContain(cell.idField);
  });

  it('keeps a null dimension as part of the identity', () => {
    const slots = (units: number) => ({ slots: [{ ref: null, units }, { ref: 'x1', units: 4 }, { ref: 'x2', units: 9 }] });
    expect(entityWith(induceSchema(readings(slots(0), slots(3))), 'units').keyFields).toEqual(['ref']);
  });

  it('declares no identity when nothing stable tells rows apart', () => {
    const tallies = (units: number) => ({ tallies: [{ tag: 'a', units }, { tag: 'a', units: 5 }, { tag: 'b', units: 5 }] });
    expect(entityWith(induceSchema(readings(tallies(0), tallies(10))), 'units').identity).toBe('unestablished');
  });

  it('never proposes a link to a record named by several fields', () => {
    const payload = (units: number) => ({
      cells: [{ owner: 'ann', area: 'north', units: 3 }, { owner: 'ann', area: 'south', units }, { owner: 'bo', area: 'north', units: 8 }],
      people: [{ person: 'ann', desk: 'd-1' }, { person: 'bo', desk: 'd-2' }],
    });
    const result = induceSchema(readings(payload(0), payload(5)));
    const cell = entityWith(result, 'units');
    expect(result.schema.relationships.filter((relationship) => relationship.to === cell.name)).toEqual([]);
  });

  it('lets a person override the identity, which clears the induced one', () => {
    const cells = (units: number) => ({
      cells: [{ owner: 'ann', area: 'north', units: 3 }, { owner: 'ann', area: 'south', units }, { owner: 'bo', area: 'north', units: 8 }],
    });
    const induced = induceSchema(readings(cells(0), cells(5)));
    const name = entityWith(induced, 'units').name;
    const { schema } = applySchemaAnswers(induced, [{ questionId: `q_id_${name}`, value: 'area' }]);
    const cell = schema.entities.find((entity) => entity.name === name) as Entity;
    expect(cell.idField).toBe('area');
    expect(cell.keyFields).toBeUndefined();
    expect(cell.identity).toBeUndefined();
  });
});

describe('quantities that add up to a total', () => {
  it('marks the part as a quantity of the total, even when the job only adds a row', () => {
    const report = (extra: { ref: string | null; label: string; units: number }[]) => {
      const rows = [{ ref: 'L1', label: 'Lane one', units: 7 }, { ref: 'L2', label: 'Lane two', units: 5 }, ...extra];
      return { span: 'all', total: rows.reduce((total, row) => total + row.units, 0), lines: rows };
    };
    const result = induceSchema(readings(report([]), report([{ ref: null, label: '(none)', units: 4 }])));
    const line = entityWith(result, 'label');
    expect(line.idField).toBe('label');
    expect(line.fields.find((field) => field.name === 'units')?.totals).toMatch(/\.total$/);
  });

  it('does not mistake a zero total, or a single row, for a sum', () => {
    const result = induceSchema([{ tool: 't', payload: { rows_changed: 0, rows: [{ id: 1, amount: 0 }, { id: 2, amount: 0 }] } }]);
    expect(entityWith(result, 'amount').fields.find((field) => field.name === 'amount')?.totals).toBeUndefined();
  });
});

describe('E: explicit identifiers are unchanged', () => {
  it('keeps an explicit identifier on a created record', () => {
    const notes = (extra: object[]) => ({ notes: [{ noteId: 'N-1', text: 'Kept note', size: 9 }, ...extra] });
    const result = induceSchema(readings(notes([]), notes([{ noteId: 'N-2', text: 'Fresh note', size: 10 }])));
    expect(entityWith(result, 'text').idField).toBe('noteId');
    expect(entityWith(result, 'text').keyFields).toBeUndefined();
  });
});
