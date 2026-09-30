/**
 * Audit IO-5: `state_frame` holds every kind of record to what the
 * demonstration changed. A change outside it fails; a field is set aside only
 * when two readings with nothing in between prove the reads change it; and what
 * the evidence cannot settle is not checked, never passed.
 */
import { describe, expect, it } from 'vitest';
import { AssertionSchema, type Assertion, type Observation } from '@rigorrun/core';
import { evaluateAssertion, verify } from '@rigorrun/verifier';

interface Bound {
  preExistingRows: number;
  created: number;
  deleted: number;
  updatedRows: number;
  updatedFields: string[];
  identity: 'named' | 'unestablished';
}

interface Seen {
  created: string[];
  deleted: string[];
  updated: { key: string; fields: string[] }[];
  volatileFields: string[];
  membershipUnstable: boolean;
  windowed?: boolean;
}

const bound = (over: Partial<Bound> = {}): Bound => ({
  preExistingRows: 2,
  created: 0,
  deleted: 0,
  updatedRows: 0,
  updatedFields: [],
  identity: 'named',
  ...over,
});

const seen = (over: Partial<Seen> = {}): Seen => ({
  created: [],
  deleted: [],
  updated: [],
  volatileFields: [],
  membershipUnstable: false,
  ...over,
});

const frame = (entities: Record<string, Bound>, mode: 'performed' | 'declined' = 'performed', focusEntity = 'Entry'): Assertion =>
  AssertionSchema.parse({
    id: 'frame__nothing_else_changed',
    kind: 'state_frame',
    description: 'nothing changed beyond what the demonstration changed',
    target: 'derived.frame',
    severity: 'invariant',
    failureSeverity: 'MAJOR',
    expected: { mode, focusEntity, entities },
  });

const observed = (entities: Record<string, Seen>): Observation => ({
  state: {},
  derived: { frame: { proof: { baseline: 'double_read', final: 'double_read' }, entities } },
  events: [],
});

type Detail = {
  violations: { entity: string; kind: string; key?: string; field?: string; observed: unknown; allowed: unknown }[];
  unverifiable: { entity: string; kind: string; id: string }[];
  excludedVolatile: Record<string, string[]>;
};

const detail = (result: ReturnType<typeof evaluateAssertion>) => result.observed as Detail;

describe('changes inside and outside the demonstrated frame', () => {
  it('passes changes inside the frame', () => {
    const result = evaluateAssertion(
      frame({ Entry: bound({ created: 1, updatedRows: 1, updatedFields: ['size'] }) }),
      observed({ Entry: seen({ created: ['E9'], updated: [{ key: 'E1', fields: ['size'] }] }) }),
    );
    expect(result.status).toBe('PASS');
  });

  it('fails more records created than demonstrated', () => {
    const result = evaluateAssertion(frame({ Entry: bound({ created: 1 }) }), observed({ Entry: seen({ created: ['E8', 'E9'] }) }));
    expect(result.status).toBe('FAIL');
    expect(detail(result).violations).toContainEqual({ entity: 'Entry', kind: 'created', observed: 2, allowed: 1 });
  });

  it('fails more records deleted than demonstrated', () => {
    const result = evaluateAssertion(frame({ Entry: bound() }), observed({ Entry: seen({ deleted: ['E1'] }) }));
    expect(result.status).toBe('FAIL');
    expect(detail(result).violations).toContainEqual({ entity: 'Entry', kind: 'deleted', observed: 1, allowed: 0 });
  });

  it('fails more existing records changed than demonstrated', () => {
    const result = evaluateAssertion(
      frame({ Entry: bound({ updatedRows: 1, updatedFields: ['size'] }) }),
      observed({ Entry: seen({ updated: [{ key: 'E1', fields: ['size'] }, { key: 'E2', fields: ['size'] }] }) }),
    );
    expect(result.status).toBe('FAIL');
    expect(detail(result).violations).toContainEqual({ entity: 'Entry', kind: 'updated_rows', observed: 2, allowed: 1 });
  });

  it('fails a field the demonstration never changed, naming the record type, the record and the field', () => {
    const result = evaluateAssertion(
      frame({ Entry: bound({ created: 1 }), Task: bound() }),
      observed({ Entry: seen({ created: ['E9'] }), Task: seen({ updated: [{ key: 'T-2', fields: ['status'] }] }) }),
    );
    expect(result.status).toBe('FAIL');
    expect(detail(result).violations).toContainEqual({ entity: 'Task', kind: 'updated_field', key: 'T-2', field: 'status', observed: 'changed', allowed: [] });
    expect(result.message).toContain('Task');
    expect(result.message).toContain('T-2');
    expect(result.message).toContain('status');
  });
});

describe('what two readings prove about the reads', () => {
  it('excludes a field proven volatile by reading twice, and only that field', () => {
    const expected = frame({ Email: bound() }, 'performed', 'Email');
    const onlyVolatile = evaluateAssertion(expected, observed({ Email: seen({ updated: [{ key: '1', fields: ['read'] }], volatileFields: ['read'] }) }));
    expect(onlyVolatile.status).toBe('PASS');
    expect(detail(onlyVolatile).excludedVolatile).toEqual({ Email: ['read'] });

    const alsoSubject = evaluateAssertion(expected, observed({ Email: seen({ updated: [{ key: '1', fields: ['read', 'subject'] }], volatileFields: ['read'] }) }));
    expect(alsoSubject.status).toBe('FAIL');
    const fields = detail(alsoSubject).violations.filter((v) => v.kind === 'updated_field').map((v) => v.field);
    expect(fields).toEqual(['subject']);
  });

  it('does not exclude a boolean, number or timestamp field because of its type', () => {
    for (const field of ['pinned', 'size', 'updatedAt']) {
      const result = evaluateAssertion(frame({ Entry: bound() }), observed({ Entry: seen({ updated: [{ key: 'E1', fields: [field] }] }) }));
      expect(result.status, field).toBe('FAIL');
    }
  });

  it('abstains on creations and deletions of a kind whose membership was unstable, but still fails a field change on it', () => {
    const churn = evaluateAssertion(frame({ Trail: bound() }, 'performed', 'Entry'), observed({ Trail: seen({ created: ['T-9'], membershipUnstable: true }) }));
    expect(churn.status).toBe('UNVERIFIABLE');
    expect(detail(churn).unverifiable).toContainEqual({ entity: 'Trail', kind: 'created', id: 'frame_membership_unstable:Trail' });

    const changed = evaluateAssertion(
      frame({ Trail: bound({ preExistingRows: 1 }) }, 'performed', 'Entry'),
      observed({ Trail: seen({ updated: [{ key: 'T-1', fields: ['text'] }], membershipUnstable: true }) }),
    );
    expect(changed.status).toBe('FAIL');
  });
});

describe('what one demonstration cannot show', () => {
  it('abstains on changes to existing records of a kind the demonstration had none of, and still fails creations', () => {
    const empty = frame({ Email: bound({ preExistingRows: 0, created: 1 }) }, 'performed', 'Email');
    const updated = evaluateAssertion(empty, observed({ Email: seen({ created: ['9'], updated: [{ key: '1', fields: ['read'] }] }) }));
    expect(updated.status).toBe('UNVERIFIABLE');
    expect(detail(updated).unverifiable.map((u) => u.id)).toContain('frame_existing_rows_undemonstrated:Email');
    expect(evaluateAssertion(empty, observed({ Email: seen({ deleted: ['1'] }) })).status).toBe('UNVERIFIABLE');
    expect(evaluateAssertion(empty, observed({ Email: seen({ created: ['8', '9'] }) })).status).toBe('FAIL');
  });

  it('in a declined case holds the job’s record type to nothing, without that abstention', () => {
    const declined = frame({ Entry: bound({ preExistingRows: 0 }) }, 'declined', 'Entry');
    expect(evaluateAssertion(declined, observed({ Entry: seen({ updated: [{ key: 'E1', fields: ['size'] }] }) })).status).toBe('FAIL');
    expect(evaluateAssertion(declined, observed({ Entry: seen() })).status).toBe('PASS');
  });

  it('fails an extra delete+create pair on a record with no established identity', () => {
    const lines = frame({ Line: bound({ identity: 'unestablished' }) }, 'performed', 'Entry');
    expect(evaluateAssertion(lines, observed({ Line: seen({ created: ['["a",2]#1'], deleted: ['["a",1]#1'] }) })).status).toBe('FAIL');
  });

  it('abstains on a changed kind of record the contract does not know, and ignores one that did not change', () => {
    const known = frame({ Entry: bound() });
    const ghost = evaluateAssertion(known, observed({ Entry: seen(), Ghost: seen({ created: ['G1'] }) }));
    expect(ghost.status).toBe('UNVERIFIABLE');
    expect(detail(ghost).unverifiable.map((u) => u.id)).toContain('frame_entity_not_in_contract:Ghost');
    expect(evaluateAssertion(known, observed({ Entry: seen(), Ghost: seen() })).status).toBe('PASS');
  });

  it('abstains when the frame evidence is missing', () => {
    const result = evaluateAssertion(frame({ Entry: bound() }), { state: {}, derived: {}, events: [] });
    expect(result.status).toBe('UNVERIFIABLE');
    expect(detail(result).unverifiable.map((u) => u.id)).toEqual(['frame_evidence_missing']);
  });

  it('errors on a malformed expectation', () => {
    const malformed = AssertionSchema.parse({
      id: 'frame__nothing_else_changed',
      kind: 'state_frame',
      description: 'broken',
      target: 'derived.frame',
      severity: 'invariant',
      expected: { mode: 'sometimes' },
    });
    expect(evaluateAssertion(malformed, observed({ Entry: seen() })).status).toBe('ERROR');
  });

  it('lets a failure on one kind of record outrank an abstention on another', () => {
    const result = evaluateAssertion(
      frame({ Entry: bound(), Trail: bound() }),
      observed({ Entry: seen({ deleted: ['E1'] }), Trail: seen({ created: ['T-9'], membershipUnstable: true }) }),
    );
    expect(result.status).toBe('FAIL');
  });
});

describe('what verify makes of it', () => {
  it('counts the frame as a blocking invariant: not policy-compliant on FAIL, a blocking abstention when unverifiable', () => {
    const failed = verify([frame({ Entry: bound() })], observed({ Entry: seen({ deleted: ['E1'] }) }));
    expect(failed.policyCompliant).toBe(false);
    expect(failed.results[0]?.blocking).toBe(true);

    const unknown = verify([frame({ Entry: bound() })], { state: {}, derived: {}, events: [] });
    expect(unknown.blockingUnverifiable).toBe(1);
  });
});

describe('a kind of record read one page at a time', () => {
  it('does not count records that slid out of the page as deleted, or into it as created', () => {
    const result = evaluateAssertion(
      frame({ Entry: bound({ created: 1 }) }),
      observed({ Entry: seen({ created: ['E8', 'E9'], deleted: ['E1'], windowed: true }) }),
    );
    expect(result.status).toBe('UNVERIFIABLE');
    expect(result.message).toContain('one page');
    expect(detail(result).unverifiable.map((entry) => entry.kind).sort()).toEqual(['created', 'deleted']);
  });

  it('still fails a field changed on a record seen at both ends', () => {
    const result = evaluateAssertion(
      frame({ Entry: bound() }),
      observed({ Entry: seen({ updated: [{ key: 'E1', fields: ['status'] }], windowed: true }) }),
    );
    expect(result.status).toBe('FAIL');
  });
});
