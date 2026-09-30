/**
 * A failed check reads as a sentence, and a path the sentence cannot describe
 * keeps its path.
 */
import { describe, expect, it } from 'vitest';
import { evaluateAssertion } from '../src/evaluate.ts';
import { plainTarget } from '../src/plain.ts';
import type { Assertion, Observation } from '@rigorrun/core';

const observation = {
  initialState: {},
  finalState: {},
  events: [],
  derived: {
    all: { Refund: [{ customerId: 'C-1' }, { customerId: 'C-1' }, { customerId: 'C-1' }] },
    created: { Refund: [{ amount: 82, approval__exists: false }] },
    events: { occurred: { createRefund: true }, orderOk: { createRefund__before__addNote: false } },
  },
} as unknown as Observation;

const check = (over: Partial<Assertion>): Assertion =>
  ({ id: 'a', kind: 'state_equals', description: 'd', target: '', severity: 'major', ...over }) as Assertion;

const message = (over: Partial<Assertion>) => evaluateAssertion(check(over), observation).message;

describe('failed checks in words', () => {
  it('counts records, with the filter as written', () => {
    expect(message({ kind: 'numeric_lte', target: 'derived.all.Refund[customerId=C-1].length', expected: 1 })).toBe(
      '3 Refund records where customerId is C-1; at most 1 allowed',
    );
    expect(message({ kind: 'state_equals', target: 'derived.created.Refund.length', expected: 0 })).toBe(
      '1 new Refund record; expected 0',
    );
  });

  it('says a record exists that must not, and names a missing link as missing', () => {
    expect(
      message({ kind: 'state_not_exists', target: 'derived.created.Refund[amount>50 & approval__exists!=true]' }),
    ).toBe('a new Refund record where amount is above 50 and with no approval exists; there must be none');
  });

  it('says an action happened, or happened out of order', () => {
    expect(message({ kind: 'state_equals', target: 'derived.events.occurred.createRefund', expected: false })).toBe(
      '"createRefund" happened; it should not have',
    );
    expect(
      message({ kind: 'state_equals', target: 'derived.events.orderOk.createRefund__before__addNote', expected: true }),
    ).toBe('"createRefund" did not happen before "addNote"');
  });

  it('reads a long hostile order target in linear time', () => {
    const hostile = `derived.events.orderOk.-__before__${'-__before__'.repeat(20_000)}!`;
    const started = performance.now();
    expect(plainTarget(hostile)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(200);
    expect(plainTarget('derived.events.orderOk.a__before__b')).toEqual({ kind: 'order', first: 'a', second: 'b' });
  });

  it('keeps the path for anything it does not recognise', () => {
    expect(plainTarget('state.Refund[0].amount')).toBeUndefined();
    expect(plainTarget('derived.all.Refund[a=1][b=2].length')).toBeUndefined();
    expect(message({ kind: 'numeric_lte', target: 'derived.count.Refund', expected: 1 })).toMatch(/^derived\.count\.Refund/);
  });
});
