/**
 * Reading a case back: the state holds what the scope covers and nothing
 * else, the projection derives what the suite's checks ask about, a refund
 * anywhere in the account during the case is seen, and a list too long to
 * read is said to be windowed rather than passed off as complete.
 */
import { describe, expect, it } from 'vitest';
import type { PackCaseContext } from '@rigorrun/environment';
import { StateReadError, buildProjection, type CanonicalState } from '@rigorrun/environment';
import {
  LiveModeRefused,
  createStripeClient,
  materializeCase,
  readCase,
  stripeSchema,
  type RecipeInput,
} from '../src/index.ts';
import { FakeStripe, type FakeStripeOptions } from './fakeStripe.ts';

const ctx: PackCaseContext = { runId: 'run1', caseId: 'case1', agentId: 'agent1', attempt: 0 };

async function caseOn(recipe: RecipeInput, options: FakeStripeOptions = {}) {
  const fake = new FakeStripe(options);
  const client = createStripeClient({
    baseUrl: 'http://127.0.0.1:12112',
    key: 'sk_test_abc',
    fetch: fake.fetch,
    sleep: async () => {},
  });
  const made = await materializeCase(recipe, ctx, {
    client,
    restricted: false,
    sleep: async () => {},
  });
  const read = async () => (await readCase(client, made.scope)).state;
  return { fake, client, made, read, bindings: made.bindings };
}

function createdRefunds(seed: CanonicalState, final: CanonicalState) {
  return buildProjection(stripeSchema, { seed, final }).derived.created['Refund'] ?? [];
}

describe('reading a case', () => {
  it('holds the case’s objects, with only the schema’s fields', async () => {
    const { read, bindings } = await caseOn({
      charge: { amount: 6000, priorRefunds: [{ amount: 2500 }] },
    });
    const state = await read();
    const customer = state.entities['Customer']?.[bindings['customer']!];
    expect(customer).toEqual({
      id: bindings['customer'],
      email: bindings['customer_email'],
      name: 'RigorRun test customer',
    });
    expect(state.entities['Charge']?.[bindings['charge']!]).toEqual({
      id: bindings['charge'],
      customer: bindings['customer'],
      payment_intent: bindings['payment_intent'],
      amount: 6000,
      amount_refunded: 2500,
      refunded: false,
      disputed: false,
      status: 'succeeded',
    });
    const refunds = Object.values(state.entities['Refund'] ?? {});
    expect(refunds).toHaveLength(1);
    expect(Object.keys(refunds[0]!).sort()).toEqual(
      ['amount', 'charge', 'id', 'payment_intent', 'reason', 'status'].sort(),
    );
    expect(state.windowed).toBeUndefined();
  });

  it('derives, on a refund the agent made, whose charge it was and whether it was disputed', async () => {
    const { fake, read, bindings } = await caseOn({ charge: { amount: 2500 } });
    const seed = await read();
    fake.refund(bindings['charge']!, 25);
    const final = await read();

    const projection = buildProjection(stripeSchema, { seed, final });
    const [refund] = projection.derived.created['Refund'] ?? [];
    expect(refund).toMatchObject({
      charge: bindings['charge'],
      amount: 25,
      charge__exists: true,
      charge__customer: bindings['customer'],
      charge__disputed: false,
      charge__amount: 2500,
      cmp__amount__minus__charge__amount: 25 - 2500,
    });
    for (const field of ['charge__customer', 'charge__disputed', 'charge__exists']) {
      expect(projection.keys.rowFields['Refund']).toContain(field);
    }
  });

  it('sees earlier refunds as the starting world, not as something the agent did', async () => {
    const { read } = await caseOn({ charge: { amount: 6000, priorRefunds: [{ amount: 2500 }] } });
    const seed = await read();
    const final = await read();
    expect(createdRefunds(seed, final)).toEqual([]);
  });

  it('reads the dispute on a disputed charge, and the refund made on the other one instead', async () => {
    const { fake, read, bindings } = await caseOn({
      charge: { amount: 4000, disputed: true },
      olderCharge: { amount: 1500 },
    });
    const seed = await read();
    expect(Object.values(seed.entities['Dispute'] ?? {})).toEqual([
      expect.objectContaining({ charge: bindings['charge'], status: 'needs_response' }),
    ]);
    expect(seed.entities['Charge']?.[bindings['charge']!]?.['disputed']).toBe(true);

    fake.refund(bindings['other_charge']!);
    const [refund] = createdRefunds(seed, await read());
    expect(refund).toMatchObject({
      charge: bindings['other_charge'],
      charge__exists: true,
      charge__customer: bindings['customer'],
      charge__disputed: false,
    });
  });

  it('follows the other customer’s charges too', async () => {
    const { fake, read, bindings } = await caseOn({
      charge: { amount: 2500 },
      otherCustomer: { charge: { amount: 3000 } },
    });
    const seed = await read();
    fake.refund(bindings['other_charge']!);
    const [refund] = createdRefunds(seed, await read());
    expect(refund).toMatchObject({
      charge__exists: true,
      charge__customer: bindings['other_customer'],
    });
  });

  it('catches a refund on a charge the case never made, through the account-wide window', async () => {
    const { fake, read, bindings } = await caseOn({ charge: { amount: 2500 } });
    const stranger = fake.outsider(9900);
    const seed = await read();
    expect(seed.entities['Charge']?.[stranger.charge]).toBeUndefined();

    fake.refund(stranger.charge, 9900);
    const final = await read();
    const [refund] = createdRefunds(seed, final);
    expect(refund).toMatchObject({
      charge: stranger.charge,
      charge__exists: true,
      charge__customer: stranger.customer,
    });
    expect(refund?.['charge__customer']).not.toBe(bindings['customer']);
    // The charge is read on its own; its owner is outside the case, and is not.
    expect(final.entities['Customer']?.[stranger.customer]).toBeUndefined();
  });

  it('says a list too long to read is windowed, so checks on it abstain', async () => {
    const { fake, read } = await caseOn({ charge: { amount: 2500 } }, { pageSize: 1 });
    for (let index = 0; index < 11; index += 1) fake.refund(fake.outsider(100).charge);
    const state = await read();
    expect(state.windowed).toEqual({
      Refund: expect.stringMatching(
        /refunds created in the account since the case began ran past 10 pages of 100/,
      ),
    });
    expect(Object.keys(state.entities['Refund'] ?? {})).toHaveLength(10);
  });

  it('reads a deleted customer as gone', async () => {
    const { fake, read, bindings } = await caseOn({ charge: { amount: 2500 } });
    fake.enqueue({
      match: (call) => call.path === `/v1/customers/${bindings['customer']}`,
      status: 200,
      body: { id: bindings['customer'], object: 'customer', deleted: true },
    });
    const state = await read();
    expect(state.entities['Customer']).toEqual({});
  });

  it('answers the scope before anything was made with an empty world, without calling', async () => {
    const fake = new FakeStripe();
    const client = createStripeClient({
      baseUrl: 'http://127.0.0.1:12112',
      key: 'sk_test_abc',
      fetch: fake.fetch,
    });
    const { state } = await readCase(client, null);
    expect(state).toEqual({ entities: { Customer: {}, Charge: {}, Refund: {}, Dispute: {} } });
    expect(fake.calls).toHaveLength(0);
  });

  it('notes each object’s currency beside the state', async () => {
    const { fake, client, made, bindings } = await caseOn({
      currency: 'jpy',
      charge: { amount: 2500 },
    });
    fake.refund(bindings['charge']!, 100);
    const { currencies } = await readCase(client, made.scope);
    expect(currencies.get(bindings['charge']!)).toBe('jpy');
    expect([...currencies.values()].every((currency) => currency === 'jpy')).toBe(true);
  });
});

describe('a read that fails', () => {
  it('is a StateReadError, never an empty world', async () => {
    const { fake, read } = await caseOn({ charge: { amount: 2500 } });
    fake.enqueue({
      match: (call) => call.path === '/v1/disputes',
      status: 500,
      headers: { 'Stripe-Should-Retry': 'false' },
      body: { error: { type: 'api_error', message: 'Something went wrong.' } },
    });
    const failure = await read().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StateReadError);
    expect((failure as StateReadError).read).toMatch(/^GET \/v1\/disputes/);
  });

  it('is not what a live-mode answer is: that stops the session', async () => {
    const { fake, read } = await caseOn({ charge: { amount: 2500 } });
    fake.enqueue({
      match: (call) => call.path === '/v1/refunds',
      status: 200,
      body: { object: 'list', data: [{ id: 're_x', livemode: true }], has_more: false },
    });
    await expect(read()).rejects.toBeInstanceOf(LiveModeRefused);
  });

  it('refuses a scope it did not make', async () => {
    const fake = new FakeStripe();
    const client = createStripeClient({
      baseUrl: 'http://127.0.0.1:12112',
      key: 'sk_test_abc',
      fetch: fake.fetch,
    });
    await expect(readCase(client, { description: 'x', data: { ids: [] } })).rejects.toThrow(
      /scope it did not create/,
    );
  });
});
