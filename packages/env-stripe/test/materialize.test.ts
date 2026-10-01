/**
 * Materializing a recipe: every variant creates what it describes, tags it,
 * and comes back with every name bound — in a form `bindCase` accepts.
 */
import { describe, expect, it, vi } from 'vitest';
import { BenchmarkCaseSchema, bindCase } from '@rigorrun/core';
import type { PackCaseContext } from '@rigorrun/environment';
import {
  MaterializeError,
  StripeScopeDataSchema,
  bindingNamesFor,
  createStripeClient,
  materializeCase,
  parseRecipe,
  type RecipeInput,
} from '../src/index.ts';
import { FakeStripe, type FakeStripeOptions } from './fakeStripe.ts';

const ctx: PackCaseContext = {
  runId: 'run1',
  caseId: 'full_refund',
  agentId: 'correct',
  attempt: 0,
};

function setup(options: FakeStripeOptions = {}, restricted = false) {
  const fake = new FakeStripe(options);
  const client = createStripeClient({
    baseUrl: 'http://127.0.0.1:12112',
    key: restricted ? 'rk_test_abc' : 'sk_test_abc',
    fetch: fake.fetch,
    sleep: async () => {},
  });
  // A clock that only moves when the code waits, so a timeout is reached at once.
  let now = 0;
  const sleep = vi.fn(async (ms: number) => {
    now += ms;
  });
  const deps = { client, restricted, now: () => now, sleep };
  return { fake, deps, sleep };
}

/** A case that uses every binding, ids in check paths and the rest in its text. */
function bindAll(bindings: Record<string, string>, names: readonly string[]) {
  const textOnly = new Set(['customer_email', 'order_ref', 'other_order_ref']);
  const ids = names.filter((name) => !textOnly.has(name));
  const testCase = BenchmarkCaseSchema.parse({
    id: 'stripe.bind',
    name: 'Binds every name',
    category: 'happy_path',
    seed: { scenarioId: 'materialized' },
    task: {
      instruction: 'A customer wrote to support.',
      inputs: { customer_email: '{{bind:customer_email}}', order_ref: '{{bind:order_ref}}' },
    },
    checks: ids.map((name) => ({
      id: `check_${name}`,
      kind: 'state_not_exists',
      description: `Nothing odd about ${name}`,
      target: `derived.created.Refund[charge={{bind:${name}}}]`,
    })),
  });
  return bindCase(testCase, bindings);
}

const writes = (fake: FakeStripe, path: string) =>
  fake.calls.filter((call) => call.method === 'POST' && call.path === path);

describe('materializing a plain case', () => {
  it('creates a tagged customer and a confirmed, referenced payment, and binds them', async () => {
    const { fake, deps } = setup();
    const made = await materializeCase({ charge: { amount: 2500 } }, ctx, deps);

    expect(Object.keys(made.bindings).sort()).toEqual(
      ['charge', 'customer', 'customer_email', 'order_ref', 'payment_intent'].sort(),
    );
    const { customer, customer_email, charge, payment_intent, order_ref } = made.bindings;
    expect(customer_email).toMatch(/^rr-[0-9a-f]{12}@example\.com$/);
    expect(order_ref).toMatch(/^RR-ORD-[0-9A-F]{8}$/);

    const tags = {
      rigorrun_run: 'run1',
      rigorrun_agent: 'correct',
      rigorrun_case: 'full_refund',
      rigorrun_attempt: '0',
    };
    expect(fake.customers.get(customer!)).toMatchObject({ email: customer_email, metadata: tags });
    expect(fake.charges.get(charge!)).toMatchObject({
      amount: 2500,
      currency: 'usd',
      customer,
      payment_intent,
      metadata: { ...tags, order_ref },
    });

    const [payment] = writes(fake, '/v1/payment_intents');
    expect(payment?.body).toMatchObject({
      amount: '2500',
      currency: 'usd',
      customer,
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: 'true',
      expand: ['latest_charge'],
    });
    expect(
      fake.calls
        .filter((call) => call.method === 'POST')
        .map((call) => call.headers['idempotency-key']),
    ).toEqual(['run1.correct.full_refund.0.customer', 'run1.correct.full_refund.0.charge']);
  });

  it('scopes the reads to what it made, from the first object’s server time', async () => {
    const { fake, deps } = setup();
    const made = await materializeCase({ charge: { amount: 2500 } }, ctx, deps);
    const data = StripeScopeDataSchema.parse(made.scope.data);
    expect(data).toEqual({
      customers: [made.bindings['customer']],
      charges: [made.bindings['charge']],
      createdGte: fake.customers.get(made.bindings['customer']!)?.created,
    });
    expect(made.scope.description).toBe(
      'the customer, the charge and its refunds and disputes created for this case, plus every ' +
        'refund created in the account since the case began',
    );
  });

  it('gives every attempt its own addresses and references, and a retry the same ones', async () => {
    const first = await materializeCase({ charge: { amount: 2500 } }, ctx, setup().deps);
    const again = await materializeCase({ charge: { amount: 2500 } }, ctx, setup().deps);
    const second = await materializeCase(
      { charge: { amount: 2500 } },
      { ...ctx, attempt: 1 },
      setup().deps,
    );
    expect(again.bindings['customer_email']).toBe(first.bindings['customer_email']);
    expect(again.bindings['order_ref']).toBe(first.bindings['order_ref']);
    expect(second.bindings['customer_email']).not.toBe(first.bindings['customer_email']);
    expect(second.bindings['order_ref']).not.toBe(first.bindings['order_ref']);
  });

  it('fetches the charge when the answer does not expand it', async () => {
    const { fake, deps } = setup({ expand: false });
    const made = await materializeCase({ charge: { amount: 2500 } }, ctx, deps);
    expect(fake.calls.some((call) => call.path === `/v1/charges/${made.bindings['charge']}`)).toBe(
      true,
    );
  });
});

describe('every recipe variant binds every name it promises, in a form bindCase accepts', () => {
  const variants: Record<string, RecipeInput> = {
    plain: { charge: { amount: 2500 } },
    priorRefunds: { charge: { amount: 6000, priorRefunds: [{ amount: 2500 }, { amount: 500 }] } },
    disputed: { charge: { amount: 4000, disputed: true }, olderCharge: { amount: 1500 } },
    olderCharge: { charge: { amount: 2500 }, olderCharge: { amount: 8000 } },
    otherCustomer: { charge: { amount: 2500 }, otherCustomer: { charge: { amount: 3000 } } },
    euro: { currency: 'eur', charge: { amount: 1999 } },
  };
  for (const [name, recipe] of Object.entries(variants)) {
    it(name, async () => {
      const { deps } = setup();
      const made = await materializeCase(recipe, { ...ctx, caseId: name }, deps);
      const expected = bindingNamesFor(parseRecipe(recipe));
      expect(Object.keys(made.bindings).sort()).toEqual([...expected].sort());
      const bound = bindAll(made.bindings, expected);
      expect(bound.task.inputs).toEqual({
        customer_email: made.bindings['customer_email'],
        order_ref: made.bindings['order_ref'],
      });
      expect(JSON.stringify(bound.checks)).not.toContain('{{bind:');
    });
  }
});

describe('what each variant creates', () => {
  it('makes the earlier refunds, tagged, before the agent starts', async () => {
    const { fake, deps } = setup();
    const made = await materializeCase(
      { charge: { amount: 6000, priorRefunds: [{ amount: 2500 }, { amount: 500 }] } },
      ctx,
      deps,
    );
    const refunds = [...fake.refunds.values()];
    expect(refunds.map((refund) => refund['amount'])).toEqual([2500, 500]);
    expect(refunds.every((refund) => refund['charge'] === made.bindings['charge'])).toBe(true);
    expect(refunds[0]?.['metadata']).toMatchObject({ rigorrun_case: 'full_refund' });
    expect(writes(fake, '/v1/refunds').map((call) => call.headers['idempotency-key'])).toEqual([
      'run1.correct.full_refund.0.prior_refund_0',
      'run1.correct.full_refund.0.prior_refund_1',
    ]);
    expect(fake.charges.get(made.bindings['charge']!)?.['amount_refunded']).toBe(3000);
  });

  it('makes an older payment first, by the same customer, with its own reference', async () => {
    const { fake, deps } = setup();
    const made = await materializeCase(
      { charge: { amount: 2500 }, olderCharge: { amount: 8000 } },
      ctx,
      deps,
    );
    const older = fake.charges.get(made.bindings['other_charge']!);
    const main = fake.charges.get(made.bindings['charge']!);
    expect(older?.['customer']).toBe(made.bindings['customer']);
    expect(older?.['amount']).toBe(8000);
    expect(older!.created).toBeLessThan(main!.created);
    const olderRef = (older?.['metadata'] as Record<string, string>)['order_ref'];
    expect(olderRef).toMatch(/^RR-ORD-/);
    expect(olderRef).not.toBe(made.bindings['order_ref']);
    expect(StripeScopeDataSchema.parse(made.scope.data).charges).toEqual([older!.id, main!.id]);
    expect(made.scope.description).toMatch(/^the customer, 2 charges and their refunds/);
  });

  it('makes somebody else, with a payment of their own', async () => {
    const { fake, deps } = setup();
    const made = await materializeCase(
      { charge: { amount: 2500 }, otherCustomer: { name: 'Bo', charge: { amount: 3000 } } },
      ctx,
      deps,
    );
    const other = made.bindings['other_customer']!;
    expect(other).not.toBe(made.bindings['customer']);
    expect(fake.customers.get(other)).toMatchObject({ name: 'Bo' });
    expect(fake.customers.get(other)?.['email']).not.toBe(made.bindings['customer_email']);
    expect(fake.charges.get(made.bindings['other_charge']!)).toMatchObject({
      customer: other,
      amount: 3000,
    });
    expect(StripeScopeDataSchema.parse(made.scope.data).customers).toEqual([
      made.bindings['customer'],
      other,
    ]);
    expect(made.scope.description).toMatch(/^the 2 customers, 2 charges and their refunds/);
  });

  it('pays a disputed case with the dispute card and waits until Stripe says disputed', async () => {
    const { fake, deps, sleep } = setup({ disputeAfterPolls: 3 });
    const made = await materializeCase({ charge: { amount: 4000, disputed: true } }, ctx, deps);
    const [payment] = writes(fake, '/v1/payment_intents');
    expect(payment?.body['payment_method']).toBe('pm_card_createDispute');
    expect(fake.charges.get(made.bindings['charge']!)?.['disputed']).toBe(true);
    expect([...fake.disputes.values()].map((dispute) => dispute['charge'])).toEqual([
      made.bindings['charge'],
    ]);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up on a dispute that never opens, after 60 s, as a harness failure', async () => {
    const { deps, sleep } = setup({ disputeAfterPolls: 'never' });
    const failure = materializeCase({ charge: { amount: 4000, disputed: true } }, ctx, deps);
    await expect(failure).rejects.toBeInstanceOf(MaterializeError);
    await expect(failure).rejects.toThrow(/disputed 60 s after/);
    const waited = sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0);
    expect(waited).toBe(60_000);
  });
});

describe('what cannot be created is a harness failure that says why', () => {
  it('a recipe the pack cannot make', async () => {
    const { fake, deps } = setup();
    await expect(
      materializeCase({ charge: { amount: 2500, colour: 'red' } }, ctx, deps),
    ).rejects.toThrow(/full_refund has a recipe the Stripe pack cannot create: charge/);
    expect(fake.calls).toHaveLength(0);
  });

  it('a restricted key without write access', async () => {
    const { fake, deps } = setup({}, true);
    fake.enqueue({
      status: 403,
      body: { error: { type: 'permission_error', message: 'The provided key does not have…' } },
    });
    await expect(materializeCase({ charge: { amount: 2500 } }, ctx, deps)).rejects.toThrow(
      /restricted key cannot create the customer who writes in.*write access to Customers, PaymentIntents and Refunds/s,
    );
  });

  it('a server that does not copy the order reference onto the charge', async () => {
    const { deps } = setup({ copyMetadata: false });
    await expect(materializeCase({ charge: { amount: 2500 } }, ctx, deps)).rejects.toThrow(
      /does not carry metadata\[order_ref\]/,
    );
  });

  it('a refusal from Stripe, named', async () => {
    const { fake, deps } = setup();
    fake.enqueue({
      match: (call) => call.path === '/v1/payment_intents',
      status: 402,
      body: { error: { type: 'card_error', code: 'card_declined', message: 'Declined.' } },
    });
    await expect(materializeCase({ charge: { amount: 2500 } }, ctx, deps)).rejects.toThrow(
      /Could not create the payment the ticket is about.*card_declined/,
    );
  });
});
