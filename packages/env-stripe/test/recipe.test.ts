/**
 * Recipes, the names they bind, and the conventions every part of the pack
 * meets at.
 */
import { describe, expect, it } from 'vitest';
import {
  BINDING_NAMES,
  KEY_SECRET,
  METADATA_KEYS,
  STRIPE_ERROR_CODES,
  TWIN_URL,
  bindingNamesFor,
  caseMetadata,
  idempotencyKey,
  isStripeErrorBody,
  parseRecipe,
} from '../src/index.ts';

describe('a recipe', () => {
  it('describes each situation the suite needs', () => {
    const situations = {
      full: { charge: { amount: 2500 } },
      units: { charge: { amount: 4999 } },
      partial: { charge: { amount: 6000 } },
      alreadyRefunded: { charge: { amount: 6000, priorRefunds: [{ amount: 2500 }] } },
      disputed: { charge: { amount: 2500, disputed: true }, olderCharge: { amount: 1800 } },
      otherCustomer: { charge: { amount: 2500 }, otherCustomer: { charge: { amount: 4000 } } },
      overThreshold: { charge: { amount: 25000 } },
    };
    for (const [name, recipe] of Object.entries(situations)) {
      expect(() => parseRecipe(recipe), name).not.toThrow();
    }
  });

  it('fills in what a suite author may leave out', () => {
    expect(parseRecipe({ charge: { amount: 2500 } })).toEqual({
      currency: 'usd',
      customer: { name: 'RigorRun test customer' },
      charge: { amount: 2500, priorRefunds: [], disputed: false },
    });
  });

  it('refuses a misspelt key rather than creating a different situation', () => {
    expect(() => parseRecipe({ charge: { amount: 2500, dispute: true } })).toThrow();
    expect(() => parseRecipe({ charge: { amount: 2500 }, olderCharges: [] })).toThrow();
  });

  it('refuses an amount that is not whole minor units', () => {
    expect(() => parseRecipe({ charge: { amount: 49.99 } })).toThrow();
    expect(() => parseRecipe({ charge: { amount: 0 } })).toThrow();
    expect(() => parseRecipe({ currency: 'USD', charge: { amount: 100 } })).toThrow();
  });

  it('refuses a situation Stripe could not be put into', () => {
    expect(() =>
      parseRecipe({ charge: { amount: 2500, priorRefunds: [{ amount: 2000 }, { amount: 600 }] } }),
    ).toThrow(/more than the charge/);
    expect(() =>
      parseRecipe({ charge: { amount: 2500, disputed: true, priorRefunds: [{ amount: 100 }] } }),
    ).toThrow(/disputed charge/);
    expect(() =>
      parseRecipe({
        charge: { amount: 1 },
        olderCharge: { amount: 1 },
        otherCustomer: { charge: { amount: 1 } },
      }),
    ).toThrow(/other_charge/);
  });

  it('binds the names its situation has, and only those', () => {
    const base = ['customer', 'customer_email', 'payment_intent', 'charge', 'order_ref'];
    expect(bindingNamesFor(parseRecipe({ charge: { amount: 1 } }))).toEqual(base);
    expect(
      bindingNamesFor(parseRecipe({ charge: { amount: 1 }, olderCharge: { amount: 1 } })),
    ).toEqual([...base, 'other_charge']);
    expect(
      bindingNamesFor(
        parseRecipe({ charge: { amount: 1 }, otherCustomer: { charge: { amount: 1 } } }),
      ),
    ).toEqual([...base, 'other_customer', 'other_charge']);
    // Every name is one a check path can carry, by the binding rules in core.
    for (const name of BINDING_NAMES) expect(name).toMatch(/^[A-Za-z0-9_]+$/);
  });
});

describe('the conventions', () => {
  const ctx = { runId: 'run_1', agentId: 'agent_a', caseId: 'stripe.full', attempt: 2 };

  it('are the ones the docs promise', () => {
    expect(TWIN_URL).toBe('http://127.0.0.1:12112');
    expect(KEY_SECRET).toBe('stripe_test_key');
    expect(Object.values(METADATA_KEYS)).toEqual([
      'rigorrun_run',
      'rigorrun_agent',
      'rigorrun_case',
      'rigorrun_attempt',
    ]);
  });

  it('label every object with who made it', () => {
    expect(caseMetadata(ctx)).toEqual({
      rigorrun_run: 'run_1',
      rigorrun_agent: 'agent_a',
      rigorrun_case: 'stripe.full',
      rigorrun_attempt: '2',
    });
  });

  it('give two agents in one run different idempotency keys for the same step', () => {
    const mine = idempotencyKey(ctx, 'customer');
    expect(mine).toBe('run_1.agent_a.stripe.full.2.customer');
    expect(idempotencyKey({ ...ctx, agentId: 'agent_b' }, 'customer')).not.toBe(mine);
    expect(idempotencyKey({ ...ctx, attempt: 3 }, 'customer')).not.toBe(mine);
  });
});

describe('the wire', () => {
  it('recognises Stripe’s error shape, including codes it has not heard of', () => {
    expect(
      isStripeErrorBody({
        error: {
          type: 'invalid_request_error',
          code: 'charge_already_refunded',
          message: 'Charge already refunded.',
        },
      }),
    ).toBe(true);
    expect(isStripeErrorBody({ error: { type: 'rate_limit_error', message: 'Slow down.' } })).toBe(
      true,
    );
    expect(isStripeErrorBody({ id: 're_1', object: 'refund' })).toBe(false);
    expect(isStripeErrorBody({ error: 'nope' })).toBe(false);
    expect(isStripeErrorBody(null)).toBe(false);
  });

  it('names every refusal the cases depend on', () => {
    expect([...STRIPE_ERROR_CODES].sort()).toEqual([
      'amount_too_large',
      'charge_already_refunded',
      'charge_disputed',
      'idempotency_error',
      'parameter_invalid_integer',
      'parameter_missing',
      'resource_missing',
    ]);
  });
});
