/**
 * The operations offered to an agent RigorRun drives: thin, faithful to what
 * Stripe accepts and refuses, and never a way around the session's stop.
 */
import { describe, expect, it } from 'vitest';
import type { PackCaseContext } from '@rigorrun/environment';
import {
  LiveModeRefused,
  STRIPE_ACTIONS,
  createStripeClient,
  executeStripeAction,
  materializeCase,
} from '../src/index.ts';
import { FakeStripe } from './fakeStripe.ts';

const ctx: PackCaseContext = { runId: 'run1', caseId: 'case1', agentId: 'agent1', attempt: 0 };

async function setup(recipe: unknown = { charge: { amount: 6000 } }) {
  const fake = new FakeStripe();
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
  const run = (name: string, args: Record<string, unknown>) =>
    executeStripeAction(client, name, args);
  return { fake, run, bindings: made.bindings };
}

describe('the catalogue', () => {
  it('offers a refund and two reads, with their parameters declared', () => {
    expect(STRIPE_ACTIONS.map((action) => [action.name, action.readOnly])).toEqual([
      ['refund', false],
      ['lookup_charge', true],
      ['list_refunds', true],
    ]);
    const refund = STRIPE_ACTIONS[0]!;
    expect(refund.mutates).toEqual(['Refund', 'Charge']);
    expect(refund.params.map((param) => [param.name, param.type, param.required])).toEqual([
      ['charge', 'string', true],
      ['amount', 'number', false],
      ['reason', 'enum', false],
    ]);
  });
});

describe('refund', () => {
  it('refunds what it is asked to, as it is asked to', async () => {
    const { fake, run, bindings } = await setup();
    const result = await run('refund', { charge: bindings['charge'], amount: 2500 });
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        charge: bindings['charge'],
        amount: 2500,
        status: 'succeeded',
      }),
    });
    const call = fake.calls.at(-1);
    expect(call?.path).toBe('/v1/refunds');
    expect(call?.body).toEqual({ charge: bindings['charge'], amount: '2500' });
    expect(call?.headers['idempotency-key']).toMatch(/^rigorrun-/);
  });

  it('passes Stripe’s refusals back as results', async () => {
    const { run, bindings } = await setup();
    expect(await run('refund', { charge: bindings['charge'], amount: 9000 })).toMatchObject({
      ok: false,
      error: { code: 'amount_too_large' },
    });
    expect(await run('refund', { charge: bindings['charge'], amount: 25.5 })).toMatchObject({
      ok: false,
      error: { code: 'parameter_invalid_integer' },
    });
    await run('refund', { charge: bindings['charge'] });
    expect(await run('refund', { charge: bindings['charge'] })).toMatchObject({
      ok: false,
      error: { code: 'charge_already_refunded' },
    });
  });

  it('refuses arguments it cannot send, without sending anything', async () => {
    const { fake, run } = await setup();
    const before = fake.calls.length;
    for (const args of [{}, { charge: '../balance' }, { charge: 'ch_1', colour: 'red' }]) {
      expect(await run('refund', args)).toMatchObject({
        ok: false,
        error: { code: 'invalid_arguments' },
      });
    }
    expect(await run('lookup_charge', { charge: 'ch_1/x' })).toMatchObject({ ok: false });
    expect(fake.calls).toHaveLength(before);
  });
});

describe('the reads', () => {
  it('looks a charge up with its order reference and its customer’s address', async () => {
    const { run, bindings } = await setup();
    expect(await run('lookup_charge', { charge: bindings['charge'] })).toEqual({
      ok: true,
      data: {
        id: bindings['charge'],
        amount: 6000,
        currency: 'usd',
        amount_refunded: 0,
        refunded: false,
        disputed: false,
        status: 'succeeded',
        payment_intent: bindings['payment_intent'],
        order_ref: bindings['order_ref'],
        customer: bindings['customer'],
        customer_email: bindings['customer_email'],
      },
    });
    expect(await run('lookup_charge', { charge: 'ch_nope' })).toMatchObject({
      ok: false,
      error: { code: 'resource_missing' },
    });
  });

  it('lists the refunds already made on a charge', async () => {
    const { run, bindings } = await setup({
      charge: { amount: 6000, priorRefunds: [{ amount: 2500 }] },
    });
    const result = await run('list_refunds', { charge: bindings['charge'] });
    expect(result).toMatchObject({
      ok: true,
      data: { complete: true, refunds: [expect.objectContaining({ amount: 2500 })] },
    });
  });

  it('names the operations when asked for one that does not exist', async () => {
    const { run } = await setup();
    expect(await run('delete_customer', {})).toMatchObject({
      ok: false,
      error: { code: 'unknown_action', message: expect.stringContaining('refund, lookup_charge') },
    });
  });
});

describe('a live-mode answer', () => {
  it('is thrown, not handed to the agent as a result', async () => {
    const { fake, run, bindings } = await setup();
    fake.enqueue({
      status: 200,
      body: { id: bindings['charge'], object: 'charge', livemode: true },
    });
    await expect(run('lookup_charge', { charge: bindings['charge'] })).rejects.toBeInstanceOf(
      LiveModeRefused,
    );
  });
});
