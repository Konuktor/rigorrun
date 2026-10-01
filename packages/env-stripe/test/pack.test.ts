/**
 * The Stripe pack as it is registered: its identity, its schema, what it says
 * before a project is trusted, and that registering it twice is harmless.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  PackEnvironment,
  clearPacks,
  getPack,
  listPacks,
  validateSchema,
} from '@rigorrun/environment';
import {
  KeyGuardError,
  STRIPE_PACK_ID,
  StripeHostRefused,
  registerStripePack,
  stripePack,
  stripeSchema,
} from '../src/index.ts';

afterEach(() => clearPacks());

describe('the Stripe pack', () => {
  it('is named, carries the schema, and leaves its suite and command line to their own modules', () => {
    expect(stripePack.id).toBe(STRIPE_PACK_ID);
    expect(stripePack.name).toBe('Stripe (test mode)');
    expect(stripePack.schema).toBe(stripeSchema);
    expect(validateSchema(stripePack.schema)).toEqual([]);
    expect(stripePack.suite).toBeUndefined();
    expect(stripePack.cli).toBeUndefined();
  });

  it('presents only entities and actions it has', () => {
    const hints = stripePack.presentation!;
    const entities = new Set(stripeSchema.entities.map((entity) => entity.name));
    expect(hints.navEntities.every((name) => entities.has(name))).toBe(true);
    expect(entities.has(hints.focusEntity)).toBe(true);
    for (const presentation of hints.entities ?? []) {
      const entity = stripeSchema.entities.find(
        (candidate) => candidate.name === presentation.entity,
      );
      const fields = new Set(entity?.fields.map((field) => field.name));
      for (const column of presentation.columns) expect(fields.has(column.field)).toBe(true);
    }
  });

  it('says where it will call and with which secret, before anything is trusted', () => {
    expect(stripePack.describeAction({ mode: 'twin' })).toBe(
      'Calls the local Stripe twin at http://127.0.0.1:12112 with the test key stored as ' +
        '"stripe_test_key", and creates each case\'s customers and payments there.',
    );
    const live = stripePack.describeAction({ mode: 'live', keySecret: 'acme_stripe' });
    expect(live).toContain('https://api.stripe.com');
    expect(live).toContain('"acme_stripe"');
    expect(live).toContain('test-mode key');
  });

  it('opens nothing it should not: a bad address or a live key fails before any request', async () => {
    await expect(
      stripePack.open({ mode: 'twin', baseUrl: 'https://example.com', secret: () => 'sk_test_x' }),
    ).rejects.toBeInstanceOf(StripeHostRefused);
    await expect(
      stripePack.open({ mode: 'live', secret: () => 'sk_live_real_money' }),
    ).rejects.toBeInstanceOf(KeyGuardError);
  });
});

describe('registering the pack', () => {
  it('makes it available by id, once, however often it is called', () => {
    expect(registerStripePack()).toBe(stripePack);
    registerStripePack();
    expect(listPacks()).toEqual([stripePack]);
    expect(getPack('stripe')).toBe(stripePack);
  });

  it('gives the runner an environment presented as the pack declares', () => {
    registerStripePack();
    const session = {
      system: 'Stripe',
      safety: 'staging' as const,
      simulated: false,
      materialize: async () => ({ bindings: {}, scope: { description: '', data: null } }),
      read: async () => ({ entities: {} }),
      actions: () => [],
      execute: async () => ({ ok: true }),
      close: async () => {},
    };
    const environment = new PackEnvironment(getPack('stripe'), session);
    expect(environment.describePresentation().label).toBe('Stripe (test mode)');
  });
});
