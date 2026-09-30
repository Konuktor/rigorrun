/**
 * A read that answers with one page is said so when it is nominated, not
 * discovered from a run of abstentions after the job has been demonstrated.
 */
import { describe, expect, it } from 'vitest';
import type { EnvironmentSchema } from '@rigorrun/environment';
import { pagedReadAdvice } from '../src/pagedReads.ts';

const schema: EnvironmentSchema = {
  entities: [
    {
      name: 'Booking',
      idField: 'bookingId',
      fields: [
        { name: 'bookingId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'status', type: 'enum', nullable: false, role: 'status', enumValues: ['held', 'confirmed'] },
        { name: 'guests', type: 'number', nullable: false, role: 'quantity', unit: 'count', precision: 1 },
      ],
      mutable: true,
      appendOnly: false,
    },
  ],
  relationships: [],
};
const booking = (id: string) => ({ bookingId: id, status: 'held', guests: 2 });

describe('nominating a read that returns one page', () => {
  it('says which read, why, what it means and what to do', () => {
    const advice = pagedReadAdvice(
      [{ bookings: [booking('B-1'), booking('B-2')], has_more: true }],
      [{ tool: 'find_bookings', args: {} }],
      schema,
    );
    expect(advice).toContain('find_bookings returned one page of a longer list: has_more is true');
    expect(advice).toContain('Booking records');
    expect(advice).toMatch(/not checked/);
    expect(advice).toMatch(/higher limit/);
  });

  it('notices a read called with a limit that came back full', () => {
    expect(
      pagedReadAdvice([{ bookings: [booking('B-1'), booking('B-2')] }], [{ tool: 'find_bookings', args: { limit: 2 } }], schema),
    ).toMatch(/called with limit 2/);
  });

  it('says nothing about a complete answer', () => {
    expect(pagedReadAdvice([{ bookings: [booking('B-1')], has_more: false }], [{ tool: 'find_bookings' }], schema)).toBe('');
  });
});
