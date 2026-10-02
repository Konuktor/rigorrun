import { describe, expect, it } from 'vitest';
import { bindingsFor, buildWorld, parseRecipe } from '../src/index.ts';

const emptyRecipe = () => parseRecipe({ bind: {} });

describe('helpdesk recipes', () => {
  it('builds the default world with empty evidence tables', () => {
    const world = buildWorld(emptyRecipe());
    expect(world.orgs.map((org) => org.id)).toEqual(['alder', 'birch']);
    expect(world.customers).toHaveLength(6);
    expect(world.outbox).toEqual([]);
    expect(world.access_log).toEqual([]);
  });

  it('appends customers, orders, and tickets in their twin shape', () => {
    const recipe = parseRecipe({
      add: {
        customers: [
          {
            id: 'cus_20',
            org_id: 'alder',
            name: 'Ada',
            email: 'ada@alder.example',
            notes: 'New account',
          },
        ],
        orders: [
          {
            id: 'ord_20',
            org_id: 'alder',
            customer_id: 'cus_20',
            ref: 'ALD-1020',
            amount_cents: 1000,
            refunded_cents: 0,
            status: 'paid',
          },
        ],
        tickets: [
          {
            id: 'tkt_20',
            org_id: 'alder',
            customer_id: 'cus_20',
            subject: 'Question',
            body: 'Where is it?',
            status: 'open',
            notes: [],
          },
        ],
      },
      bind: {},
    });
    const world = buildWorld(recipe);
    expect(world.customers.at(-1)?.id).toBe('cus_20');
    expect(world.orders.at(-1)?.id).toBe('ord_20');
    expect(world.tickets.at(-1)?.id).toBe('tkt_20');
  });

  it('rejects an id collision, including between additions', () => {
    const existing = parseRecipe({
      add: {
        customers: [
          {
            id: 'cus_1',
            org_id: 'alder',
            name: 'Duplicate',
            email: 'duplicate@example.test',
            notes: '',
          },
        ],
      },
      bind: {},
    });
    expect(() => buildWorld(existing)).toThrow(/duplicate id "cus_1"/);
  });

  it('resolves named fields to strings', () => {
    const world = buildWorld(emptyRecipe());
    expect(
      bindingsFor(world, {
        customer: { table: 'customers', id: 'cus_1', field: 'id' },
        amount: { table: 'orders', id: 'ord_1', field: 'amount_cents' },
      }),
    ).toEqual({ customer: 'cus_1', amount: '12500' });
  });

  it('refuses a binding to a missing row or field', () => {
    const world = buildWorld(emptyRecipe());
    expect(() =>
      bindingsFor(world, { bad: { table: 'customers', id: 'cus_404', field: 'id' } }),
    ).toThrow(/missing row/);
    expect(() =>
      bindingsFor(world, { bad: { table: 'customers', id: 'cus_1', field: 'missing' } }),
    ).toThrow(/missing field/);
  });
});
