/**
 * Opening a Stripe session, and one case run through it as the runner runs
 * one: where it may point, which key it will hold, that a single live-mode
 * object ends it, and that a case comes back bound, read and described.
 */
import { describe, expect, it, vi } from 'vitest';
import { PackEnvironment, type PackOpenOptions } from '@rigorrun/environment';
import {
  KeyGuardError,
  LIVE_URL,
  LiveModeRefused,
  StripeHostRefused,
  openStripeSession,
  stripePack,
  type StripeSessionDeps,
} from '../src/index.ts';
import { FakeStripe } from './fakeStripe.ts';

const ctx = { runId: 'run1', caseId: 'full_refund', agentId: 'correct', attempt: 0 };

/** `null` stands for a secret that is not stored: `undefined` would take the default. */
function opening(overrides: Partial<PackOpenOptions> = {}, key: string | null = 'sk_test_abc') {
  const secret = vi.fn((_name: string) => key ?? undefined);
  return { options: { mode: 'twin' as const, secret, ...overrides }, secret };
}

function wired(fake: FakeStripe) {
  const urls: string[] = [];
  const deps: StripeSessionDeps = {
    fetch: async (input, init) => {
      urls.push(String(input));
      return fake.fetch(input, init);
    },
    sleep: async () => {},
  };
  return { deps, urls };
}

describe('opening a session', () => {
  it('against the twin: loopback, simulated, local by default', async () => {
    const fake = new FakeStripe();
    const { deps, urls } = wired(fake);
    const { options, secret } = opening();
    const session = await openStripeSession(options, deps);
    expect(session).toMatchObject({ system: 'The Stripe twin', simulated: true, safety: 'local' });
    expect(secret).toHaveBeenCalledWith('stripe_test_key');
    expect(urls).toEqual(['http://127.0.0.1:12112/v1/balance']);
  });

  it('against test mode: api.stripe.com, real, staging by default', async () => {
    const fake = new FakeStripe();
    const { deps, urls } = wired(fake);
    const { options } = opening({ mode: 'live', keySecret: 'acme_stripe' });
    const session = await openStripeSession(options, deps);
    expect(session).toMatchObject({ system: 'Stripe', simulated: false, safety: 'staging' });
    expect(urls).toEqual([`${LIVE_URL}/v1/balance`]);
    expect(options.secret).toHaveBeenCalledWith('acme_stripe');
  });

  it('refuses a twin that is not on this machine, and test mode that is not Stripe', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const overrides of [
      { mode: 'twin' as const, baseUrl: 'https://api.stripe.com' },
      { mode: 'twin' as const, baseUrl: 'http://192.168.1.10:12112' },
      { mode: 'live' as const, baseUrl: 'http://127.0.0.1:12112' },
      { mode: 'live' as const, baseUrl: 'https://stripe.example.com' },
    ]) {
      const { options, secret } = opening(overrides);
      await expect(openStripeSession(options, { fetch }), overrides.baseUrl).rejects.toBeInstanceOf(
        StripeHostRefused,
      );
      expect(secret).not.toHaveBeenCalled();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks the key before any request is made', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const [key, reason] of [
      [null, 'missing'],
      ['sk_live_real_money', 'live'],
      ['pk_test_publishable', 'prefix'],
    ] as const) {
      const { options } = opening({}, key);
      const failure = await openStripeSession(options, { fetch }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(KeyGuardError);
      expect(failure).toMatchObject({ reason });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a key Stripe says is live', async () => {
    const fake = new FakeStripe();
    fake.enqueue({ status: 200, body: { object: 'balance', livemode: true } });
    const { options } = opening();
    await expect(openStripeSession(options, wired(fake).deps)).rejects.toMatchObject({
      reason: 'live_balance',
    });
  });

  it('refuses to be production, and refuses options it does not know', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      openStripeSession(opening({ options: { safety: 'production' } }).options, { fetch }),
    ).rejects.toThrow(/cannot be marked production/);
    await expect(
      openStripeSession(opening({ options: { saftey: 'staging' } }).options, { fetch }),
    ).rejects.toThrow(/options are not valid/);
    expect(fetch).not.toHaveBeenCalled();

    const session = await openStripeSession(
      opening({ options: { safety: 'ephemeral' } }).options,
      wired(new FakeStripe()).deps,
    );
    expect(session.safety).toBe('ephemeral');
  });
});

describe('a live-mode object anywhere', () => {
  it('ends the session: every later call is refused without being sent', async () => {
    const fake = new FakeStripe({
      tamper: (call, body) =>
        call.path === '/v1/payment_intents' ? { ...body, livemode: true } : body,
    });
    const session = await openStripeSession(opening().options, wired(fake).deps);
    await expect(session.materialize({ charge: { amount: 2500 } }, ctx)).rejects.toBeInstanceOf(
      LiveModeRefused,
    );
    const sent = fake.calls.length;
    await expect(session.materialize({ charge: { amount: 100 } }, ctx)).rejects.toBeInstanceOf(
      LiveModeRefused,
    );
    await expect(
      session.read({
        description: '',
        data: { customers: ['cus_1'], charges: ['ch_1'], createdGte: 1 },
      }),
    ).rejects.toBeInstanceOf(LiveModeRefused);
    await expect(session.execute('lookup_charge', { charge: 'ch_1' })).rejects.toBeInstanceOf(
      LiveModeRefused,
    );
    expect(fake.calls).toHaveLength(sent);
  });
});

describe('one case, as the runner runs it', () => {
  it('materializes, reads, acts, reads again and describes what Stripe holds', async () => {
    const fake = new FakeStripe();
    const session = await openStripeSession(opening().options, wired(fake).deps);
    const environment = new PackEnvironment(stripePack, session);

    expect(environment.capabilities()).toMatchObject({
      seed: 'materialized',
      reset: 'namespace',
      simulated: true,
      safety: 'local',
    });
    environment.reset();
    expect(await environment.getState()).toEqual({
      entities: { Customer: {}, Charge: {}, Refund: {}, Dispute: {} },
    });

    const made = await environment.materialize({ recipe: { charge: { amount: 2500 } } }, ctx);
    expect(made.readScope).toMatch(/^the customer, the charge and its refunds and disputes/);
    const charge = made.bindings['charge']!;

    const seed = await environment.getState();
    const result = await environment.executeAction('refund', { charge, amount: 25 });
    expect(result.ok).toBe(true);
    expect(environment.getEvents()).toEqual([
      expect.objectContaining({ type: 'refund', ok: true, payload: { charge, amount: 25 } }),
    ]);
    const final = await environment.getState();

    const reality = environment.describeReality(seed, final);
    expect(reality?.system).toBe('The Stripe twin');
    expect(reality?.lines).toEqual([
      expect.stringMatching(
        new RegExp(
          `^Refund re_\\w+ of \\$0\\.25 on ${charge} \\(a \\$25\\.00 charge\\), succeeded\\.$`,
        ),
      ),
    ]);

    await session.close();
    await expect(environment.getState()).rejects.toThrow(/closed/);
  });

  it('offers the catalogue through the environment', async () => {
    const session = await openStripeSession(opening().options, wired(new FakeStripe()).deps);
    const environment = new PackEnvironment(stripePack, session);
    expect(environment.getActions().map((action) => action.name)).toEqual([
      'refund',
      'lookup_charge',
      'list_refunds',
    ]);
  });
});
