/**
 * The twin's endpoints, one behaviour at a time: what each creates, how lists
 * page and filter, Stripe's refund bookkeeping, every error code the pack
 * depends on, and a dispute that arrives after the payment.
 *
 * Time is a hand-moved clock, so `created` filters and the dispute delay are
 * tested without waiting.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encodeForm, startTwin, type FormInput, type RunningTwin } from '../src/index.ts';

const KEY = 'sk_test_twin_api';
const START = Date.UTC(2026, 9, 1, 12, 0, 0);

let now = START;
let twin: RunningTwin;

beforeAll(async () => {
  twin = await startTwin({ port: 0, clock: () => now, disputeDelayMs: 5000 });
});
afterAll(async () => {
  await twin.close();
});
beforeEach(() => {
  now = START;
  twin.model.reset();
});

interface Answer {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, FormInput> = {},
  headers: Record<string, string> = {},
): Promise<Answer> {
  const query = method === 'GET' ? encodeForm(params) : '';
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...headers },
  };
  if (method === 'POST') {
    init.headers = { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' };
    init.body = encodeForm(params);
  }
  const response = await fetch(`${twin.url}${path}${query ? `?${query}` : ''}`, init);
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Record<string, unknown>,
  };
}

/** A value inside a response, by path: `at(body, 'data', 0, 'id')`. */
function at(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function ids(answer: Answer): unknown[] {
  return ((answer.body['data'] ?? []) as Record<string, unknown>[]).map((item) => item['id']);
}

function expectError(answer: Answer, status: number, code?: string, param?: string) {
  expect(answer.status).toBe(status);
  expect(at(answer.body, 'error', 'type')).toBe('invalid_request_error');
  expect(at(answer.body, 'error', 'code')).toBe(code);
  if (param !== undefined) expect(at(answer.body, 'error', 'param')).toBe(param);
}

async function customer(params: Record<string, FormInput> = {}): Promise<string> {
  const created = await call('POST', '/v1/customers', {
    email: 'ada@example.com',
    name: 'Ada Fenwick',
    ...params,
  });
  expect(created.status).toBe(200);
  return String(created.body['id']);
}

/** A confirmed card payment; returns the PaymentIntent and its charge. */
async function pay(
  amount: number,
  options: { customer?: string; card?: string; metadata?: Record<string, string> } = {},
): Promise<{ intent: string; charge: string }> {
  const created = await call('POST', '/v1/payment_intents', {
    amount,
    currency: 'usd',
    customer: options.customer,
    payment_method: options.card ?? 'pm_card_visa',
    payment_method_types: ['card'],
    confirm: true,
    metadata: options.metadata,
  });
  expect(created.status).toBe(200);
  return { intent: String(created.body['id']), charge: String(created.body['latest_charge']) };
}

function advance(seconds: number) {
  now += seconds * 1000;
}

describe('customers', () => {
  it('creates a customer the way Stripe returns one', async () => {
    const created = await call('POST', '/v1/customers', {
      email: 'ada@example.com',
      name: 'Ada Fenwick',
      metadata: { rigorrun_case: 'stripe.full', rigorrun_attempt: '0' },
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      object: 'customer',
      email: 'ada@example.com',
      name: 'Ada Fenwick',
      metadata: { rigorrun_case: 'stripe.full', rigorrun_attempt: '0' },
      created: START / 1000,
      livemode: false,
    });
    expect(created.body['id']).toMatch(/^cus_[A-Za-z0-9]{14}$/);
  });

  it('retrieves one, and answers 404 resource_missing for an id it does not have', async () => {
    const id = await customer();
    expect((await call('GET', `/v1/customers/${id}`)).body['id']).toBe(id);
    const missing = await call('GET', '/v1/customers/cus_nothere');
    expectError(missing, 404, 'resource_missing', 'id');
    expect(at(missing.body, 'error', 'message')).toBe("No such customer: 'cus_nothere'");
    expect(at(missing.body, 'error', 'doc_url')).toBe(
      'https://stripe.com/docs/error-codes/resource-missing',
    );
  });

  it('finds customers by exact email, newest first', async () => {
    const first = await customer({ email: 'same@example.com' });
    advance(1);
    const second = await customer({ email: 'same@example.com' });
    await customer({ email: 'other@example.com' });
    expect(ids(await call('GET', '/v1/customers', { email: 'same@example.com' }))).toEqual([
      second,
      first,
    ]);
    expect(ids(await call('GET', '/v1/customers', { email: 'SAME@example.com' }))).toEqual([]);
  });

  it('refuses an unknown parameter, and one Stripe has but the twin does not model', async () => {
    expectError(
      await call('POST', '/v1/customers', { email: 'a@example.com', nickname: 'x' }),
      400,
      'parameter_unknown',
      'nickname',
    );
    const unsupported = await call('POST', '/v1/customers', { source: 'tok_visa' });
    expectError(unsupported, 400, undefined, 'source');
    expect(String(at(unsupported.body, 'error', 'message'))).toMatch(/does not model `source`/);
  });

  it('accepts real parameters that change nothing it records', async () => {
    const created = await call('POST', '/v1/customers', {
      email: 'a@example.com',
      phone: '+15555550123',
      address: { line1: '1 Main St', country: 'US' },
      preferred_locales: ['en'],
    });
    expect(created.status).toBe(200);
    expect(created.body['phone']).toBe('+15555550123');
  });

  it('refuses an email that is not one', async () => {
    expectError(
      await call('POST', '/v1/customers', { email: 'not-an-email' }),
      400,
      'email_invalid',
      'email',
    );
  });

  it('holds metadata to Stripe’s limits, and treats an empty value as unset', async () => {
    const created = await call('POST', '/v1/customers', { metadata: { kept: 'yes', dropped: '' } });
    expect(created.body['metadata']).toEqual({ kept: 'yes' });
    expect(
      (await call('POST', '/v1/customers', { metadata: { ['k'.repeat(41)]: 'v' } })).status,
    ).toBe(400);
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'v']));
    expect((await call('POST', '/v1/customers', { metadata: many })).status).toBe(400);
  });
});

describe('payment intents', () => {
  it('pays with pm_card_visa: a succeeded intent and a charge carrying its metadata', async () => {
    const cus = await customer();
    const created = await call('POST', '/v1/payment_intents', {
      amount: 2500,
      currency: 'USD',
      customer: cus,
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
      metadata: { order_ref: 'RR-ORD-1' },
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      object: 'payment_intent',
      amount: 2500,
      amount_received: 2500,
      currency: 'usd',
      customer: cus,
      status: 'succeeded',
      metadata: { order_ref: 'RR-ORD-1' },
      livemode: false,
    });
    expect(created.body['id']).toMatch(/^pi_[A-Za-z0-9]{24}$/);
    const chargeId = String(created.body['latest_charge']);
    expect(chargeId).toMatch(/^ch_[A-Za-z0-9]{24}$/);
    const charge = await call('GET', `/v1/charges/${chargeId}`);
    expect(charge.body).toMatchObject({
      object: 'charge',
      amount: 2500,
      amount_captured: 2500,
      amount_refunded: 0,
      refunded: false,
      disputed: false,
      captured: true,
      paid: true,
      currency: 'usd',
      customer: cus,
      payment_intent: created.body['id'],
      status: 'succeeded',
      metadata: { order_ref: 'RR-ORD-1' },
      livemode: false,
    });
    expect(charge.body['balance_transaction']).toMatch(/^txn_/);
  });

  it('pays without redirects when automatic payment methods say never', async () => {
    const created = await call('POST', '/v1/payment_intents', {
      amount: 2500,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      confirm: true,
    });
    expect(created.status).toBe(200);
    expect(created.body['status']).toBe('succeeded');
  });

  it('refuses to confirm without a return_url when redirects are possible, as Stripe does', async () => {
    const refused = await call('POST', '/v1/payment_intents', {
      amount: 2500,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
    });
    expectError(refused, 400);
    expect(String(at(refused.body, 'error', 'message'))).toMatch(/return_url/);
    expect(twin.model.all('payment_intent')).toHaveLength(0);
    const pinnedOld = await call(
      'POST',
      '/v1/payment_intents',
      { amount: 2500, currency: 'usd', payment_method: 'pm_card_visa', confirm: true },
      { 'Stripe-Version': '2022-11-15' },
    );
    expect(pinnedOld.status).toBe(200);
    expect(pinnedOld.body['payment_method_types']).toEqual(['card']);
  });

  it('leaves an unconfirmed intent waiting, with no charge', async () => {
    const waiting = await call('POST', '/v1/payment_intents', {
      amount: 2500,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
    });
    expect(waiting.body).toMatchObject({ status: 'requires_confirmation', latest_charge: null });
    const bare = await call('POST', '/v1/payment_intents', { amount: 2500, currency: 'usd' });
    expect(bare.body).toMatchObject({ status: 'requires_payment_method', latest_charge: null });
    expect(twin.model.all('charge')).toHaveLength(0);
  });

  it('expands latest_charge on retrieve, on create and on lists', async () => {
    const cus = await customer();
    const { intent, charge } = await pay(2500, { customer: cus });
    const retrieved = await call('GET', `/v1/payment_intents/${intent}`, {
      expand: ['latest_charge', 'customer'],
    });
    expect(at(retrieved.body, 'latest_charge', 'id')).toBe(charge);
    expect(at(retrieved.body, 'customer', 'id')).toBe(cus);
    const listed = await call('GET', '/v1/payment_intents', {
      customer: cus,
      expand: ['data.latest_charge'],
    });
    expect(at(listed.body, 'data', 0, 'latest_charge', 'object')).toBe('charge');
    const created = await call('POST', '/v1/payment_intents', {
      amount: 1000,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
      expand: ['latest_charge'],
    });
    expect(at(created.body, 'latest_charge', 'amount')).toBe(1000);
  });

  it('refuses an expansion it cannot follow before creating anything', async () => {
    const refused = await call('POST', '/v1/payment_intents', {
      amount: 1000,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
      expand: ['latest_chargee'],
    });
    expectError(refused, 400, undefined, 'expand');
    expect(twin.model.all('payment_intent')).toHaveLength(0);
    expectError(await call('GET', '/v1/charges', { expand: ['customer'] }), 400);
  });

  it('lists a customer’s intents', async () => {
    const cus = await customer();
    const first = await pay(1000, { customer: cus });
    advance(1);
    const second = await pay(2000, { customer: cus });
    await pay(3000);
    expect(ids(await call('GET', '/v1/payment_intents', { customer: cus }))).toEqual([
      second.intent,
      first.intent,
    ]);
  });

  it('refuses a currency Stripe does not support, as it refuses a malformed one', async () => {
    const base = {
      amount: 2500,
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
    };
    for (const currency of ['zzz', 'xxx', 'abc']) {
      const refused = await call('POST', '/v1/payment_intents', { ...base, currency });
      expectError(refused, 400, undefined, 'currency');
      expect(at(refused.body, 'error', 'message')).toBe(`Invalid currency: ${currency}.`);
    }
    const malformed = await call('POST', '/v1/payment_intents', { ...base, currency: 'us' });
    expectError(malformed, 400, undefined, 'currency');
    // Nothing was made for a refused payment.
    expect(ids(await call('GET', '/v1/payment_intents'))).toEqual([]);
    for (const currency of ['usd', 'eur', 'gbp', 'hkd', 'jpy', 'mxn']) {
      expect(
        (await call('POST', '/v1/payment_intents', { ...base, currency })).status,
        currency,
      ).toBe(200);
    }
  });

  it('refuses what Stripe refuses on a payment', async () => {
    const base = {
      currency: 'usd',
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
    };
    expectError(
      await call('POST', '/v1/payment_intents', base),
      400,
      'parameter_missing',
      'amount',
    );
    expectError(
      await call('POST', '/v1/payment_intents', { ...base, amount: 2500, currency: undefined }),
      400,
      'parameter_missing',
      'currency',
    );
    expectError(
      await call('POST', '/v1/payment_intents', { ...base, amount: '25.00' }),
      400,
      'parameter_invalid_integer',
      'amount',
    );
    expectError(
      await call('POST', '/v1/payment_intents', { ...base, amount: 49 }),
      400,
      'amount_too_small',
      'amount',
    );
    expectError(
      await call('POST', '/v1/payment_intents', { ...base, amount: 100_000_000 }),
      400,
      'amount_too_large',
      'amount',
    );
    expectError(
      await call('POST', '/v1/payment_intents', { ...base, amount: 2500, customer: 'cus_nothere' }),
      400,
      'resource_missing',
      'customer',
    );
    expectError(
      await call('POST', '/v1/payment_intents', {
        ...base,
        amount: 2500,
        payment_method: 'pm_card_unknown',
      }),
      400,
      'resource_missing',
      'payment_method',
    );
    expectError(
      await call('POST', '/v1/payment_intents', { ...base, amount: 2500, payment_method: '' }),
      400,
      'parameter_invalid_empty',
      'payment_method',
    );
    expectError(
      await call('POST', '/v1/payment_intents', {
        ...base,
        amount: 2500,
        payment_method_types: ['sepa_debit'],
      }),
      400,
      undefined,
      'payment_method_types',
    );
    expectError(
      await call('POST', '/v1/payment_intents', {
        ...base,
        amount: 2500,
        automatic_payment_methods: { enabled: true },
      }),
      400,
      undefined,
      'automatic_payment_methods',
    );
    expectError(
      await call('POST', '/v1/payment_intents', {
        ...base,
        amount: 2500,
        capture_method: 'manual',
      }),
      400,
      undefined,
      'capture_method',
    );
    expectError(
      await call('POST', '/v1/payment_intents', { ...base, amount: 2500, confirm: 'yes' }),
      400,
      undefined,
      'confirm',
    );
    expectError(
      await call('POST', '/v1/payment_intents', {
        amount: 2500,
        currency: 'usd',
        payment_method_types: ['card'],
        confirm: true,
      }),
      400,
      undefined,
      'payment_method',
    );
    expect(twin.model.all('payment_intent')).toHaveLength(0);
  });
});

describe('charges', () => {
  it('lists by customer and by payment intent, newest first', async () => {
    const cus = await customer();
    const older = await pay(1000, { customer: cus });
    advance(1);
    const newer = await pay(2000, { customer: cus });
    const stranger = await pay(3000);
    expect(ids(await call('GET', '/v1/charges', { customer: cus }))).toEqual([
      newer.charge,
      older.charge,
    ]);
    expect(ids(await call('GET', '/v1/charges', { payment_intent: stranger.intent }))).toEqual([
      stranger.charge,
    ]);
    expect(ids(await call('GET', '/v1/charges', { customer: 'cus_nothere' }))).toEqual([]);
    expect(ids(await call('GET', '/v1/charges'))).toEqual([
      stranger.charge,
      newer.charge,
      older.charge,
    ]);
  });

  it('filters on created with gt, gte, lt, lte and an exact second', async () => {
    const t0 = START / 1000;
    const a = await pay(1000);
    advance(10);
    const b = await pay(1000);
    advance(10);
    const c = await pay(1000);
    const list = async (created: FormInput) => ids(await call('GET', '/v1/charges', { created }));
    expect(await list({ gte: t0 + 10 })).toEqual([c.charge, b.charge]);
    expect(await list({ gt: t0 + 10 })).toEqual([c.charge]);
    expect(await list({ lt: t0 + 10 })).toEqual([a.charge]);
    expect(await list({ lte: t0 + 10, gte: t0 })).toEqual([b.charge, a.charge]);
    expect(await list(t0 + 20)).toEqual([c.charge]);
    expectError(
      await call('GET', '/v1/charges', { created: { gte: 'yesterday' } }),
      400,
      'parameter_invalid_integer',
      'created[gte]',
    );
    expectError(
      await call('GET', '/v1/charges', { created: { after: t0 } }),
      400,
      'parameter_unknown',
      'created[after]',
    );
  });

  it('pages with limit, starting_after, ending_before and has_more, exactly like Stripe', async () => {
    const made: string[] = [];
    for (let i = 0; i < 5; i += 1) made.unshift((await pay(1000 + i)).charge);
    const page1 = await call('GET', '/v1/charges', { limit: 2 });
    expect(page1.body).toMatchObject({ object: 'list', has_more: true, url: '/v1/charges' });
    expect(ids(page1)).toEqual(made.slice(0, 2));
    const page2 = await call('GET', '/v1/charges', { limit: 2, starting_after: made[1] });
    expect(ids(page2)).toEqual(made.slice(2, 4));
    expect(page2.body['has_more']).toBe(true);
    const page3 = await call('GET', '/v1/charges', { limit: 2, starting_after: made[3] });
    expect(ids(page3)).toEqual(made.slice(4));
    expect(page3.body['has_more']).toBe(false);
    const back = await call('GET', '/v1/charges', { limit: 2, ending_before: made[4] });
    expect(ids(back)).toEqual(made.slice(2, 4));
    expect(back.body['has_more']).toBe(true);
    const all = await call('GET', '/v1/charges');
    expect(ids(all)).toEqual(made);
    expect(all.body['has_more']).toBe(false);
  });

  it('defaults to ten per page and allows at most a hundred', async () => {
    for (let i = 0; i < 12; i += 1) await pay(1000);
    const page = await call('GET', '/v1/charges');
    expect(ids(page)).toHaveLength(10);
    expect(page.body['has_more']).toBe(true);
    expect(ids(await call('GET', '/v1/charges', { limit: 100 }))).toHaveLength(12);
    expectError(
      await call('GET', '/v1/charges', { limit: 0 }),
      400,
      'parameter_invalid_integer',
      'limit',
    );
    expectError(
      await call('GET', '/v1/charges', { limit: 101 }),
      400,
      'parameter_invalid_integer',
      'limit',
    );
  });

  it('refuses a cursor it does not have, and two cursors at once', async () => {
    expectError(
      await call('GET', '/v1/charges', { starting_after: 'ch_nothere' }),
      400,
      'resource_missing',
      'starting_after',
    );
    const { charge } = await pay(1000);
    expectError(
      await call('GET', '/v1/charges', { starting_after: charge, ending_before: charge }),
      400,
    );
  });

  it('expands refunds on a charge as a list', async () => {
    const { charge } = await pay(6000);
    await call('POST', '/v1/refunds', { charge, amount: 1000 });
    const expanded = await call('GET', `/v1/charges/${charge}`, { expand: ['refunds'] });
    expect(at(expanded.body, 'refunds', 'object')).toBe('list');
    expect(at(expanded.body, 'refunds', 'data', 0, 'amount')).toBe(1000);
  });
});

describe('refunds', () => {
  it('keeps the charge’s books: partial, then the remainder by default, then nothing left', async () => {
    const { intent, charge } = await pay(6000);
    const partial = await call('POST', '/v1/refunds', {
      charge,
      amount: 2500,
      reason: 'requested_by_customer',
      metadata: { rigorrun_case: 'stripe.partial' },
    });
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({
      object: 'refund',
      amount: 2500,
      charge,
      payment_intent: intent,
      currency: 'usd',
      status: 'succeeded',
      reason: 'requested_by_customer',
      metadata: { rigorrun_case: 'stripe.partial' },
    });
    expect(partial.body['id']).toMatch(/^re_[A-Za-z0-9]{24}$/);
    // Stripe's refund object has no livemode; the twin's has none either.
    expect(partial.body).not.toHaveProperty('livemode');
    expect((await call('GET', `/v1/charges/${charge}`)).body).toMatchObject({
      amount_refunded: 2500,
      refunded: false,
    });

    const rest = await call('POST', '/v1/refunds', { charge });
    expect(rest.body['amount']).toBe(3500);
    expect(rest.body['reason']).toBeNull();
    expect((await call('GET', `/v1/charges/${charge}`)).body).toMatchObject({
      amount_refunded: 6000,
      refunded: true,
    });

    const again = await call('POST', '/v1/refunds', { charge, amount: 100 });
    expectError(again, 400, 'charge_already_refunded');
    expect(at(again.body, 'error', 'message')).toBe(`Charge ${charge} has already been refunded.`);
    expect(twin.model.all('refund')).toHaveLength(2);
  });

  it('refuses more than what is left, without a code, as Stripe does', async () => {
    const { charge } = await pay(6000);
    await call('POST', '/v1/refunds', { charge, amount: 2500 });
    const tooMuch = await call('POST', '/v1/refunds', { charge, amount: 3501 });
    expectError(tooMuch, 400, undefined, 'amount');
    expect(at(tooMuch.body, 'error', 'message')).toBe(
      'Refund amount ($35.01) is greater than unrefunded amount on charge ($35.00)',
    );
    expect((await call('POST', '/v1/refunds', { charge, amount: 3500 })).status).toBe(200);
  });

  it('refunds through the PaymentIntent, and checks the two agree when both are given', async () => {
    const first = await pay(4000);
    const second = await pay(1000);
    const byIntent = await call('POST', '/v1/refunds', {
      payment_intent: first.intent,
      amount: 1000,
    });
    expect(byIntent.body).toMatchObject({ charge: first.charge, payment_intent: first.intent });
    expect(
      (
        await call('POST', '/v1/refunds', {
          charge: first.charge,
          payment_intent: first.intent,
          amount: 1000,
        })
      ).status,
    ).toBe(200);
    expectError(
      await call('POST', '/v1/refunds', { charge: second.charge, payment_intent: first.intent }),
      400,
      undefined,
      'charge',
    );
    const unpaid = await call('POST', '/v1/payment_intents', { amount: 1000, currency: 'usd' });
    expectError(
      await call('POST', '/v1/refunds', { payment_intent: String(unpaid.body['id']) }),
      400,
      undefined,
      'payment_intent',
    );
  });

  it('refuses each malformed request with Stripe’s code', async () => {
    const { charge } = await pay(6000);
    expectError(
      await call('POST', '/v1/refunds', { charge, amount: '12.5' }),
      400,
      'parameter_invalid_integer',
      'amount',
    );
    expectError(
      await call('POST', '/v1/refunds', { charge, amount: 'twenty' }),
      400,
      'parameter_invalid_integer',
      'amount',
    );
    expectError(
      await call('POST', '/v1/refunds', { charge, amount: 0 }),
      400,
      'parameter_invalid_integer',
      'amount',
    );
    expectError(
      await call('POST', '/v1/refunds', { charge, amount: -5 }),
      400,
      'parameter_invalid_integer',
      'amount',
    );
    expectError(await call('POST', '/v1/refunds', { amount: 100 }), 400, undefined);
    expectError(
      await call('POST', '/v1/refunds', { charge: 'ch_nothere' }),
      404,
      'resource_missing',
      'id',
    );
    expectError(
      await call('POST', '/v1/refunds', { payment_intent: 'pi_nothere' }),
      400,
      'resource_missing',
      'payment_intent',
    );
    expectError(
      await call('POST', '/v1/refunds', { charge: '' }),
      400,
      'parameter_invalid_empty',
      'charge',
    );
    expectError(await call('POST', '/v1/refunds', { charge, reason: 'changed_mind' }), 400);
    expectError(
      await call('POST', '/v1/refunds', { charge, reason: 'expired_uncaptured_charge' }),
      400,
      undefined,
      'reason',
    );
    expectError(
      await call('POST', '/v1/refunds', { charge, amount_minor: 100 }),
      400,
      'parameter_unknown',
      'amount_minor',
    );
    expect(twin.model.all('refund')).toHaveLength(0);
    expect(twin.model.find('charge', charge)?.amount_refunded).toBe(0);
  });

  it('retrieves one, and lists by charge, by payment intent and by created', async () => {
    const a = await pay(6000);
    const b = await pay(6000);
    const r1 = await call('POST', '/v1/refunds', { charge: a.charge, amount: 100 });
    advance(5);
    const since = now / 1000;
    const r2 = await call('POST', '/v1/refunds', { charge: a.charge, amount: 200 });
    const r3 = await call('POST', '/v1/refunds', { charge: b.charge, amount: 300 });
    expect((await call('GET', `/v1/refunds/${String(r1.body['id'])}`)).body['amount']).toBe(100);
    expectError(await call('GET', '/v1/refunds/re_nothere'), 404, 'resource_missing', 'id');
    expect(ids(await call('GET', '/v1/refunds', { charge: a.charge }))).toEqual([
      r2.body['id'],
      r1.body['id'],
    ]);
    expect(ids(await call('GET', '/v1/refunds', { payment_intent: b.intent }))).toEqual([
      r3.body['id'],
    ]);
    expect(ids(await call('GET', '/v1/refunds', { created: { gte: since } }))).toEqual([
      r3.body['id'],
      r2.body['id'],
    ]);
    const page = await call('GET', '/v1/refunds', { charge: a.charge, limit: 1 });
    expect(page.body['has_more']).toBe(true);
  });
});

describe('disputes', () => {
  it('opens a dispute on a pm_card_createDispute payment only after the delay', async () => {
    const cus = await customer();
    const { intent, charge } = await pay(4000, { customer: cus, card: 'pm_card_createDispute' });
    expect((await call('GET', `/v1/charges/${charge}`)).body['disputed']).toBe(false);
    expect(ids(await call('GET', '/v1/disputes', { charge }))).toEqual([]);

    now += 4999;
    expect((await call('GET', `/v1/charges/${charge}`)).body['disputed']).toBe(false);
    now += 1;
    expect((await call('GET', `/v1/charges/${charge}`)).body['disputed']).toBe(true);

    const listed = await call('GET', '/v1/disputes', { charge });
    expect(listed.body['data']).toHaveLength(1);
    const dispute = at(listed.body, 'data', 0) as Record<string, unknown>;
    expect(dispute).toMatchObject({
      object: 'dispute',
      amount: 4000,
      charge,
      payment_intent: intent,
      currency: 'usd',
      status: 'needs_response',
      reason: 'fraudulent',
      created: START / 1000 + 5,
      livemode: false,
    });
    expect(dispute['id']).toMatch(/^du_/);
    expect((await call('GET', `/v1/disputes/${String(dispute['id'])}`)).body['charge']).toBe(
      charge,
    );
    expect(ids(await call('GET', '/v1/disputes', { payment_intent: intent }))).toEqual([
      dispute['id'],
    ]);
    expectError(await call('GET', '/v1/disputes/dp_nothere'), 404, 'resource_missing', 'id');
  });

  it('refuses to refund a disputed charge: charge_disputed', async () => {
    const { intent, charge } = await pay(4000, { card: 'pm_card_createDispute' });
    advance(5);
    const refused = await call('POST', '/v1/refunds', { charge });
    expectError(refused, 400, 'charge_disputed');
    expect(at(refused.body, 'error', 'message')).toBe(
      `Charge ${charge} has been charged back; cannot issue a refund.`,
    );
    expectError(
      await call('POST', '/v1/refunds', { payment_intent: intent }),
      400,
      'charge_disputed',
    );
    expect(twin.model.all('refund')).toHaveLength(0);
  });

  it('leaves a pm_card_visa payment undisputed however long it waits', async () => {
    const { charge } = await pay(4000);
    advance(3600);
    expect((await call('GET', `/v1/charges/${charge}`)).body['disputed']).toBe(false);
    expect(ids(await call('GET', '/v1/disputes'))).toEqual([]);
  });
});

describe('balance', () => {
  it('reports test mode, with what was paid less what was refunded and disputed', async () => {
    const empty = await call('GET', '/v1/balance');
    expect(empty.body).toMatchObject({
      object: 'balance',
      livemode: false,
      available: [{ amount: 0, currency: 'usd' }],
      pending: [{ amount: 0, currency: 'usd' }],
    });
    const { charge } = await pay(6000);
    await pay(4000, { card: 'pm_card_createDispute' });
    await call('POST', '/v1/refunds', { charge, amount: 2500 });
    advance(5);
    const balance = await call('GET', '/v1/balance');
    expect(at(balance.body, 'pending', 0, 'amount')).toBe(6000 + 4000 - 2500 - 4000);
  });
});

describe('the model, in process', () => {
  it('can be inspected and reset without going through HTTP', async () => {
    const { charge } = await pay(1000);
    expect(twin.model.find('charge', charge)?.amount).toBe(1000);
    const copy = twin.model.find('charge', charge)!;
    copy.amount = 1;
    expect(twin.model.find('charge', charge)?.amount).toBe(1000);
    twin.model.reset();
    expect(twin.model.all('charge')).toEqual([]);
    expectError(await call('GET', `/v1/charges/${charge}`), 404, 'resource_missing');
  });
});
