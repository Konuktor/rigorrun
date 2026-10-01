/**
 * The conformance script: one fixed sequence of requests, run against the twin
 * or against Stripe test mode, recorded in a form both can produce.
 *
 * The sequence exercises exactly what the pack and its agents depend on —
 * customers, paying with the test cards, partial and full refunds and each way
 * a refund is refused, a dispute arriving after the payment, pagination,
 * `created` filters, idempotent replay and its refusal, and the errors for a
 * missing key, a live key, an unknown id and an unknown URL.
 *
 * What is recorded is what the twin promises to get right: status codes,
 * error `type`, `code` and `param`, the fields of each object the pack reads,
 * the order of lists and their `has_more`, and the `Idempotent-Replayed`
 * header. Ids are replaced by placeholders in order of first appearance
 * (`<ch:1>`), timestamps by `<ts>`, and the run's tag by `<run>`, so two runs
 * of the same sequence against the same API record the same thing. Messages
 * are not recorded: Stripe rewords them, and nothing in the pack reads them.
 *
 * `test/golden/stripe-live.json`, recorded against Stripe test mode with
 * `scripts/conformance.ts --target live --write-golden`, is the authority.
 * Where the twin and that file disagree, the twin is what is wrong.
 */
import { encodeForm, type FormInput } from '../form.ts';
import { LIVE_URL, TEST_KEY_PREFIXES } from '../conventions.ts';
import { isLoopbackHost } from './server.ts';

export interface ConformanceOptions {
  /** The API's origin, e.g. `https://api.stripe.com` or the twin's URL. No `/v1`. */
  baseUrl: string;
  /** A test-mode key. Sent only to `baseUrl`, never printed. */
  key: string;
  /** Unique to this run: written into emails, metadata and idempotency keys. */
  tag?: string;
  /** How long to wait for the dispute to open. Default 60 s, as the pack waits. */
  disputeTimeoutMs?: number;
  /** How often to look while waiting. Default 1 s. */
  pollIntervalMs?: number;
  /** One line per step, as it completes. */
  log?: (line: string) => void;
}

/** One request and what came back, normalized. */
export interface ConformanceStep {
  step: string;
  request: { method: 'GET' | 'POST'; path: string; params?: unknown; key?: string };
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export interface ConformanceRun {
  steps: ConformanceStep[];
  /**
   * Steps whose answer was not what the pack relies on, e.g. a refund larger
   * than what is left that did not come back `amount_too_large`. Against the
   * twin these are twin bugs; against Stripe they are the pack's assumptions
   * being wrong, which is worth knowing before anything is recorded.
   */
  failures: string[];
  /** The `Stripe-Version` the API answered with, when it said. */
  stripeVersion: string | null;
}

export interface GoldenFile {
  about: string;
  recordedAt: string;
  stripeVersion: string | null;
  steps: ConformanceStep[];
}

export const GOLDEN_ABOUT =
  'Stripe test mode, recorded by packages/env-stripe/scripts/conformance.ts --target live ' +
  '--write-golden. The authority for the twin: where the two disagree, the twin is fixed.';

/** A response that carried `livemode: true`. The run stops at once. */
export class LiveModeRefused extends Error {
  constructor(where: string) {
    super(`${where} returned an object with livemode: true. Stopping: this is not test mode.`);
    this.name = 'LiveModeRefused';
  }
}

/**
 * Refuses to go on unless the key is a test key and the API agrees.
 *
 * The prefix is checked before anything is sent; then `GET /v1/balance` must
 * answer 200 with `livemode: false`. The key is never part of a message.
 */
export async function guardTestMode(baseUrl: string, key: string): Promise<void> {
  if (!TEST_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    throw new Error(
      `The key does not start with ${TEST_KEY_PREFIXES.join(' or ')}; refusing to send it anywhere.`,
    );
  }
  const url = new URL(baseUrl);
  const live = new URL(LIVE_URL);
  if (url.origin !== live.origin && !isLoopbackHost(url.hostname)) {
    throw new Error(
      `Refusing to send a Stripe key to ${url.origin}: only ${LIVE_URL} or loopback.`,
    );
  }
  const response = await fetch(new URL('/v1/balance', url), {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = (await response.json().catch(() => null)) as { livemode?: unknown } | null;
  if (response.status !== 200 || body === null) {
    throw new Error(`GET /v1/balance answered ${response.status}; cannot confirm test mode.`);
  }
  if (body.livemode !== false) {
    throw new Error('GET /v1/balance did not report livemode: false. Refusing to run.');
  }
}

// ------------------------------------------------------------- the script

interface Raw {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

type Auth = 'key' | 'none' | { bearer: string };

interface StepRequest {
  method: 'GET' | 'POST';
  path: string;
  params?: Record<string, FormInput>;
  idempotencyKey?: string;
  auth?: Auth;
  /** Response headers worth recording, lower-case. */
  headers?: string[];
  /** Keep only list items that belong to this run. */
  ours?: (item: Record<string, unknown>) => boolean;
}

/** Runs the script. Throws `LiveModeRefused` the moment anything is in live mode. */
export async function runConformance(options: ConformanceOptions): Promise<ConformanceRun> {
  const tag = options.tag ?? Math.random().toString(36).slice(2, 10);
  const pollInterval = options.pollIntervalMs ?? 1000;
  const disputeTimeout = options.disputeTimeoutMs ?? 60_000;
  const normalizer = new Normalizer(tag);
  const steps: ConformanceStep[] = [];
  const failures: string[] = [];
  let stripeVersion: string | null = null;

  async function send(request: StepRequest): Promise<Raw> {
    const query = request.method === 'GET' && request.params ? encodeForm(request.params) : '';
    const url = new URL(`${request.path}${query ? `?${query}` : ''}`, options.baseUrl);
    const headers: Record<string, string> = {};
    const auth = request.auth ?? 'key';
    if (auth === 'key') headers['Authorization'] = `Bearer ${options.key}`;
    else if (auth !== 'none') headers['Authorization'] = `Bearer ${auth.bearer}`;
    if (request.idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = request.idempotencyKey;
    }
    let body: string | undefined;
    if (request.method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = encodeForm(request.params ?? {});
    }
    const response = await fetch(url, {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
    });
    const text = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A proxy's HTML error page, say. Recorded as what it is rather than crashing the run.
      parsed = { error: { type: '(not JSON)', message: text.slice(0, 200) } };
    }
    if (containsLivemode(parsed)) throw new LiveModeRefused(`${request.method} ${request.path}`);
    stripeVersion ??= response.headers.get('stripe-version');
    return { status: response.status, headers: response.headers, body: parsed };
  }

  /** Sends one step, records it, and checks it against what the pack relies on. */
  async function step(
    name: string,
    request: StepRequest,
    check: (raw: Raw) => string | undefined,
    sent?: Raw,
  ): Promise<Raw> {
    const raw = sent ?? (await send(request));
    const recorded: ConformanceStep = {
      step: name,
      request: {
        method: request.method,
        path: request.path,
        ...(request.params ? { params: request.params } : {}),
        ...(request.auth && request.auth !== 'key'
          ? { key: request.auth === 'none' ? '(none)' : '(a live key)' }
          : {}),
      },
      status: raw.status,
      body: project(raw.body, request.ours),
    };
    if (request.headers) {
      recorded.headers = Object.fromEntries(
        request.headers.map((name) => [name, raw.headers.get(name) ?? '<absent>']),
      );
    }
    steps.push(normalizer.normalize(recorded));
    const problem = check(raw);
    if (problem !== undefined) failures.push(`${name}: ${problem}`);
    options.log?.(`${problem === undefined ? 'ok  ' : 'FAIL'}  ${name}  ${raw.status}`);
    return raw;
  }

  // -- keys and routes
  await step(
    'balance',
    { method: 'GET', path: '/v1/balance' },
    (r) => status(r, 200) ?? (r.body['livemode'] === false ? undefined : 'livemode is not false'),
  );
  await step('auth.missing_key', { method: 'GET', path: '/v1/balance', auth: 'none' }, (r) =>
    error(r, 401, 'invalid_request_error'),
  );
  await step(
    'auth.live_key',
    { method: 'GET', path: '/v1/balance', auth: { bearer: 'sk_live_rigorrunconformancenotakey' } },
    (r) => error(r, 401, 'invalid_request_error'),
  );
  await step('route.unknown', { method: 'GET', path: '/v1/rigorrun_conformance_nothing' }, (r) =>
    error(r, 404, 'invalid_request_error'),
  );

  // -- customers
  const email = `rr-conf-${tag}@example.com`;
  const customer = await step(
    'customer.create',
    {
      method: 'POST',
      path: '/v1/customers',
      params: { email, name: 'RigorRun Conformance', metadata: { rigorrun_conformance: tag } },
    },
    (r) => status(r, 200) ?? field(r.body, 'email', email),
  );
  const customerId = need(customer, 'id');
  const since = Number(customer.body['created']);
  await step(
    'customer.unknown_parameter',
    { method: 'POST', path: '/v1/customers', params: { email, nickname: 'x' } },
    (r) => error(r, 400, 'invalid_request_error', 'parameter_unknown'),
  );
  await step(
    'customer.retrieve',
    { method: 'GET', path: `/v1/customers/${customerId}` },
    (r) => status(r, 200) ?? field(r.body, 'id', customerId),
  );
  await step(
    'customers.by_email',
    { method: 'GET', path: '/v1/customers', params: { email } },
    (r) => status(r, 200) ?? ids(r, [customerId]),
  );

  // -- a payment, refunded in parts
  const intent = await step(
    'payment_intent.visa',
    {
      method: 'POST',
      path: '/v1/payment_intents',
      params: {
        amount: 6000,
        currency: 'usd',
        customer: customerId,
        payment_method: 'pm_card_visa',
        payment_method_types: ['card'],
        confirm: true,
        metadata: { order_ref: `RR-CONF-${tag}-A` },
      },
    },
    (r) => status(r, 200) ?? field(r.body, 'status', 'succeeded'),
  );
  const intentId = need(intent, 'id');
  const chargeId = need(intent, 'latest_charge');
  await step(
    'payment_intent.retrieve_expanded',
    {
      method: 'GET',
      path: `/v1/payment_intents/${intentId}`,
      params: { expand: ['latest_charge'] },
    },
    (r) => {
      const latest = r.body['latest_charge'] as Record<string, unknown> | null;
      const metadata = latest?.['metadata'] as Record<string, unknown> | undefined;
      return (
        status(r, 200) ??
        (metadata?.['order_ref'] === `RR-CONF-${tag}-A`
          ? undefined
          : "the charge did not carry the PaymentIntent's metadata")
      );
    },
  );
  await step(
    'charge.retrieve',
    { method: 'GET', path: `/v1/charges/${chargeId}` },
    (r) => status(r, 200) ?? field(r.body, 'amount_refunded', 0),
  );
  await step(
    'charges.by_payment_intent',
    { method: 'GET', path: '/v1/charges', params: { payment_intent: intentId } },
    (r) => status(r, 200) ?? ids(r, [chargeId]),
  );
  const partial = await step(
    'refund.partial',
    {
      method: 'POST',
      path: '/v1/refunds',
      params: {
        charge: chargeId,
        amount: 2500,
        reason: 'requested_by_customer',
        metadata: { rigorrun_conformance: tag },
      },
    },
    (r) => status(r, 200) ?? field(r.body, 'status', 'succeeded') ?? field(r.body, 'amount', 2500),
  );
  const partialId = need(partial, 'id');
  await step(
    'charge.after_partial_refund',
    { method: 'GET', path: `/v1/charges/${chargeId}` },
    (r) =>
      status(r, 200) ?? field(r.body, 'amount_refunded', 2500) ?? field(r.body, 'refunded', false),
  );
  await step(
    'refund.more_than_remains',
    { method: 'POST', path: '/v1/refunds', params: { charge: chargeId, amount: 4000 } },
    (r) => error(r, 400, 'invalid_request_error'),
  );
  await step(
    'refund.amount_not_integer',
    { method: 'POST', path: '/v1/refunds', params: { charge: chargeId, amount: '25.00' } },
    (r) => error(r, 400, 'invalid_request_error', 'parameter_invalid_integer'),
  );
  await step(
    'refund.amount_zero',
    { method: 'POST', path: '/v1/refunds', params: { charge: chargeId, amount: 0 } },
    (r) => (r.status === 400 ? undefined : `expected a refusal, got ${r.status}`),
  );
  await step(
    'refund.no_charge_or_payment_intent',
    { method: 'POST', path: '/v1/refunds', params: { amount: 100 } },
    (r) => error(r, 400, 'invalid_request_error'),
  );
  await step(
    'refund.unknown_charge',
    { method: 'POST', path: '/v1/refunds', params: { charge: 'ch_rigorrunconformance0' } },
    (r) => code(r, 'resource_missing'),
  );
  await step(
    'refund.remainder_by_payment_intent',
    { method: 'POST', path: '/v1/refunds', params: { payment_intent: intentId } },
    (r) => status(r, 200) ?? field(r.body, 'amount', 3500) ?? field(r.body, 'charge', chargeId),
  );
  await step(
    'charge.after_full_refund',
    { method: 'GET', path: `/v1/charges/${chargeId}` },
    (r) =>
      status(r, 200) ?? field(r.body, 'amount_refunded', 6000) ?? field(r.body, 'refunded', true),
  );
  await step(
    'refund.nothing_left',
    { method: 'POST', path: '/v1/refunds', params: { charge: chargeId, amount: 100 } },
    (r) => error(r, 400, 'invalid_request_error', 'charge_already_refunded'),
  );

  // -- reading refunds back
  await step(
    'refunds.by_charge',
    { method: 'GET', path: '/v1/refunds', params: { charge: chargeId } },
    (r) => status(r, 200) ?? amounts(r, [3500, 2500]),
  );
  const firstPage = await step(
    'refunds.page_1',
    { method: 'GET', path: '/v1/refunds', params: { charge: chargeId, limit: 1 } },
    (r) => status(r, 200) ?? amounts(r, [3500]) ?? field(r.body, 'has_more', true),
  );
  const cursor = ((firstPage.body['data'] as Record<string, unknown>[] | undefined)?.[0]?.['id'] ??
    '') as string;
  await step(
    'refunds.page_2',
    {
      method: 'GET',
      path: '/v1/refunds',
      params: { charge: chargeId, limit: 1, starting_after: cursor },
    },
    (r) => status(r, 200) ?? ids(r, [partialId]) ?? field(r.body, 'has_more', false),
  );
  await step(
    'refunds.created_since',
    {
      method: 'GET',
      path: '/v1/refunds',
      params: { created: { gte: since }, limit: 100 },
      ours: (item) => item['charge'] === chargeId,
    },
    (r) => {
      // Anything else in the account since then is somebody else's; only ours is checked.
      const mine = listOf(r).filter((item) => item['charge'] === chargeId);
      return status(r, 200) ?? amounts({ ...r, body: { data: mine } }, [3500, 2500]);
    },
  );

  // -- a payment that is disputed
  const disputedIntent = await step(
    'payment_intent.dispute_card',
    {
      method: 'POST',
      path: '/v1/payment_intents',
      params: {
        amount: 4000,
        currency: 'usd',
        customer: customerId,
        payment_method: 'pm_card_createDispute',
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        confirm: true,
        metadata: { order_ref: `RR-CONF-${tag}-B` },
      },
    },
    (r) => status(r, 200) ?? field(r.body, 'status', 'succeeded'),
  );
  const disputedIntentId = need(disputedIntent, 'id');
  const disputedChargeId = need(disputedIntent, 'latest_charge');
  const chargePath = `/v1/charges/${disputedChargeId}`;
  let disputed = await send({ method: 'GET', path: chargePath });
  const deadline = Date.now() + disputeTimeout;
  while (disputed.body['disputed'] !== true && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    disputed = await send({ method: 'GET', path: chargePath });
  }
  await step(
    'charge.disputed',
    { method: 'GET', path: chargePath },
    (r) => status(r, 200) ?? field(r.body, 'disputed', true),
    disputed,
  );
  const disputes = await step(
    'disputes.by_charge',
    { method: 'GET', path: '/v1/disputes', params: { charge: disputedChargeId } },
    (r) => {
      const data = (r.body['data'] ?? []) as Record<string, unknown>[];
      return (
        status(r, 200) ??
        (data.length === 1 ? undefined : `expected one dispute, got ${data.length}`) ??
        field(data[0] ?? {}, 'status', 'needs_response') ??
        field(data[0] ?? {}, 'reason', 'fraudulent')
      );
    },
  );
  const disputeId = String(
    (disputes.body['data'] as Record<string, unknown>[] | undefined)?.[0]?.['id'] ?? 'dp_none',
  );
  await step(
    'dispute.retrieve',
    { method: 'GET', path: `/v1/disputes/${disputeId}` },
    (r) => status(r, 200) ?? field(r.body, 'charge', disputedChargeId),
  );
  await step(
    'refund.disputed_charge',
    { method: 'POST', path: '/v1/refunds', params: { charge: disputedChargeId } },
    (r) => error(r, 400, 'invalid_request_error', 'charge_disputed'),
  );

  // -- lists scoped to the customer
  const intentsPage = await step(
    'payment_intents.page_1',
    { method: 'GET', path: '/v1/payment_intents', params: { customer: customerId, limit: 1 } },
    (r) => status(r, 200) ?? ids(r, [disputedIntentId]) ?? field(r.body, 'has_more', true),
  );
  await step(
    'payment_intents.page_2',
    {
      method: 'GET',
      path: '/v1/payment_intents',
      params: {
        customer: customerId,
        limit: 1,
        starting_after: String(
          (intentsPage.body['data'] as Record<string, unknown>[] | undefined)?.[0]?.['id'] ?? '',
        ),
      },
    },
    (r) => status(r, 200) ?? ids(r, [intentId]) ?? field(r.body, 'has_more', false),
  );
  await step(
    'charges.by_customer',
    { method: 'GET', path: '/v1/charges', params: { customer: customerId } },
    (r) => status(r, 200) ?? ids(r, [disputedChargeId, chargeId]),
  );
  await step(
    'charges.created_before_customer',
    {
      method: 'GET',
      path: '/v1/charges',
      params: { customer: customerId, created: { lt: since } },
    },
    (r) => status(r, 200) ?? ids(r, []),
  );
  await step(
    'charge.unknown',
    { method: 'GET', path: '/v1/charges/ch_rigorrunconformance0' },
    (r) => error(r, 404, 'invalid_request_error', 'resource_missing'),
  );

  // -- idempotency
  const idempotentEmail = `rr-conf-${tag}-idem@example.com`;
  const once = await step(
    'idempotency.first',
    {
      method: 'POST',
      path: '/v1/customers',
      params: { email: idempotentEmail },
      idempotencyKey: `rr-conf-${tag}-1`,
      headers: ['idempotent-replayed'],
    },
    (r) => status(r, 200),
  );
  await step(
    'idempotency.replay',
    {
      method: 'POST',
      path: '/v1/customers',
      params: { email: idempotentEmail },
      idempotencyKey: `rr-conf-${tag}-1`,
      headers: ['idempotent-replayed'],
    },
    (r) =>
      status(r, 200) ??
      field(r.body, 'id', once.body['id']) ??
      (r.headers.get('idempotent-replayed') === 'true' ? undefined : 'not marked as replayed'),
  );
  await step(
    'idempotency.different_parameters',
    {
      method: 'POST',
      path: '/v1/customers',
      params: { email: idempotentEmail, name: 'Someone Else' },
      idempotencyKey: `rr-conf-${tag}-1`,
    },
    (r) => error(r, 400, 'idempotency_error'),
  );
  await step(
    'idempotency.refusal_first',
    {
      method: 'POST',
      path: '/v1/refunds',
      params: { charge: chargeId, amount: 100 },
      idempotencyKey: `rr-conf-${tag}-2`,
      headers: ['idempotent-replayed'],
    },
    (r) => error(r, 400, 'invalid_request_error', 'charge_already_refunded'),
  );
  await step(
    'idempotency.refusal_replayed',
    {
      method: 'POST',
      path: '/v1/refunds',
      params: { charge: chargeId, amount: 100 },
      idempotencyKey: `rr-conf-${tag}-2`,
      headers: ['idempotent-replayed'],
    },
    (r) =>
      error(r, 400, 'invalid_request_error', 'charge_already_refunded') ??
      (r.headers.get('idempotent-replayed') === 'true' ? undefined : 'not marked as replayed'),
  );

  // -- last, because Stripe might accept it and add a payment to the customer
  await step(
    'payment_intent.confirm_without_return_url',
    {
      method: 'POST',
      path: '/v1/payment_intents',
      params: {
        amount: 1500,
        currency: 'usd',
        customer: customerId,
        payment_method: 'pm_card_visa',
        confirm: true,
      },
    },
    (r) => error(r, 400, 'invalid_request_error'),
  );

  return { steps, failures, stripeVersion };
}

// ------------------------------------------------------------ the golden

/**
 * Every difference between the authority and a run, one line each, naming the
 * step and the field. Empty when they agree.
 */
export function compareToGolden(golden: GoldenFile, run: ConformanceRun): string[] {
  const differences: string[] = [];
  const actual = new Map(run.steps.map((step) => [step.step, step]));
  const expected = new Set(golden.steps.map((step) => step.step));
  for (const step of golden.steps) {
    const mine = actual.get(step.step);
    if (mine === undefined) {
      differences.push(`${step.step}: in the golden file, not in this run`);
      continue;
    }
    diff(step, mine, step.step, differences);
  }
  for (const step of run.steps) {
    if (!expected.has(step.step))
      differences.push(`${step.step}: in this run, not in the golden file`);
  }
  return differences;
}

function diff(expected: unknown, actual: unknown, path: string, out: string[]): void {
  if (expected === actual) return;
  if (
    expected !== null &&
    actual !== null &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    Array.isArray(expected) === Array.isArray(actual)
  ) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      diff(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key],
        Array.isArray(expected) ? `${path}[${key}]` : `${path}.${key}`,
        out,
      );
    }
    return;
  }
  out.push(`${path}: Stripe ${JSON.stringify(expected)}, this run ${JSON.stringify(actual)}`);
}

// ------------------------------------------------------------- recording

/** The fields recorded for each kind of object; everything else Stripe sends is left out. */
const RECORDED: Record<string, readonly string[]> = {
  customer: ['id', 'object', 'email', 'name', 'metadata', 'created', 'livemode'],
  payment_intent: [
    'id',
    'object',
    'amount',
    'currency',
    'customer',
    'status',
    'latest_charge',
    'metadata',
    'created',
    'livemode',
  ],
  charge: [
    'id',
    'object',
    'amount',
    'amount_captured',
    'amount_refunded',
    'refunded',
    'disputed',
    'captured',
    'paid',
    'currency',
    'customer',
    'payment_intent',
    'status',
    'metadata',
    'created',
    'livemode',
  ],
  refund: [
    'id',
    'object',
    'amount',
    'charge',
    'payment_intent',
    'currency',
    'status',
    'reason',
    'metadata',
    'created',
    'livemode',
  ],
  dispute: [
    'id',
    'object',
    'amount',
    'charge',
    'payment_intent',
    'currency',
    'status',
    'reason',
    'created',
    'livemode',
  ],
  balance: ['object', 'livemode'],
  list: ['object', 'url', 'has_more', 'data'],
};

/** A response reduced to what is recorded. An absent field is recorded as absent. */
function project(
  value: Record<string, unknown>,
  ours?: (item: Record<string, unknown>) => boolean,
): unknown {
  const error = value['error'] as Record<string, unknown> | undefined;
  if (error !== undefined) {
    return {
      error: { type: error['type'], code: error['code'] ?? null, param: error['param'] ?? null },
    };
  }
  const kind = String(value['object']);
  const fields = RECORDED[kind];
  if (fields === undefined) return { object: kind };
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    let item = Object.hasOwn(value, field) ? value[field] : '<absent>';
    if (field === 'data' && Array.isArray(item)) {
      const rows = item as Record<string, unknown>[];
      item = (ours ? rows.filter(ours) : rows).map((row) => project(row));
    } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const nested = item as Record<string, unknown>;
      item = typeof nested['object'] === 'string' ? project(nested) : item;
    }
    out[field] = item;
  }
  return out;
}

const ID = /^(cus|pi|ch|py|re|pyr|dp|du|txn|pm|req|acct)_[A-Za-z0-9]+$/;

/** Ids to placeholders in order of first appearance, timestamps to `<ts>`, the tag to `<run>`. */
class Normalizer {
  private ids = new Map<string, string>();
  private counts = new Map<string, number>();

  constructor(private readonly tag: string) {}

  normalize<T>(value: T): T {
    return this.walk(value, '') as T;
  }

  private walk(value: unknown, key: string): unknown {
    if (typeof value === 'string') return this.text(value);
    if (typeof value === 'number') {
      return key === 'created' || key === 'gte' || key === 'lt' ? '<ts>' : value;
    }
    if (Array.isArray(value)) return value.map((item) => this.walk(item, key));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [name, item] of Object.entries(value)) out[name] = this.walk(item, name);
      return out;
    }
    return value;
  }

  private text(value: string): string {
    const match = ID.exec(value);
    if (match) {
      const known = this.ids.get(value);
      if (known !== undefined) return known;
      const prefix = match[1]!;
      const count = (this.counts.get(prefix) ?? 0) + 1;
      this.counts.set(prefix, count);
      const placeholder = `<${prefix}:${count}>`;
      this.ids.set(value, placeholder);
      return placeholder;
    }
    const path = value.replace(/\/(cus|pi|ch|re|dp|du)_[A-Za-z0-9]+/g, (segment) => {
      return `/${this.text(segment.slice(1))}`;
    });
    return path.split(this.tag).join('<run>');
  }
}

// ---------------------------------------------------------------- checks

function containsLivemode(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsLivemode);
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record['livemode'] === true) return true;
  return Object.values(record).some(containsLivemode);
}

function need(raw: Raw, name: string): string {
  const value = raw.body[name];
  if (typeof value !== 'string') {
    throw new Error(
      `The script cannot continue: the response had no ${name} (status ${raw.status}).`,
    );
  }
  return value;
}

function status(raw: Raw, expected: number): string | undefined {
  return raw.status === expected ? undefined : `expected status ${expected}, got ${raw.status}`;
}

function field(body: Record<string, unknown>, name: string, expected: unknown): string | undefined {
  return body[name] === expected
    ? undefined
    : `expected ${name} ${JSON.stringify(expected)}, got ${JSON.stringify(body[name])}`;
}

function error(raw: Raw, statusCode: number, type: string, errorCode?: string): string | undefined {
  const detail = raw.body['error'] as Record<string, unknown> | undefined;
  if (raw.status !== statusCode || detail === undefined) {
    return `expected a ${statusCode} ${type}${errorCode ? ` (${errorCode})` : ''}, got ${raw.status}`;
  }
  if (detail['type'] !== type) return `expected type ${type}, got ${String(detail['type'])}`;
  if (errorCode !== undefined && detail['code'] !== errorCode) {
    return `expected code ${errorCode}, got ${String(detail['code'])}`;
  }
  return undefined;
}

function code(raw: Raw, errorCode: string): string | undefined {
  const detail = raw.body['error'] as Record<string, unknown> | undefined;
  return detail?.['code'] === errorCode
    ? undefined
    : `expected code ${errorCode}, got status ${raw.status}`;
}

function listOf(raw: Raw): Record<string, unknown>[] {
  return (raw.body['data'] ?? []) as Record<string, unknown>[];
}

function ids(raw: Raw, expected: string[]): string | undefined {
  const got = listOf(raw).map((item) => item['id']);
  return JSON.stringify(got) === JSON.stringify(expected)
    ? undefined
    : `expected ${expected.length} item(s) in order, got ${got.length}`;
}

function amounts(raw: Raw, expected: number[]): string | undefined {
  const got = listOf(raw).map((item) => item['amount']);
  return JSON.stringify(got) === JSON.stringify(expected)
    ? undefined
    : `expected amounts ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`;
}
