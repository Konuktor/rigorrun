/**
 * Audit N-1: `state_change` holds a record to the change the demonstration
 * made — and says when one demonstration cannot tell what that change means
 * from where this case started.
 */
import { describe, expect, it } from 'vitest';
import { AssertionSchema, type Assertion, type Observation } from '@rigorrun/core';
import { evaluateAssertion, verify } from '@rigorrun/verifier';

type Row = Record<string, unknown>;

const observation = (start: Row[], now: Row[], created: Row[] = []): Observation => ({
  state: {},
  derived: { seed: { Line: start }, all: { Line: now }, created: { Line: created } },
  events: [],
});

const change = (expected: Record<string, unknown>, target = 'derived.all.Line[label="(none)"]'): Assertion =>
  AssertionSchema.parse({ id: 'success__as_demonstrated__1', kind: 'state_change', description: 'as demonstrated', target, expected });

const changed = (compare: string, from: unknown, to: unknown, field = 'units') =>
  change({ seed: 'derived.seed.Line[label="(none)"]', field, from, to, compare });

const line = (units: unknown, label = '(none)'): Row => ({ label, units });

describe('the case starts where the demonstration started', () => {
  it('passes the demonstrated change', () => {
    expect(evaluateAssertion(changed('quantity', 0, 10), observation([line(0)], [line(10)])).status).toBe('PASS');
  });

  it('fails a quantity that changed by a different amount, and says both', () => {
    const result = evaluateAssertion(changed('quantity', 0, 10), observation([line(0)], [line(20)]));
    expect(result.status).toBe('FAIL');
    expect(result.message).toContain('+10');
    expect(result.message).toContain('+20');
  });

  it('fails a closed value that ended somewhere else', () => {
    const result = evaluateAssertion(changed('closed', 'open', 'closed', 'state'), observation([{ label: '(none)', state: 'open' }], [{ label: '(none)', state: 'held' }]));
    expect(result.status).toBe('FAIL');
  });

  it('cannot judge a free string that differs, and does not pass it', () => {
    const result = evaluateAssertion(changed('open', '0 u', '3 u', 'total'), observation([{ label: '(none)', total: '0 u' }], [{ label: '(none)', total: '6 u' }]));
    expect(result.status).toBe('UNVERIFIABLE');
  });

  it('compares numbers after rounding, as the projection does', () => {
    expect(evaluateAssertion(changed('quantity', 0.1, 0.3), observation([line(0.1)], [line(0.1 + 0.2)])).status).toBe('PASS');
  });
});

describe('the case starts somewhere else', () => {
  it('cannot tell "add 10" from "set to 10" when the result is one of them', () => {
    expect(evaluateAssertion(changed('quantity', 0, 10), observation([line(5)], [line(15)])).status).toBe('UNVERIFIABLE');
    expect(evaluateAssertion(changed('quantity', 0, 10), observation([line(5)], [line(10)])).status).toBe('UNVERIFIABLE');
  });

  it('fails a result that neither reading allows', () => {
    expect(evaluateAssertion(changed('quantity', 0, 10), observation([line(5)], [line(25)])).status).toBe('FAIL');
  });

  it('passes a closed value that reached the demonstrated one, and cannot judge any other', () => {
    const start = [{ label: '(none)', state: 'pending' }];
    expect(evaluateAssertion(changed('closed', 'open', 'closed', 'state'), observation(start, [{ label: '(none)', state: 'closed' }])).status).toBe('PASS');
    expect(evaluateAssertion(changed('closed', 'open', 'closed', 'state'), observation(start, [{ label: '(none)', state: 'held' }])).status).toBe('UNVERIFIABLE');
  });
});

describe('the record itself', () => {
  it('fails when the record the demonstration changed is gone', () => {
    expect(evaluateAssertion(changed('quantity', 0, 10), observation([line(0)], [])).status).toBe('FAIL');
  });

  it('cannot judge when the identity matches more than one record', () => {
    expect(evaluateAssertion(changed('quantity', 0, 10), observation([line(0)], [line(10), line(10)])).status).toBe('UNVERIFIABLE');
  });

  it('holds a created record to its demonstrated value', () => {
    const created = change({ seed: null, field: 'units', to: 4, compare: 'quantity' }, 'derived.created.Line');
    expect(evaluateAssertion(created, observation([], [line(4)], [line(4)])).status).toBe('PASS');
    expect(evaluateAssertion(created, observation([], [line(8)], [line(8)])).status).toBe('FAIL');
    expect(evaluateAssertion(created, observation([], [], [])).status).toBe('FAIL');
  });

  it('never attributes a change it has no identity for', () => {
    const unattributable = change({ compare: 'unattributable', reason: 'no field identifies a Line' }, 'derived.created.Line');
    const result = evaluateAssertion(unattributable, observation([], [line(10)], [line(10)]));
    expect(result.status).toBe('UNVERIFIABLE');
    expect(result.message).toContain('no field identifies a Line');
  });
});

describe('a verdict built on it', () => {
  it('counts an unverifiable change as blocking, so the case abstains rather than passes', () => {
    const summary = verify([changed('quantity', 0, 10)], observation([line(5)], [line(15)]));
    expect(summary.blockingUnverifiable).toBe(1);
  });
});

describe('a field the job leaves set, with a value somebody typed', () => {
  const populated = () =>
    change({ seed: 'derived.seed.Line[label="(none)"]', field: 'approver', from: null, compare: 'populated' });
  const row = (approver: unknown): Row => ({ label: '(none)', approver });

  it('passes whatever value it was set to, because the value was never the system’s to decide', () => {
    expect(evaluateAssertion(populated(), observation([row(null)], [row('Duty manager')])).status).toBe('PASS');
  });

  it('fails when it was left unset — the sign-off nobody recorded', () => {
    const result = evaluateAssertion(populated(), observation([row(null)], [row(null)]));
    expect(result.status).toBe('FAIL');
    expect(result.message).toMatch(/left unset/);
    expect(evaluateAssertion(populated(), observation([row(null)], [row('  ')])).status).toBe('FAIL');
  });

  it('passes a case that started with it already set and kept it', () => {
    expect(evaluateAssertion(populated(), observation([row('Earlier')], [row('Earlier')])).status).toBe('PASS');
  });
});
