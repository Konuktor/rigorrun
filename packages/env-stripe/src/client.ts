/**
 * RigorRun's own Stripe client: the only thing in the pack that opens a socket.
 *
 * Small on purpose. It speaks the slice of the API the pack needs — form-encoded
 * writes, bracket-notation queries, lists read to the end — and enforces the
 * safety rules in one place, so no caller can forget one:
 *
 *  - It talks to `api.stripe.com` or a loopback address, and nothing else. A
 *    base URL anywhere else is refused before a request is built, because the
 *    key travels with every request and a mistyped host would receive it.
 *  - Any object that comes back with `livemode: true`, at any depth, stops the
 *    client for good (`LiveModeRefused`). The key guard should make that
 *    impossible; this is the check that does not depend on the guard being
 *    right.
 *  - The key never appears in an error, and anything in a response that looks
 *    like a key is blanked before it is quoted.
 *  - Every write carries an Idempotency-Key, so a retried request is replayed
 *    by Stripe rather than repeated. RigorRun's own writes pass the
 *    conventional key (`idempotencyKey(ctx, step)`); anything else gets a
 *    random one, which still makes the client's own retries safe.
 *
 * Retries are bounded and jittered: on 429, and whenever Stripe says
 * `Stripe-Should-Retry: true`. `Stripe-Should-Retry: false` is obeyed even on a
 * 429. The sleep is injectable so tests never wait.
 */
import { randomUUID } from 'node:crypto';
import { LIVE_URL } from './conventions.ts';
import { encodeForm, type FormInput } from './form.ts';
import { isStripeErrorBody, type StripeList } from './wire.ts';

/**
 * The API version every request pins.
 *
 * Pinned so the account's default version, which its owner can change at any
 * time, never changes what the pack reads. This is the last monthly release
 * before `2026-09-30.endive`, which removes `payment_method_types` from
 * PaymentIntents; materializing relies on that parameter to confirm a card
 * payment without a redirect. Moving past it means switching to
 * `automatic_payment_methods[allow_redirects]=never` in the same change.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

/** How many objects one page of a list asks for. Stripe's maximum. */
export const PAGE_LIMIT = 100;

/**
 * How many pages a list is read to before it is reported as windowed.
 *
 * A case's own objects fit on one page many times over. A list that runs past
 * this is an account with far more activity than a case explains, and reading
 * further would only make a run slow before it made it right.
 */
export const MAX_LIST_PAGES = 10;

/** Stripe's limit on an Idempotency-Key. */
const MAX_IDEMPOTENCY_KEY = 255;

const DEFAULT_MAX_RETRIES = 4;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

/** Hostnames a loopback base URL may name. `URL.hostname` keeps IPv6 brackets. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export type StripeParams = { readonly [key: string]: FormInput };

export interface StripeClientOptions {
  /** `https://api.stripe.com`, or the twin (or any server) on a loopback address. */
  baseUrl: string;
  key: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries after the first attempt. Default 4. */
  maxRetries?: number;
  /** Jitter source in [0, 1). Injectable so tests can pin the delays. */
  random?: () => number;
}

export interface StripePostOptions {
  /** RigorRun's own writes pass `idempotencyKey(ctx, step)`. */
  idempotencyKey?: string;
}

export interface ListAllOptions {
  /** Default `MAX_LIST_PAGES`. */
  maxPages?: number;
}

/** A list read to its end, or to `maxPages`; `truncated` says which. */
export interface ListAllResult<T> {
  data: T[];
  /** True when Stripe still had more after the last page read. */
  truncated: boolean;
}

export interface StripeClient {
  /** The origin requests go to, without a trailing slash. */
  readonly baseUrl: string;
  /** True once any response carried `livemode: true`. Every later call is refused. */
  readonly stoppedByLiveMode: boolean;
  get<T>(path: string, params?: StripeParams): Promise<T>;
  post<T>(path: string, params: StripeParams, options?: StripePostOptions): Promise<T>;
  listAll<T extends { id: string }>(
    path: string,
    params?: StripeParams,
    options?: ListAllOptions,
  ): Promise<ListAllResult<T>>;
  /** Refuses every later call. Nothing is held open, so there is nothing else to release. */
  close(): void;
}

// --------------------------------------------------------------------- errors

/** A base URL the client will not send a key to. */
export class StripeHostRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'StripeHostRefused';
  }
}

/**
 * Stripe answered with an object in live mode.
 *
 * Not an API error to be retried or reported to an agent: it means RigorRun is
 * holding a key to somebody's real money. The client stops, and stays stopped.
 */
export class LiveModeRefused extends Error {
  constructor(readonly request: string) {
    super(
      `Stripe answered ${request} with an object in live mode (livemode: true). RigorRun only ` +
        'works in test mode, so this session has stopped and will make no further calls. Use a ' +
        'test-mode key (sk_test_… or rk_test_…).',
    );
    this.name = 'LiveModeRefused';
  }
}

/** Stripe refused a request, in its own words. */
export class StripeApiError extends Error {
  constructor(
    /** Method and path, e.g. `POST /v1/refunds`. Never the key, never the body. */
    readonly request: string,
    readonly status: number,
    /** Stripe's `error.type`, e.g. `invalid_request_error`. */
    readonly type: string,
    /** Stripe's `error.code`, e.g. `charge_already_refunded`, when it sent one. */
    readonly code: string | undefined,
    /** The parameter at fault, in bracket notation, when Stripe named one. */
    readonly param: string | undefined,
    /** Stripe's own message, with anything resembling a key blanked. */
    readonly stripeMessage: string,
  ) {
    const label = [status, type, code].filter((part) => part !== undefined).join(' ');
    super(`Stripe refused ${request} (${label}): ${stripeMessage}`);
    this.name = 'StripeApiError';
  }
}

/** Stripe could not be reached at all, after every retry. */
export class StripeConnectionError extends Error {
  constructor(
    readonly request: string,
    detail: string,
  ) {
    super(`${request} could not reach Stripe: ${detail}`);
    this.name = 'StripeConnectionError';
  }
}

// ---------------------------------------------------------------------- hosts

/**
 * The base URL, if the client may send a key to it; a throw otherwise.
 *
 * `https://api.stripe.com` exactly, or http(s) on a loopback address with any
 * port. No credentials in the URL, and no path: Stripe's paths all start at
 * the root, and a base with a path would be somewhere else.
 */
export function assertStripeBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StripeHostRefused(`"${raw}" is not a URL, so RigorRun will not send a key to it.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new StripeHostRefused('A Stripe base URL must not carry credentials.');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new StripeHostRefused(
      `${url.origin} is fine, but the base URL must have no path, query or fragment.`,
    );
  }
  const live = new URL(LIVE_URL);
  if (url.protocol === live.protocol && url.host === live.host) return url;
  if ((url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)) {
    return url;
  }
  throw new StripeHostRefused(
    `RigorRun's Stripe client calls ${LIVE_URL} or a loopback address (127.0.0.1, localhost, ` +
      `[::1]) and nothing else, so it will not send a key to ${url.origin}.`,
  );
}

/** Whether a base URL is a loopback address, which is where the twin must be. */
export function isLoopbackUrl(raw: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------- client

export function createStripeClient(options: StripeClientOptions): StripeClient {
  const base = assertStripeBaseUrl(options.baseUrl);
  const origin = base.origin;
  const key = options.key;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const random = options.random ?? Math.random;

  let liveModeAt: string | undefined;
  let closed = false;

  const redact = (text: string): string => redactKeys(text, key);

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    params: StripeParams,
    idempotency: string | undefined,
  ): Promise<T> {
    assertPath(path);
    const label = `${method} ${path}`;
    if (liveModeAt !== undefined) throw new LiveModeRefused(liveModeAt);
    if (closed) throw new Error(`${label} was not sent: this Stripe session is closed.`);

    const encoded = encodeForm(params);
    const url = method === 'GET' && encoded !== '' ? `${origin}${path}?${encoded}` : origin + path;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': STRIPE_API_VERSION,
      Accept: 'application/json',
    };
    if (method === 'POST') {
      const idempotencyKey = idempotency ?? `rigorrun-${randomUUID()}`;
      if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
        throw new Error(
          `${label} was not sent: its Idempotency-Key is ${idempotencyKey.length} characters, ` +
            `and Stripe allows ${MAX_IDEMPOTENCY_KEY}. Shorten the run, agent or case id.`,
        );
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const init: RequestInit = {
      method,
      headers,
      ...(method === 'POST' ? { body: encoded } : {}),
    };

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch (error) {
        // Safe to retry either way: a read changes nothing, and a write carries
        // its Idempotency-Key, so Stripe replays it rather than doing it twice.
        if (attempt < maxRetries) {
          await sleep(backoff(attempt, null));
          continue;
        }
        throw new StripeConnectionError(label, redact(describe(error)));
      }

      const advice = response.headers.get('stripe-should-retry');
      const retryable =
        !response.ok && (advice === 'true' || (advice !== 'false' && response.status === 429));
      if (retryable && attempt < maxRetries) {
        // Drain the body so the connection can be reused.
        await response.text().catch(() => '');
        await sleep(backoff(attempt, response.headers.get('retry-after')));
        continue;
      }

      const text = await response.text();
      let body: unknown;
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        throw new StripeApiError(
          label,
          response.status,
          'invalid_response',
          undefined,
          undefined,
          `the answer was not JSON (${text.length} characters).`,
        );
      }
      // Checked before anything else is done with the answer, error or not.
      if (carriesLiveMode(body)) {
        liveModeAt = label;
        throw new LiveModeRefused(label);
      }
      if (!response.ok) {
        if (isStripeErrorBody(body)) {
          const { type, code, param, message } = body.error;
          throw new StripeApiError(label, response.status, type, code, param, redact(message));
        }
        throw new StripeApiError(
          label,
          response.status,
          'api_error',
          undefined,
          undefined,
          'the answer was an error without Stripe’s error object.',
        );
      }
      if (body === null || typeof body !== 'object') {
        throw new StripeApiError(
          label,
          response.status,
          'invalid_response',
          undefined,
          undefined,
          'the answer was not a Stripe object.',
        );
      }
      return body as T;
    }
  }

  function backoff(attempt: number, retryAfter: string | null): number {
    const advised = retryAfter === null ? NaN : Number(retryAfter) * 1000;
    if (Number.isFinite(advised) && advised >= 0) return Math.min(advised, MAX_DELAY_MS);
    const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
    // Half fixed, half random: spread out, but never a near-zero wait.
    return Math.round(ceiling * (0.5 + random() * 0.5));
  }

  return {
    baseUrl: origin,
    get stoppedByLiveMode() {
      return liveModeAt !== undefined;
    },
    get: <T>(path: string, params: StripeParams = {}) => request<T>('GET', path, params, undefined),
    post: <T>(path: string, params: StripeParams, postOptions: StripePostOptions = {}) =>
      request<T>('POST', path, params, postOptions.idempotencyKey),
    async listAll<T extends { id: string }>(
      path: string,
      params: StripeParams = {},
      listOptions: ListAllOptions = {},
    ): Promise<ListAllResult<T>> {
      const maxPages = Math.max(1, listOptions.maxPages ?? MAX_LIST_PAGES);
      const data: T[] = [];
      let startingAfter: string | undefined;
      for (let page = 0; page < maxPages; page += 1) {
        const answer = await request<StripeList<T>>(
          'GET',
          path,
          { ...params, limit: PAGE_LIMIT, starting_after: startingAfter },
          undefined,
        );
        if (!Array.isArray(answer.data)) {
          throw new StripeApiError(
            `GET ${path}`,
            200,
            'invalid_response',
            undefined,
            undefined,
            'the answer was not a list.',
          );
        }
        data.push(...answer.data);
        const last = answer.data[answer.data.length - 1];
        if (!answer.has_more) return { data, truncated: false };
        // `has_more` with nothing to continue from would loop on page one.
        if (last === undefined) {
          throw new StripeApiError(
            `GET ${path}`,
            200,
            'invalid_response',
            undefined,
            undefined,
            'the list said it had more, on an empty page.',
          );
        }
        startingAfter = last.id;
      }
      return { data, truncated: true };
    },
    close() {
      closed = true;
    },
  };
}

// -------------------------------------------------------------------- helpers

/**
 * A path the client will put after the origin.
 *
 * Callers build paths from ids, some of which an agent supplied. Only plain
 * segments are allowed, so an id can never climb out of the resource it names.
 */
function assertPath(path: string): void {
  const segments = path.split('/').slice(1);
  const plain = segments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment));
  if (!path.startsWith('/v1/') || !plain) {
    throw new Error(`"${path}" is not a Stripe API path the client will call.`);
  }
}

/** How deep a response is searched for `livemode`. Stripe nests a handful of levels. */
const LIVEMODE_DEPTH = 12;

/** Whether `livemode: true` appears anywhere in a parsed answer, list data included. */
export function carriesLiveMode(value: unknown, depth = 0): boolean {
  if (depth > LIVEMODE_DEPTH || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => carriesLiveMode(item, depth + 1));
  const record = value as Record<string, unknown>;
  if (record['livemode'] === true) return true;
  return Object.values(record).some((item) => carriesLiveMode(item, depth + 1));
}

/** Stripe's key shapes: secret, restricted and publishable, in either mode. */
const KEY_SHAPE = /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9*]+/g;

/** Text with the key, and anything shaped like a Stripe key, blanked. */
export function redactKeys(text: string, key?: string): string {
  const withoutKey = key !== undefined && key !== '' ? text.split(key).join('[key]') : text;
  return withoutKey.replace(KEY_SHAPE, '[key]');
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
  }
  return String(error);
}
