/**
 * A local twin of the part of Stripe's API the Stripe pack uses.
 *
 * It answers on loopback only, accepts test-mode keys only, and behaves like
 * Stripe test mode for its subset: the same paths, the same form-encoded
 * parameters, the same objects with `livemode: false`, the same pagination,
 * the same idempotency rules and the same error codes. The pack, the reference
 * agent and the qualification agents are written against it and then run,
 * unchanged, against api.stripe.com, so every difference is a place where a
 * verdict on the twin would not hold on Stripe. The conformance script
 * (`packages/env-stripe/scripts/conformance.ts`) is how differences are found:
 * its file recorded against Stripe is the authority, and the twin is what
 * changes when the two disagree.
 *
 * What the HTTP layer does, in Stripe's order: test hooks (only when enabled),
 * injected faults (rate limiters run before everything else on Stripe), the
 * key, the route, the key's permission, the idempotency layer, then the
 * endpoint. Every response carries a `Request-Id`, and echoes `Stripe-Version`
 * and `Idempotency-Key` when the request sent them.
 *
 * Test hooks are not Stripe. They exist only when the twin is started with
 * `testHooks: true`, live under `/_twin/`, and otherwise that path is as
 * unknown as any other:
 *
 *   POST   /_twin/reset   forget every object, saved response and fault
 *   POST   /_twin/faults  JSON `{ status, count?, method?, path?, shouldRetry? }`:
 *                         the next `count` matching /v1 requests are answered
 *                         with `status` before they reach the API (nothing is
 *                         executed or saved), e.g. 429 with
 *                         `Stripe-Should-Retry: true`, or 500
 *   DELETE /_twin/faults  drop every queued fault
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { TEST_KEY_PREFIXES, TWIN_HOST, TWIN_PORT } from '../conventions.ts';
import { FormDecodeError, decodeForm, type FormObject } from '../form.ts';
import { matchRoute } from './api.ts';
import { TwinError, invalidRequest, redactKey } from './errors.ts';
import { DEFAULT_DISPUTE_DELAY_MS, TwinModel, twinId } from './model.ts';

export interface TwinOptions {
  /** Default `TWIN_PORT` (12112). `0` picks a free port; read it from `url`. */
  port?: number;
  /** Default `127.0.0.1`. Anything that is not a loopback address is refused. */
  host?: string;
  /** How long after a payment with `pm_card_createDispute` its dispute opens. Default 2000. */
  disputeDelayMs?: number;
  /** Milliseconds since the epoch. Default `Date.now`. Drives `created` and dispute timing. */
  clock?: () => number;
  /** Enables the `/_twin/` hooks and `injectFault`. Off unless asked for. */
  testHooks?: boolean;
}

/** One injected failure, answered in place of the next `count` matching requests. */
export interface TwinFault {
  /** An HTTP error status, 400–599. */
  status: number;
  /** How many requests it answers. Default 1. */
  count?: number;
  /** Only requests with this method. */
  method?: 'GET' | 'POST';
  /** Only requests whose path starts with this, e.g. `/v1/refunds`. */
  path?: string;
  /** Sent as `Stripe-Should-Retry`. Default `true` for 429 and unset otherwise. */
  shouldRetry?: boolean;
}

export interface RunningTwin {
  /** Where it listens, e.g. `http://127.0.0.1:12112`. No trailing slash. */
  url: string;
  /** The account behind it, for in-process inspection and `reset()`. */
  model: TwinModel;
  /** Queues a fault. Throws unless the twin was started with `testHooks: true`. */
  injectFault(fault: TwinFault): void;
  /** Stops listening and drops open connections. Safe to call twice. */
  close(): Promise<void>;
}

/** Whether a host name or address can only be reached from this machine. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (bare === 'localhost' || bare === '::1') return true;
  const v4 = bare.startsWith('::ffff:') ? bare.slice('::ffff:'.length) : bare;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** Starts the twin. Resolves once it is listening. */
export async function startTwin(options: TwinOptions = {}): Promise<RunningTwin> {
  const host = options.host ?? TWIN_HOST;
  if (!isLoopbackHost(host)) {
    throw new Error(
      `The Stripe twin listens on loopback only; refusing to listen on "${host}". ` +
        `Use ${TWIN_HOST}.`,
    );
  }
  const modelOptions: ConstructorParameters<typeof TwinModel>[0] = {
    disputeDelayMs: options.disputeDelayMs ?? DEFAULT_DISPUTE_DELAY_MS,
  };
  if (options.clock) modelOptions.clock = options.clock;
  const model = new TwinModel(modelOptions);
  const state: TwinState = { model, faults: [], testHooks: options.testHooks === true };

  const server = createServer((req, res) => {
    void handle(state, req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? TWIN_PORT, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    return closing;
  };

  const address = server.address() as AddressInfo;
  if (!isLoopbackHost(address.address)) {
    await close();
    throw new Error(`"${host}" resolved to ${address.address}, which is not loopback.`);
  }
  const shown = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return {
    url: `http://${shown}:${address.port}`,
    model,
    injectFault(fault) {
      if (!state.testHooks) {
        throw new Error(
          'Test hooks are off: start the twin with testHooks: true to inject faults.',
        );
      }
      state.faults.push(FaultSchema.parse(fault));
    },
    close,
  };
}

// --------------------------------------------------------------- internals

interface TwinState {
  model: TwinModel;
  faults: QueuedFault[];
  testHooks: boolean;
}

const FaultSchema = z
  .object({
    status: z.number().int().min(400).max(599),
    count: z.number().int().min(1).default(1),
    method: z.enum(['GET', 'POST']).optional(),
    path: z.string().startsWith('/').optional(),
    shouldRetry: z.boolean().optional(),
  })
  .strict();
type QueuedFault = z.infer<typeof FaultSchema>;

const MAX_BODY_BYTES = 1024 * 1024;

const MISSING_KEY =
  "You did not provide an API key. You need to provide your API key in the Authorization header, using Bearer auth (e.g. 'Authorization: Bearer YOUR_SECRET_KEY'). See https://stripe.com/docs/api#authentication for details, or we can help at https://support.stripe.com/.";

/** The account restricted keys are refused on, in the 403 Stripe's wording names. */
const TWIN_ACCOUNT = 'acct_rigorruntwin';

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

interface Answer {
  status: number;
  body: unknown;
}

async function handle(state: TwinState, req: IncomingMessage, res: ServerResponse) {
  const requestId = twinId('req', 14);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store',
    'Request-Id': requestId,
  };
  const method = req.method ?? 'GET';
  const version = header(req, 'stripe-version');
  if (version !== undefined) headers['Stripe-Version'] = version;
  const idempotencyKey = method === 'POST' ? header(req, 'idempotency-key') : undefined;
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;

  let answer: Answer;
  try {
    answer = await respond(state, req, { method, version, idempotencyKey, requestId, headers });
  } catch (error) {
    if (error instanceof TwinError) {
      answer = { status: error.status, body: error.body };
      Object.assign(headers, error.headers);
    } else {
      // A bug in the twin, not a refusal Stripe would make. Said plainly, so it
      // is never mistaken for one of Stripe's 500s.
      answer = {
        status: 500,
        body: {
          error: {
            message: `The RigorRun twin failed: ${(error as Error).message ?? String(error)}`,
            type: 'api_error',
          },
        },
      };
    }
  }
  if (answer.status === 401) headers['WWW-Authenticate'] = 'Basic realm="Stripe"';
  res.writeHead(answer.status, headers).end(`${JSON.stringify(answer.body, null, 2)}\n`);
}

/** One request, through each layer in Stripe's order. Refusals are thrown as `TwinError`. */
async function respond(
  state: TwinState,
  req: IncomingMessage,
  context: {
    method: string;
    version: string | undefined;
    idempotencyKey: string | undefined;
    requestId: string;
    /** The response's headers, which a replay adds to. */
    headers: Record<string, string>;
  },
): Promise<Answer> {
  const { method, idempotencyKey } = context;
  const url = new URL(req.url ?? '/', 'http://twin.invalid');
  const raw = await readBody(req);
  if (state.testHooks && url.pathname.startsWith('/_twin/')) {
    return hook(state, method, url.pathname, raw);
  }
  takeFault(state, method, url.pathname);
  const key = authenticate(header(req, 'authorization'));
  const params = readParams(method, url, raw, header(req, 'content-type'));
  const matched = matchRoute(method, url.pathname);
  if (matched === undefined) {
    throw invalidRequest(
      `Unrecognized request URL (${method}: ${url.pathname}). Please see ` +
        'https://stripe.com/docs or we can help at https://support.stripe.com/. (The ' +
        "RigorRun twin answers only the part of Stripe's API the Stripe pack uses.)",
      { status: 404 },
    );
  }
  if (method === 'POST' && key.readOnly) {
    throw new TwinError(
      403,
      'invalid_request_error',
      `The provided key '${redactKey(key.value)}' does not have the required permissions ` +
        `for this endpoint on account '${TWIN_ACCOUNT}'. The RigorRun twin treats every ` +
        'restricted key as read-only.',
    );
  }
  const request = { params, captures: matched.captures, stripeVersion: context.version };
  if (idempotencyKey === undefined || idempotencyKey === '') {
    return run(matched.route.prepare(state.model, request));
  }
  if (idempotencyKey.length > 255) {
    throw invalidRequest('Idempotency keys can be at most 255 characters long.');
  }
  const fingerprint = canonical({ method, path: url.pathname, params });
  const saved = state.model.savedResponse(key.value, idempotencyKey);
  if (saved !== undefined) {
    if (saved.fingerprint !== fingerprint) {
      throw new TwinError(
        400,
        'idempotency_error',
        'Keys for idempotent requests can only be used with the same parameters they were ' +
          `first used with. Try using a key other than '${idempotencyKey}' if you meant to ` +
          'execute a different request.',
      );
    }
    context.headers['Idempotent-Replayed'] = 'true';
    context.headers['Original-Request'] = saved.requestId;
    return { status: saved.status, body: saved.body };
  }
  // Preparing first: a request refused for its parameters never reached the
  // endpoint, so nothing is saved and a retry under the same key starts afresh.
  const execute = matched.route.prepare(state.model, request);
  const answer = run(execute);
  state.model.saveResponse(key.value, idempotencyKey, {
    fingerprint,
    ...answer,
    requestId: context.requestId,
  });
  return answer;
}

/** The endpoint's work, with any refusal it makes turned into the response it is. */
function run(execute: () => unknown): Answer {
  try {
    return { status: 200, body: execute() };
  } catch (error) {
    if (error instanceof TwinError) return { status: error.status, body: error.body };
    throw error;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) {
        reject(invalidRequest('Request body too large.', { status: 413 }));
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * The key from `Authorization`: Bearer, or HTTP Basic with the key as the user
 * name, which is how `curl -u sk_test_…:` sends it. Only test keys pass.
 */
function authenticate(authorization: string | undefined): { value: string; readOnly: boolean } {
  let key = '';
  const [scheme = '', credentials = ''] = (authorization ?? '').trim().split(/\s+/, 2);
  if (scheme.toLowerCase() === 'bearer') key = credentials;
  if (scheme.toLowerCase() === 'basic') {
    const decoded = Buffer.from(credentials, 'base64').toString('utf8');
    key = decoded.split(':', 1)[0] ?? '';
  }
  if (key === '') throw new TwinError(401, 'invalid_request_error', MISSING_KEY);
  const prefix = TEST_KEY_PREFIXES.find((candidate) => key.startsWith(candidate));
  if (prefix !== undefined && key.length > prefix.length) {
    return { value: key, readOnly: prefix.startsWith('rk_') };
  }
  const live = /^(sk|rk)_live_/.test(key);
  throw new TwinError(
    401,
    'invalid_request_error',
    `Invalid API Key provided: ${redactKey(key)}` +
      (live
        ? '. This is the RigorRun twin of Stripe test mode: it accepts test keys ' +
          `(${TEST_KEY_PREFIXES.join('…, ')}…) only, and a live key is never used here.`
        : ''),
  );
}

/**
 * The request's parameters: the query string, and for a POST the form body
 * after it, so a body value wins over the same name in the query.
 */
function readParams(
  method: string,
  url: URL,
  raw: string,
  contentType: string | undefined,
): FormObject {
  if (method === 'POST' && raw !== '') {
    const type = (contentType ?? '').split(';', 1)[0]!.trim().toLowerCase();
    if (type !== 'application/x-www-form-urlencoded') {
      throw invalidRequest(
        `Invalid request: unsupported Content-Type ${type === '' ? '(none)' : type}. Stripe ` +
          'takes application/x-www-form-urlencoded bodies, with nested values in bracket ' +
          'notation (metadata[key]=value).',
      );
    }
  }
  const parts = [url.search.slice(1)];
  if (method === 'POST') parts.push(raw);
  try {
    return decodeForm(parts.filter((part) => part !== '').join('&'));
  } catch (error) {
    if (error instanceof FormDecodeError) {
      throw invalidRequest(`Invalid request: ${error.message}`, { param: error.param });
    }
    throw error;
  }
}

/** Parameters in a canonical order, so the same request always prints the same. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(item).sort()) {
      Object.defineProperty(sorted, key, {
        value: (item as Record<string, unknown>)[key],
        enumerable: true,
      });
    }
    return sorted;
  });
}

// ---------------------------------------------------------------- testing

function takeFault(state: TwinState, method: string, path: string): void {
  if (!state.testHooks || !path.startsWith('/v1/')) return;
  const index = state.faults.findIndex(
    (fault) =>
      (fault.method === undefined || fault.method === method) &&
      (fault.path === undefined || path.startsWith(fault.path)),
  );
  if (index === -1) return;
  const fault = state.faults[index]!;
  fault.count -= 1;
  if (fault.count <= 0) state.faults.splice(index, 1);
  const shouldRetry = fault.shouldRetry ?? (fault.status === 429 ? true : undefined);
  const headers: Record<string, string> =
    shouldRetry === undefined ? {} : { 'Stripe-Should-Retry': String(shouldRetry) };
  if (fault.status === 429) {
    throw new TwinError(
      429,
      'invalid_request_error',
      'Request rate limit exceeded. Learn more about rate limits here ' +
        'https://stripe.com/docs/rate-limits. (Injected by the RigorRun twin.)',
      { code: 'rate_limit', headers },
    );
  }
  if (fault.status >= 500) {
    throw new TwinError(
      fault.status,
      'api_error',
      'An unknown error occurred. (Injected by the RigorRun twin.)',
      { headers },
    );
  }
  throw new TwinError(fault.status, 'invalid_request_error', 'Injected by the RigorRun twin.', {
    headers,
  });
}

function hook(state: TwinState, method: string, path: string, raw: string): Answer {
  if (method === 'POST' && path === '/_twin/reset') {
    state.model.reset();
    state.faults.length = 0;
    return { status: 200, body: { reset: true } };
  }
  if (method === 'POST' && path === '/_twin/faults') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw invalidRequest(
        'A fault is a JSON object: { status, count?, method?, path?, shouldRetry? }.',
      );
    }
    const fault = FaultSchema.safeParse(parsed);
    if (!fault.success) throw invalidRequest(`Not a fault: ${fault.error.message}`);
    state.faults.push(fault.data);
    return { status: 200, body: { queued: state.faults.length } };
  }
  if (method === 'DELETE' && path === '/_twin/faults') {
    const cleared = state.faults.length;
    state.faults.length = 0;
    return { status: 200, body: { cleared } };
  }
  throw invalidRequest(`No twin hook at ${method} ${path}.`, { status: 404 });
}
