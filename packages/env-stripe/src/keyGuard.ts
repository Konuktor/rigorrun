/**
 * The key guard: proof that a key is a test-mode key, before it is used.
 *
 * Two steps, in this order. The prefix is checked before anything touches the
 * network, so a live key is refused without ever being sent anywhere. Then
 * `GET /v1/balance` must answer `livemode: false`: a prefix is a convention,
 * and the balance is Stripe's own statement of which mode the key is in.
 *
 * Each refusal says something different, because each has a different fix:
 * no key stored, a live key, something that is not a secret key at all, a key
 * Stripe says is live, a key Stripe does not accept, and a restricted key that
 * lacks a permission the pack needs.
 */
import { KEY_SECRET, TEST_KEY_PREFIXES } from './conventions.ts';
import { LiveModeRefused, StripeApiError, type StripeClient } from './client.ts';
import type { StripeBalance } from './wire.ts';

export type KeyGuardReason = 'missing' | 'live' | 'prefix' | 'live_balance' | 'auth' | 'permission';

/** A key the pack will not use, and why. The message never contains the key. */
export class KeyGuardError extends Error {
  constructor(
    readonly reason: KeyGuardReason,
    message: string,
  ) {
    super(message);
    this.name = 'KeyGuardError';
  }
}

/** Live keys, refused with their own message so nobody mistakes it for a typo. */
const LIVE_PREFIXES = ['sk_live_', 'rk_live_'] as const;

/**
 * The key, if its prefix says test mode. Makes no network call.
 *
 * `secretName` is only for the message: it tells a person where the key was
 * looked for, so they know what to fix.
 */
export function guardKey(key: string | undefined, secretName: string = KEY_SECRET): string {
  const trimmed = key?.trim() ?? '';
  if (trimmed === '') {
    throw new KeyGuardError(
      'missing',
      `No Stripe key is stored under "${secretName}". Store a test-mode secret key ` +
        `(${TEST_KEY_PREFIXES.join('… or ')}…) there; RigorRun never reads one from the project file.`,
    );
  }
  if (LIVE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    throw new KeyGuardError(
      'live',
      `The key stored under "${secretName}" is a live-mode key. RigorRun only uses test-mode keys ` +
        `(${TEST_KEY_PREFIXES.join('… or ')}…): it creates customers, payments and refunds for ` +
        'every case. Nothing was sent.',
    );
  }
  if (!TEST_KEY_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    const shape = /^[a-z]{2,8}_(?:test|live)_/.exec(trimmed)?.[0];
    const seen =
      shape === undefined ? 'It does not look like a Stripe key.' : `It begins ${shape}.`;
    throw new KeyGuardError(
      'prefix',
      `The key stored under "${secretName}" is not a test-mode secret or restricted key: those ` +
        `begin ${TEST_KEY_PREFIXES.join(' or ')}. ${seen} Nothing was sent.`,
    );
  }
  return trimmed;
}

/** Whether a key is a restricted key, which may lack the permissions to create objects. */
export function isRestrictedKey(key: string): boolean {
  return key.startsWith('rk_');
}

/**
 * Asks Stripe which mode the key is in, and refuses anything but test mode.
 *
 * The client stops by itself on any `livemode: true`; that is translated here
 * into the guard's own message, because at this point it means the key, not a
 * stray object.
 */
export async function confirmTestMode(client: StripeClient, key: string): Promise<void> {
  let balance: StripeBalance;
  try {
    balance = await client.get<StripeBalance>('/v1/balance');
  } catch (error) {
    if (error instanceof LiveModeRefused) {
      throw new KeyGuardError(
        'live_balance',
        'Stripe says this key is in live mode (GET /v1/balance answered livemode: true), whatever ' +
          'its prefix. RigorRun stopped and will not use it.',
      );
    }
    if (error instanceof StripeApiError && error.status === 401) {
      throw new KeyGuardError(
        'auth',
        `Stripe at ${client.baseUrl} did not accept the key (401 ${error.type}). Check that it ` +
          'is a current test-mode key for the account, and that it has not been rolled.',
      );
    }
    if (
      error instanceof StripeApiError &&
      (error.status === 403 || error.type === 'permission_error')
    ) {
      throw new KeyGuardError(
        'permission',
        isRestrictedKey(key)
          ? 'This restricted key cannot read the balance, which is how RigorRun confirms a key ' +
              'is in test mode. Give it read access to Balance — and, to create each case, write ' +
              'access to Customers, PaymentIntents and Refunds — or use a secret test key (sk_test_…).'
          : `Stripe refused GET /v1/balance (${error.status} ${error.type}), so RigorRun cannot ` +
              'confirm the key is in test mode.',
      );
    }
    throw error;
  }
  if (balance.livemode !== false) {
    throw new KeyGuardError(
      'live_balance',
      'Stripe did not say this key is in test mode (GET /v1/balance answered without ' +
        'livemode: false). RigorRun stopped and will not use it.',
    );
  }
}
