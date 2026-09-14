import { describe, expect, it } from 'vitest';
import { resolvePath } from '@rigorrun/verifier';

const world = {
  state: {
    refunds: [
      { id: 'REF-1', orderId: 'ORD-1', amount: 42, approvalId: null, flagged: false },
      { id: 'REF-2', orderId: 'ORD-2', amount: 500, approvalId: 'APR-1', flagged: true },
      { id: 'REF-3', orderId: 'ORD-2', amount: 51, approvalId: null, flagged: true },
    ],
    label: 'northstar',
  },
};

describe('resolvePath', () => {
  it('reads nested properties', () => {
    expect(resolvePath(world, 'state.label')).toEqual({ found: true, value: 'northstar' });
  });

  it('reports missing properties as not found', () => {
    expect(resolvePath(world, 'state.missing').found).toBe(false);
    expect(resolvePath(world, 'state.refunds[0].nope').found).toBe(false);
  });

  it('indexes arrays', () => {
    expect(resolvePath(world, 'state.refunds[1].amount').value).toBe(500);
  });

  it('returns not found for an out-of-range index', () => {
    expect(resolvePath(world, 'state.refunds[9].amount').found).toBe(false);
  });

  it('supports length and its count alias', () => {
    expect(resolvePath(world, 'state.refunds.length').value).toBe(3);
    expect(resolvePath(world, 'state.refunds.count').value).toBe(3);
    expect(resolvePath(world, 'state.label.length').value).toBe(9);
  });

  it('filters by equality', () => {
    const matched = resolvePath(world, 'state.refunds[orderId=ORD-2]').value as unknown[];
    expect(matched).toHaveLength(2);
  });

  it('treats null and a missing value as equal in filters', () => {
    const matched = resolvePath(world, 'state.refunds[approvalId=null]').value as unknown[];
    expect(matched).toHaveLength(2);
  });

  it('filters by inequality', () => {
    const matched = resolvePath(world, 'state.refunds[approvalId!=null]').value as unknown[];
    expect(matched).toHaveLength(1);
  });

  it('filters numerically', () => {
    expect((resolvePath(world, 'state.refunds[amount>50]').value as unknown[]).length).toBe(2);
    expect((resolvePath(world, 'state.refunds[amount<=50]').value as unknown[]).length).toBe(1);
    expect((resolvePath(world, 'state.refunds[amount>=51]').value as unknown[]).length).toBe(2);
  });

  it('filters on booleans', () => {
    expect((resolvePath(world, 'state.refunds[flagged=true]').value as unknown[]).length).toBe(2);
    expect((resolvePath(world, 'state.refunds[flagged=false]').value as unknown[]).length).toBe(1);
  });

  it('combines conditions with &', () => {
    const matched = resolvePath(world, 'state.refunds[amount>50 & approvalId=null]')
      .value as unknown[];
    expect(matched).toHaveLength(1);
    expect((matched[0] as { id: string }).id).toBe('REF-3');
  });

  it('counts filtered matches', () => {
    expect(resolvePath(world, 'state.refunds[orderId=ORD-2].length').value).toBe(2);
  });

  it('reads a property of the first filtered match', () => {
    expect(resolvePath(world, 'state.refunds[orderId=ORD-2].amount').value).toBe(500);
  });

  it('yields an empty list when nothing matches', () => {
    expect(resolvePath(world, 'state.refunds[orderId=ORD-9]').value).toEqual([]);
  });

  it('rejects malformed filters loudly', () => {
    expect(() => resolvePath(world, 'state.refunds[bogus]')).toThrow(/Invalid filter/);
    expect(() => resolvePath(world, 'state.refunds[orderId=ORD-1')).toThrow(/Unterminated/);
  });
});

describe('the count section of a projection', () => {
  it('walks into `derived.count` rather than measuring the object', () => {
    const observation = { derived: { count: { Order: { total: 3, created: 1 } }, created: { Order: [{ id: 'a' }] } } };
    expect(resolvePath(observation, 'derived.count.Order.total')).toEqual({ found: true, value: 3 });
    expect(resolvePath(observation, 'derived.count.Order.created')).toEqual({ found: true, value: 1 });
    expect(resolvePath(observation, 'derived.created.Order.count')).toEqual({ found: true, value: 1 });
    expect(resolvePath(observation, 'derived.created.Order.length')).toEqual({ found: true, value: 1 });
  });
});

describe('quoted values in filters', () => {
  const observation = {
    rows: [
      { title: 'Spring plan', note: 'a & b ] c', code: '007', tags: ['x', 'y'] },
      { title: 'Spring plans', note: 'say "hi"', code: '7', tags: ['z'] },
      { title: 'Autumn', note: '', code: 7, tags: [] },
    ],
  };
  const titles = (path: string) =>
    ((resolvePath(observation, path).value as { title: string }[]) ?? []).map((row) => row.title);

  it('matches a quoted string with a space exactly, not as a prefix', () => {
    expect(titles('rows[title="Spring plan"]')).toEqual(['Spring plan']);
  });

  it('keeps & and ] inside a quoted value from ending the clause or the filter', () => {
    expect(titles('rows[note="a & b ] c"]')).toEqual(['Spring plan']);
    expect(resolvePath(observation, 'rows[note="a & b ] c"].length')).toEqual({ found: true, value: 1 });
  });

  it('reads escaped quotes inside a value', () => {
    expect(titles(`rows[note=${JSON.stringify('say "hi"')}]`)).toEqual(['Spring plans']);
  });

  it('keeps a quoted number-like value a string', () => {
    expect(titles('rows[code="007"]')).toEqual(['Spring plan']);
    expect(titles('rows[code=7]')).toEqual(['Autumn']);
    expect(titles('rows[code="7"]')).toEqual(['Spring plans']);
  });

  it('tests containment with ~= on strings and on lists', () => {
    expect(titles('rows[note~="b ] c"]')).toEqual(['Spring plan']);
    expect(titles('rows[title~="Spring"]')).toEqual(['Spring plan', 'Spring plans']);
    expect(titles('rows[tags~=y]')).toEqual(['Spring plan']);
    expect(titles('rows[code~="0"]')).toEqual(['Spring plan']);
  });

  it('does not let a hostile value smuggle in a clause that would match something else', () => {
    expect(titles(`rows[note=${JSON.stringify('x] & title=Spring plan & [y')}]`)).toEqual([]);
    expect(titles(`rows[note!=${JSON.stringify('x] & title=Autumn & [y')}]`)).toEqual(['Spring plan', 'Spring plans', 'Autumn']);
  });
});
