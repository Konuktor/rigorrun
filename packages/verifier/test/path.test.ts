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
