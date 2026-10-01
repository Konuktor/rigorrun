/**
 * One open connection to Stripe, shared by every case of a run.
 *
 * Opening it is where the safety rules meet: the mode decides where the client
 * may point (the twin on this machine, or `api.stripe.com`), the key guard
 * checks the key's prefix before anything is sent and then asks Stripe which
 * mode the key is in, and a connection marked production is refused outright —
 * every case creates objects, and there is no such thing as a read-only Stripe
 * pack.
 *
 * The session holds the client and nothing about any one case. The one thing
 * it remembers between calls is the currency of each charge and refund it has
 * read, which is a fact about that object and not about a case: Stripe never
 * reuses an id, so no case can see another's through it.
 */
import { z } from 'zod';
import type {
  ActionDefinition,
  ActionResult,
  CanonicalState,
  PackBindings,
  PackCaseContext,
  PackMaterialization,
  PackOpenOptions,
  PackScope,
  PackSession,
  SafetyMode,
} from '@rigorrun/environment';
import { KEY_SECRET, LIVE_URL, TWIN_URL } from './conventions.ts';
import {
  assertStripeBaseUrl,
  createStripeClient,
  isLoopbackUrl,
  StripeHostRefused,
  type StripeClient,
} from './client.ts';
import { confirmTestMode, guardKey, isRestrictedKey } from './keyGuard.ts';
import { materializeCase } from './materialize.ts';
import { readCase } from './read.ts';
import { describeStripeReality } from './reality.ts';
import { executeStripeAction, STRIPE_ACTIONS } from './actions.ts';

/**
 * Settings a project may give the Stripe pack. Strict, so a misspelt key is
 * refused rather than ignored.
 */
export const StripePackOptionsSchema = z
  .object({
    /**
     * What kind of account this is. Defaults to `local` against the twin and
     * `staging` against test mode. `production` is refused: every case writes.
     */
    safety: z.enum(['production', 'staging', 'local', 'ephemeral']).optional(),
  })
  .strict();
export type StripePackOptions = z.infer<typeof StripePackOptionsSchema>;

/** What tests inject in place of the network and the clock. Production passes nothing. */
export interface StripeSessionDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds. */
  now?: () => number;
  random?: () => number;
  maxRetries?: number;
  disputeTimeoutMs?: number;
  disputePollMs?: number;
  maxPages?: number;
}

/** Opens a session: where, then which key, then whether Stripe agrees it is a test key. */
export async function openStripeSession(
  options: PackOpenOptions,
  deps: StripeSessionDeps = {},
): Promise<PackSession> {
  const settings = readOptions(options.options);
  const baseUrl = resolveBaseUrl(options.mode, options.baseUrl);
  const simulated = options.mode === 'twin';
  const safety: SafetyMode = settings.safety ?? (simulated ? 'local' : 'staging');
  if (safety === 'production') {
    throw new Error(
      'A Stripe pack connection cannot be marked production. Every case creates customers, ' +
        'payments and refunds, and the pack only ever uses test mode; mark it staging.',
    );
  }

  const secretName = options.keySecret ?? KEY_SECRET;
  // Before the client exists, so a refused key cannot be sent anywhere.
  const key = guardKey(options.secret(secretName), secretName);
  const client = createStripeClient({
    baseUrl,
    key,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    ...(deps.random ? { random: deps.random } : {}),
    ...(deps.maxRetries === undefined ? {} : { maxRetries: deps.maxRetries }),
  });
  await confirmTestMode(client, key);
  return new StripeSession(client, {
    safety,
    simulated,
    restricted: isRestrictedKey(key),
    deps,
  });
}

function readOptions(raw: unknown): StripePackOptions {
  const parsed = StripePackOptionsSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'options'}: ${issue.message}`)
    .join('; ');
  throw new Error(`The Stripe pack's options are not valid: ${detail}.`);
}

/**
 * Where the mode allows the client to point.
 *
 * The twin is on this machine or nowhere: a "twin" anywhere else would be a
 * server nobody vouched for, holding a key. Test mode is Stripe's own API, and
 * a loopback address there would be a twin passed off as Stripe.
 */
export function resolveBaseUrl(mode: string, baseUrl: string | undefined): string {
  if (mode === 'twin') {
    const url = baseUrl ?? TWIN_URL;
    assertStripeBaseUrl(url);
    if (!isLoopbackUrl(url)) {
      throw new StripeHostRefused(
        `The Stripe twin runs on this machine, so its address must be a loopback address such ` +
          `as ${TWIN_URL}; ${url} is not.`,
      );
    }
    return url;
  }
  if (mode === 'live') {
    const url = baseUrl ?? LIVE_URL;
    if (assertStripeBaseUrl(url).origin !== LIVE_URL) {
      throw new StripeHostRefused(
        `Test mode is Stripe's own API at ${LIVE_URL}; ${url} is not it. For a server on this ` +
          'machine, use the twin mode.',
      );
    }
    return url;
  }
  throw new Error(`The Stripe pack has two modes, twin and live; "${mode}" is neither.`);
}

interface SessionSettings {
  safety: SafetyMode;
  simulated: boolean;
  restricted: boolean;
  deps: StripeSessionDeps;
}

class StripeSession implements PackSession {
  readonly system: string;
  readonly safety: SafetyMode;
  readonly simulated: boolean;

  private readonly currencies = new Map<string, string>();

  constructor(
    private readonly client: StripeClient,
    private readonly settings: SessionSettings,
  ) {
    this.safety = settings.safety;
    this.simulated = settings.simulated;
    this.system = settings.simulated ? 'The Stripe twin' : 'Stripe';
  }

  materialize(recipe: unknown, ctx: PackCaseContext): Promise<PackMaterialization> {
    const { deps } = this.settings;
    return materializeCase(recipe, ctx, {
      client: this.client,
      restricted: this.settings.restricted,
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.disputeTimeoutMs === undefined ? {} : { disputeTimeoutMs: deps.disputeTimeoutMs }),
      ...(deps.disputePollMs === undefined ? {} : { disputePollMs: deps.disputePollMs }),
    });
  }

  async read(scope: PackScope | null): Promise<CanonicalState> {
    const { maxPages } = this.settings.deps;
    const { state, currencies } = await readCase(
      this.client,
      scope,
      maxPages === undefined ? {} : { maxPages },
    );
    for (const [id, currency] of currencies) this.currencies.set(id, currency);
    return state;
  }

  reality(seed: CanonicalState, final: CanonicalState, bindings: PackBindings): string[] {
    return describeStripeReality(seed, final, bindings, (id) => this.currencies.get(id));
  }

  actions(): ActionDefinition[] {
    return STRIPE_ACTIONS.map((action) => ({ ...action, params: [...action.params] }));
  }

  execute(name: string, args: Record<string, unknown>): Promise<ActionResult> {
    return executeStripeAction(this.client, name, args);
  }

  async close(): Promise<void> {
    this.client.close();
  }
}
