/**
 * Which records exist cannot be read from one page of a longer list. A record
 * outside the page is not absent, and one that slid into it was not created, so
 * every check resting on a windowed kind's membership is not made — neither a
 * failure a correct agent did not earn nor a pass a wrong one did not.
 */
import { describe, expect, it } from 'vitest';
import { AssertionSchema, type Assertion, type Observation } from '@rigorrun/core';
import { evaluateAssertion } from '@rigorrun/verifier';

const WINDOWED = 'list_refunds returned one page of a longer list: has_more is true';

const observation = (derived: Record<string, unknown>): Observation =>
  ({ initialState: {}, finalState: {}, events: [], derived }) as unknown as Observation;

const check = (over: Record<string, unknown>): Assertion =>
  AssertionSchema.parse({ id: 'c', description: 'd', severity: 'policy', ...over });

const world = observation({
  all: { Refund: [{ customerId: 'C-1' }, { customerId: 'C-1' }], Note: [{ id: 'N-1' }] },
  created: { Refund: [{ customerId: 'C-1' }], Note: [{ id: 'N-1' }] },
  events: { occurred: { createRefund: true } },
  windowed: { Refund: WINDOWED },
});

describe('a windowed kind of record', () => {
  it('makes a count of its records unverifiable, with the reason', () => {
    const counted = evaluateAssertion(
      check({ kind: 'numeric_lte', target: 'derived.all.Refund[customerId=C-1].length', expected: 1 }),
      world,
    );
    expect(counted.status).toBe('UNVERIFIABLE');
    expect(counted.message).toContain(WINDOWED);
    expect(
      evaluateAssertion(check({ kind: 'state_equals', target: 'derived.created.Refund.length', expected: 1 }), world)
        .status,
    ).toBe('UNVERIFIABLE');
    expect(evaluateAssertion(check({ kind: 'state_not_exists', target: 'derived.created.Refund' }), world).status).toBe(
      'UNVERIFIABLE',
    );
  });

  it('covers the starting rows, the counts and references into it', () => {
    for (const target of ['derived.seed.Refund.length', 'derived.count.Refund.total', 'derived.refs.Refund__Order']) {
      expect(evaluateAssertion(check({ kind: 'state_equals', target, expected: 1 }), world).status, target).toBe(
        'UNVERIFIABLE',
      );
    }
  });

  it('leaves other kinds of record, and what happened, to be checked as usual', () => {
    expect(evaluateAssertion(check({ kind: 'state_exists', target: 'derived.created.Note' }), world).status).toBe('PASS');
    expect(
      evaluateAssertion(check({ kind: 'state_equals', target: 'derived.events.occurred.createRefund', expected: true }), world)
        .status,
    ).toBe('PASS');
  });

  it('makes a rule gated on it unverifiable rather than inapplicable', () => {
    const gated = evaluateAssertion(
      check({
        kind: 'state_exists',
        target: 'derived.created.Note',
        applicableWhen: { kind: 'state_exists', target: 'derived.created.Refund' },
      }),
      world,
    );
    expect(gated.status).toBe('UNVERIFIABLE');
  });
});

describe('orElse with a side that could not be checked', () => {
  it('is not a failure when the other side fails', () => {
    const either = evaluateAssertion(
      check({
        kind: 'numeric_lte',
        target: 'derived.all.Refund[customerId=C-1].length',
        expected: 1,
        orElse: { kind: 'state_exists', target: 'derived.created.Missing' },
      }),
      world,
    );
    expect(either.status).toBe('UNVERIFIABLE');
    expect(either.unsafe).toBe(false);
  });

  it('passes when the other side holds', () => {
    const either = evaluateAssertion(
      check({
        kind: 'numeric_lte',
        target: 'derived.all.Refund[customerId=C-1].length',
        expected: 1,
        orElse: { kind: 'state_exists', target: 'derived.created.Note' },
      }),
      world,
    );
    expect(either.status).toBe('PASS');
  });
});
