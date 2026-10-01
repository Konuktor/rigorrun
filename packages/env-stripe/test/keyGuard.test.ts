/**
 * The key guard: a key's prefix is judged before anything is sent, and Stripe's
 * own word on the mode is required after. Each refusal says something
 * different, because each has a different fix.
 */
import { describe, expect, it } from 'vitest';
import {
  KeyGuardError,
  confirmTestMode,
  createStripeClient,
  guardKey,
  type KeyGuardReason,
} from '../src/index.ts';
import { FakeStripe } from './fakeStripe.ts';

function reasonOf(run: () => unknown): KeyGuardReason | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof KeyGuardError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('guardKey, before any request', () => {
  it('accepts test-mode secret and restricted keys', () => {
    expect(guardKey('sk_test_abc')).toBe('sk_test_abc');
    expect(guardKey('  rk_test_abc\n')).toBe('rk_test_abc');
  });

  it('refuses a missing key, a live key and anything else, each in its own words', () => {
    expect(reasonOf(() => guardKey(undefined))).toBe('missing');
    expect(reasonOf(() => guardKey('   '))).toBe('missing');
    expect(reasonOf(() => guardKey('sk_live_secret'))).toBe('live');
    expect(reasonOf(() => guardKey('rk_live_secret'))).toBe('live');
    expect(reasonOf(() => guardKey('pk_test_publishable'))).toBe('prefix');
    expect(reasonOf(() => guardKey('whsec_hook'))).toBe('prefix');

    const messages = new Set(
      ['', 'sk_live_secret', 'pk_test_publishable'].map((key) => {
        try {
          guardKey(key, 'my_secret');
        } catch (error) {
          return (error as Error).message;
        }
        return '';
      }),
    );
    expect(messages.size).toBe(3);
    for (const message of messages) {
      expect(message).toContain('my_secret');
      expect(message).not.toContain('live_secret');
      expect(message).not.toContain('publishable');
    }
  });
});

describe('confirmTestMode, after the prefix', () => {
  function client(fake: FakeStripe, key = 'sk_test_abc') {
    return createStripeClient({
      baseUrl: 'http://127.0.0.1:12112',
      key,
      fetch: fake.fetch,
      sleep: async () => {},
    });
  }

  it('passes when the balance answers livemode: false', async () => {
    const fake = new FakeStripe();
    await expect(confirmTestMode(client(fake), 'sk_test_abc')).resolves.toBeUndefined();
    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /v1/balance']);
  });

  it('refuses a key Stripe says is live, whatever its prefix', async () => {
    const fake = new FakeStripe();
    fake.enqueue({ status: 200, body: { object: 'balance', livemode: true, available: [] } });
    await expect(confirmTestMode(client(fake), 'sk_test_abc')).rejects.toMatchObject({
      reason: 'live_balance',
    });
  });

  it('refuses a balance that does not say which mode it is in', async () => {
    const fake = new FakeStripe();
    fake.enqueue({ status: 200, body: { object: 'balance', available: [] } });
    await expect(confirmTestMode(client(fake), 'sk_test_abc')).rejects.toMatchObject({
      reason: 'live_balance',
    });
  });

  it('says the key was not accepted when Stripe answers 401', async () => {
    const fake = new FakeStripe();
    fake.enqueue({
      status: 401,
      body: { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } },
    });
    await expect(confirmTestMode(client(fake), 'sk_test_abc')).rejects.toMatchObject({
      reason: 'auth',
    });
  });

  it('tells a restricted key what it needs when it cannot read the balance', async () => {
    const fake = new FakeStripe();
    fake.enqueue({
      status: 403,
      body: { error: { type: 'permission_error', message: 'The provided key does not have…' } },
    });
    const error = await confirmTestMode(client(fake, 'rk_test_abc'), 'rk_test_abc').catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ reason: 'permission' });
    expect((error as Error).message).toMatch(/Balance.*Customers, PaymentIntents and Refunds/s);
  });
});
