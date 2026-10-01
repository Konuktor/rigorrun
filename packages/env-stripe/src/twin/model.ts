/**
 * The twin's account: what a Stripe test-mode account would hold, in memory.
 *
 * One account, shared by every key the twin accepts, because that is how the
 * pack is used against Stripe: RigorRun and the agent under test hold
 * different keys to the same account, and each must see what the other made.
 *
 * The model is where Stripe's bookkeeping lives — a refund raises the charge's
 * `amount_refunded`, a charge is `refunded` once nothing is left, a disputed
 * charge refuses refunds — so that the HTTP layer only translates. Every
 * object is stored the way Stripe returns it, `livemode: false` on each one
 * that carries the field. (Stripe's refund object has no `livemode`; the twin's
 * has none either, so a client cannot come to rely on one.)
 *
 * Time comes from an injectable clock, in milliseconds like `Date.now`.
 * `created` is that clock in whole seconds, as Stripe writes it. A dispute is
 * not a timer: a charge paid with the dispute test card records when its
 * dispute is due, and the dispute is opened the first time anything looks at
 * the account after that moment. Tests can therefore move a clock instead of
 * waiting, and a twin that nobody asks has nothing running.
 */
import { randomBytes } from 'node:crypto';
import type { RefundReason } from '../wire.ts';
import {
  TEST_PAYMENT_METHODS,
  type Metadata,
  type StripeBalance,
  type StripeCharge,
  type StripeCustomer,
  type StripeDispute,
  type StripeList,
  type StripePaymentIntent,
  type StripeRefund,
} from '../wire.ts';
import { invalidRequest, noSuch } from './errors.ts';
import { matchesCreated, type CreatedFilter, type PageParams } from './params.ts';

// ------------------------------------------------------------------ objects

export interface TwinCustomer extends StripeCustomer {
  address: null;
  balance: number;
  currency: string | null;
  default_source: null;
  delinquent: boolean;
  description: string | null;
  phone: string | null;
  preferred_locales: string[];
  shipping: null;
  tax_exempt: 'none';
  test_clock: null;
}

export interface TwinCharge extends StripeCharge {
  amount_captured: number;
  balance_transaction: string;
  captured: boolean;
  description: string | null;
  failure_code: null;
  failure_message: null;
  paid: boolean;
  payment_method: string;
  payment_method_details: { type: 'card'; card: { brand: string; last4: string } };
  receipt_email: string | null;
}

export interface TwinPaymentIntent extends StripePaymentIntent {
  amount_capturable: number;
  amount_received: number;
  automatic_payment_methods: { enabled: boolean; allow_redirects?: 'always' | 'never' } | null;
  capture_method: 'automatic' | 'automatic_async';
  client_secret: string;
  confirmation_method: 'automatic';
  description: string | null;
  last_payment_error: null;
  next_action: null;
  payment_method: string | null;
  payment_method_types: string[];
  receipt_email: string | null;
}

export interface TwinRefund extends StripeRefund {
  balance_transaction: string;
}

export interface TwinDispute extends StripeDispute {
  is_charge_refundable: boolean;
}

export interface TwinBalanceAmount {
  amount: number;
  currency: string;
  source_types: { card: number };
}

export interface TwinBalance extends StripeBalance {
  available: TwinBalanceAmount[];
  pending: TwinBalanceAmount[];
}

export interface TwinObjects {
  customer: TwinCustomer;
  payment_intent: TwinPaymentIntent;
  charge: TwinCharge;
  refund: TwinRefund;
  dispute: TwinDispute;
}
export type TwinObjectKind = keyof TwinObjects;

export const TWIN_OBJECT_KINDS = [
  'customer',
  'payment_intent',
  'charge',
  'refund',
  'dispute',
] as const satisfies readonly TwinObjectKind[];

/** Where each kind is listed, which is also the `url` of every page of it. */
export const LIST_URLS: Record<TwinObjectKind, string> = {
  customer: '/v1/customers',
  payment_intent: '/v1/payment_intents',
  charge: '/v1/charges',
  refund: '/v1/refunds',
  dispute: '/v1/disputes',
};

/**
 * Which fields of each kind hold the id of another object, and can be
 * expanded into it. A charge's `refunds` is the other expansion the twin
 * honours: a list, not an id.
 */
const EXPANDABLE: Record<TwinObjectKind, Partial<Record<string, TwinObjectKind>>> = {
  customer: {},
  payment_intent: { customer: 'customer', latest_charge: 'charge' },
  charge: { customer: 'customer', payment_intent: 'payment_intent' },
  refund: { charge: 'charge', payment_intent: 'payment_intent' },
  dispute: { charge: 'charge', payment_intent: 'payment_intent' },
};

// ---------------------------------------------------------------------- ids

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A Stripe-shaped id: a prefix, an underscore, then letters and digits only.
 * The pack binds ids into check paths, which accept `[A-Za-z0-9_]` and nothing
 * else, so the twin may never mint an id Stripe could not.
 */
export function twinId(prefix: string, length = 24): string {
  let out = '';
  for (const byte of randomBytes(length)) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

// ------------------------------------------------------------------- money

/** Stripe's zero-decimal currencies: their minor unit is the major unit. */
const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

/**
 * The currencies the twin takes a payment in: those Stripe lists with a
 * minimum charge (docs.stripe.com/currencies, read 2026-10-01), and the
 * zero-decimal ones above. Stripe supports more than 135; one it supports that
 * is missing here is refused by the twin, which errs towards refusing rather
 * than towards accepting a currency nobody checked. Every currency a Stripe
 * pack policy allows is here.
 */
const SUPPORTED_CURRENCIES = new Set([
  'usd',
  'aed',
  'ars',
  'aud',
  'brl',
  'cad',
  'chf',
  'cop',
  'czk',
  'dkk',
  'eur',
  'gbp',
  'hkd',
  'huf',
  'idr',
  'ils',
  'inr',
  'mxn',
  'myr',
  'nok',
  'nzd',
  'php',
  'pln',
  'ron',
  'rub',
  'sek',
  'sgd',
  'thb',
  'zar',
  ...ZERO_DECIMAL,
]);

/** Whether the twin takes a payment in this lower-case currency code. */
export function isSupportedCurrency(currency: string): boolean {
  return SUPPORTED_CURRENCIES.has(currency);
}

const SYMBOLS: Partial<Record<string, string>> = { usd: '$', eur: '€', gbp: '£', jpy: '¥' };

/**
 * The smallest charge Stripe accepts, for the currencies whose minimum the twin
 * knows. Any other currency is not checked: the twin would rather accept a
 * payment Stripe refuses in a currency no case uses than invent a minimum.
 */
const MINIMUM_CHARGE: Partial<Record<string, number>> = {
  usd: 50,
  eur: 50,
  gbp: 30,
  jpy: 50,
  cad: 50,
  aud: 50,
};

/** Stripe's ceiling on a single amount: eight digits of minor units. */
export const MAXIMUM_AMOUNT = 99_999_999;

/** An amount the way Stripe's messages print it: `$25.00`, `¥2500`. */
export function formatAmount(amount: number, currency: string): string {
  const major = ZERO_DECIMAL.has(currency) ? String(amount) : (amount / 100).toFixed(2);
  const symbol = SYMBOLS[currency];
  return symbol === undefined ? `${major} ${currency}` : `${symbol}${major}`;
}

// ------------------------------------------------------------------- inputs

export interface CustomerInput {
  email: string | null;
  name: string | null;
  description: string | null;
  phone: string | null;
  metadata: Metadata;
}

export interface PaymentIntentInput {
  amount: number;
  currency: string;
  customer: string | null;
  paymentMethod: string | null;
  confirm: boolean;
  /** As sent. Absent means Stripe's default: payment methods chosen automatically. */
  paymentMethodTypes: string[] | null;
  automaticPaymentMethods: { enabled: boolean; allow_redirects?: 'always' | 'never' } | null;
  returnUrl: string | null;
  captureMethod: 'automatic' | 'automatic_async';
  description: string | null;
  receiptEmail: string | null;
  metadata: Metadata;
}

export interface RefundInput {
  charge?: string;
  paymentIntent?: string;
  amount?: number;
  reason: RefundReason | null;
  metadata: Metadata;
}

// ------------------------------------------------------------- idempotency

/** A response Stripe's idempotency layer would replay. */
export interface SavedResponse {
  /** Method, path and parameters, canonical: a different request under the same key differs here. */
  fingerprint: string;
  status: number;
  body: unknown;
  requestId: string;
  savedAt: number;
}

/** Stripe prunes a key once it is at least a day old; a reuse after that is a new request. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

// -------------------------------------------------------------------- model

export interface TwinModelOptions {
  /** Milliseconds since the epoch. Defaults to `Date.now`. */
  clock?: () => number;
  /** How long after a payment with the dispute test card its dispute opens. */
  disputeDelayMs?: number;
}

/**
 * On Stripe the dispute arrives some time after the payment succeeds, so the
 * twin waits too: a client that assumed the dispute exists the moment the
 * payment does would otherwise pass here and fail there. The pack waits up to
 * 60 s for the dispute, so the exact figure does not matter; that there is one
 * does.
 */
export const DEFAULT_DISPUTE_DELAY_MS = 2000;

type Tables = { [K in TwinObjectKind]: Map<string, TwinObjects[K]> };

function emptyTables(): Tables {
  return {
    customer: new Map(),
    payment_intent: new Map(),
    charge: new Map(),
    refund: new Map(),
    dispute: new Map(),
  };
}

export class TwinModel {
  readonly clock: () => number;
  readonly disputeDelayMs: number;

  private tables = emptyTables();
  /** Creation order, which breaks ties between objects created in the same second. */
  private order = new Map<string, number>();
  private sequence = 0;
  /** Charges paid with the dispute test card, and when (clock ms) their dispute opens. */
  private disputesDue = new Map<string, number>();
  /** Saved responses, per API key, per Idempotency-Key. */
  private saved = new Map<string, Map<string, SavedResponse>>();

  constructor(options: TwinModelOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.disputeDelayMs = options.disputeDelayMs ?? DEFAULT_DISPUTE_DELAY_MS;
    if (!Number.isFinite(this.disputeDelayMs) || this.disputeDelayMs < 0) {
      throw new Error(`disputeDelayMs must be zero or more, not ${this.disputeDelayMs}.`);
    }
  }

  /** Forgets everything: objects, pending disputes and saved idempotent responses. */
  reset(): void {
    this.tables = emptyTables();
    this.order.clear();
    this.sequence = 0;
    this.disputesDue.clear();
    this.saved.clear();
  }

  /** Now, in Stripe's unit: whole seconds since the epoch. */
  now(): number {
    return Math.floor(this.clock() / 1000);
  }

  /** Opens every dispute that is due. Every read and write calls this first. */
  settle(): void {
    const now = this.clock();
    const due = [...this.disputesDue].filter(([, at]) => at <= now).sort((a, b) => a[1] - b[1]);
    for (const [chargeId, at] of due) {
      this.disputesDue.delete(chargeId);
      const charge = this.tables.charge.get(chargeId);
      if (!charge) continue;
      charge.disputed = true;
      this.insert('dispute', {
        // Stripe's dispute ids start du_ (test/golden/stripe-live.json).
        id: twinId('du'),
        object: 'dispute',
        amount: charge.amount,
        charge: charge.id,
        created: Math.floor(at / 1000),
        currency: charge.currency,
        is_charge_refundable: false,
        livemode: false,
        metadata: {},
        payment_intent: charge.payment_intent,
        reason: 'fraudulent',
        status: 'needs_response',
      });
    }
  }

  // ------------------------------------------------------------- reading

  /** One object as stored, or `undefined`. A copy: changing it changes nothing. */
  find<K extends TwinObjectKind>(kind: K, id: string): TwinObjects[K] | undefined {
    this.settle();
    const found = this.tables[kind].get(id);
    return found === undefined ? undefined : structuredClone(found);
  }

  /** Every object of a kind, newest first, as copies. For tests and in-process inspection. */
  all<K extends TwinObjectKind>(kind: K): TwinObjects[K][] {
    this.settle();
    return this.sorted(kind).map((item) => structuredClone(item));
  }

  /**
   * One page of a list, exactly as Stripe pages: newest first, `limit` items,
   * `has_more` when another page exists in the direction being read, and a
   * cursor that is an object id of the same kind.
   */
  list<K extends TwinObjectKind>(
    kind: K,
    filter: { where?: (item: TwinObjects[K]) => boolean; created?: CreatedFilter },
    page: PageParams,
  ): StripeList<TwinObjects[K]> {
    this.settle();
    const items = this.sorted(kind).filter(
      (item) => matchesCreated(item.created, filter.created) && (filter.where?.(item) ?? true),
    );
    let data: TwinObjects[K][];
    let hasMore: boolean;
    if (page.startingAfter !== undefined) {
      const cursor = this.stored(kind, page.startingAfter, 'starting_after');
      const after = items.filter((item) => this.precedes(cursor, item));
      data = after.slice(0, page.limit);
      hasMore = after.length > page.limit;
    } else if (page.endingBefore !== undefined) {
      const cursor = this.stored(kind, page.endingBefore, 'ending_before');
      const before = items.filter((item) => this.precedes(item, cursor));
      data = before.slice(Math.max(0, before.length - page.limit));
      hasMore = before.length > page.limit;
    } else {
      data = items.slice(0, page.limit);
      hasMore = items.length > page.limit;
    }
    return {
      object: 'list',
      data: data.map((item) => structuredClone(item)),
      has_more: hasMore,
      url: LIST_URLS[kind],
    };
  }

  /** One object, or Stripe's `resource_missing` naming the parameter it came from. */
  get<K extends TwinObjectKind>(
    kind: K,
    id: string,
    param: string,
    status: 400 | 404,
  ): TwinObjects[K] {
    this.settle();
    const found = this.tables[kind].get(id);
    if (found === undefined) throw noSuch(kind, id, param, status);
    return structuredClone(found);
  }

  balance(): TwinBalance {
    this.settle();
    const net = new Map<string, number>();
    const add = (currency: string, amount: number) =>
      net.set(currency, (net.get(currency) ?? 0) + amount);
    for (const charge of this.tables.charge.values()) {
      if (charge.status === 'succeeded') add(charge.currency, charge.amount);
    }
    for (const refund of this.tables.refund.values()) {
      if (refund.status === 'succeeded' || refund.status === 'pending') {
        add(refund.currency, -refund.amount);
      }
    }
    for (const dispute of this.tables.dispute.values()) add(dispute.currency, -dispute.amount);
    if (net.size === 0) net.set('usd', 0);
    const currencies = [...net.keys()].sort();
    // Payments land in `pending` and stay there: the twin has no payouts and no
    // settlement schedule, and charges no fees, so these figures are the net of
    // what was paid, refunded and disputed — not what Stripe would report.
    return {
      object: 'balance',
      livemode: false,
      available: currencies.map((currency) => ({ amount: 0, currency, source_types: { card: 0 } })),
      pending: currencies.map((currency) => {
        const amount = net.get(currency) ?? 0;
        return { amount, currency, source_types: { card: amount } };
      }),
    };
  }

  // ------------------------------------------------------------- writing

  createCustomer(input: CustomerInput): TwinCustomer {
    this.settle();
    return structuredClone(
      this.insert('customer', {
        id: twinId('cus', 14),
        object: 'customer',
        address: null,
        balance: 0,
        created: this.now(),
        currency: null,
        default_source: null,
        delinquent: false,
        description: input.description,
        email: input.email,
        livemode: false,
        metadata: { ...input.metadata },
        name: input.name,
        phone: input.phone,
        preferred_locales: [],
        shipping: null,
        tax_exempt: 'none',
        test_clock: null,
      }),
    );
  }

  /**
   * Creates a PaymentIntent and, when asked to confirm, pays it.
   *
   * Only Stripe's test payment methods are honoured. Paying copies the
   * PaymentIntent's metadata and description onto the charge, as Stripe does,
   * which is how an `order_ref` written on the PaymentIntent is found on the
   * charge.
   */
  createPaymentIntent(input: PaymentIntentInput): TwinPaymentIntent {
    this.settle();
    if (input.customer !== null) this.get('customer', input.customer, 'customer', 400);
    const card = input.paymentMethod === null ? null : testCard(input.paymentMethod);
    if (input.confirm && card === null) {
      throw invalidRequest(
        "You cannot confirm this PaymentIntent because it's missing a payment method. To confirm " +
          'the PaymentIntent with a payment method, pass `payment_method`.',
        { param: 'payment_method' },
      );
    }
    // Since API version 2023-08-16 a PaymentIntent without `payment_method_types`
    // accepts every method enabled in the Dashboard, some of which redirect, so
    // Stripe refuses to confirm one without somewhere to come back to. A client
    // written against an older default passes the twin only if the twin refuses
    // it too.
    const redirectsAllowed = input.automaticPaymentMethods?.allow_redirects !== 'never';
    if (
      input.confirm &&
      input.paymentMethodTypes === null &&
      redirectsAllowed &&
      input.returnUrl === null
    ) {
      throw invalidRequest(
        'This PaymentIntent is configured to accept payment methods enabled in your Dashboard. ' +
          'Because some of these payment methods might redirect your customer off of your page, ' +
          "you must provide a `return_url`. If you don't want to accept redirect-based payment " +
          'methods, set `automatic_payment_methods[enabled]` to `true` and ' +
          '`automatic_payment_methods[allow_redirects]` to `never` when creating Setup Intents ' +
          'and Payment Intents.',
      );
    }
    const minimum = MINIMUM_CHARGE[input.currency];
    if (minimum !== undefined && input.amount < minimum) {
      throw invalidRequest(
        `Amount must be at least ${formatAmount(minimum, input.currency)} ${input.currency}`,
        { code: 'amount_too_small', param: 'amount' },
      );
    }
    const id = twinId('pi');
    const created = this.now();
    const paymentMethod = card === null ? null : twinId('pm');
    const intent: TwinPaymentIntent = {
      id,
      object: 'payment_intent',
      amount: input.amount,
      amount_capturable: 0,
      amount_received: 0,
      automatic_payment_methods:
        input.paymentMethodTypes === null
          ? (input.automaticPaymentMethods ?? { enabled: true, allow_redirects: 'always' })
          : null,
      capture_method: input.captureMethod,
      client_secret: `${id}_secret_${twinId('x', 25).slice(2)}`,
      confirmation_method: 'automatic',
      created,
      currency: input.currency,
      customer: input.customer,
      description: input.description,
      last_payment_error: null,
      latest_charge: null,
      livemode: false,
      metadata: { ...input.metadata },
      next_action: null,
      payment_method: paymentMethod,
      payment_method_types: input.paymentMethodTypes ?? ['card'],
      receipt_email: input.receiptEmail,
      status: paymentMethod === null ? 'requires_payment_method' : 'requires_confirmation',
    };
    if (input.confirm && card !== null && paymentMethod !== null) {
      const charge = this.insert('charge', {
        id: twinId('ch'),
        object: 'charge',
        amount: input.amount,
        amount_captured: input.amount,
        amount_refunded: 0,
        balance_transaction: twinId('txn'),
        captured: true,
        created,
        currency: input.currency,
        customer: input.customer,
        description: input.description,
        disputed: false,
        failure_code: null,
        failure_message: null,
        livemode: false,
        metadata: { ...input.metadata },
        paid: true,
        payment_intent: id,
        payment_method: paymentMethod,
        payment_method_details: { type: 'card', card: { brand: card.brand, last4: card.last4 } },
        receipt_email: input.receiptEmail,
        refunded: false,
        status: 'succeeded',
      });
      intent.status = 'succeeded';
      intent.amount_received = input.amount;
      intent.latest_charge = charge.id;
      if (card.disputes) this.disputesDue.set(charge.id, this.clock() + this.disputeDelayMs);
    }
    return structuredClone(this.insert('payment_intent', intent));
  }

  /**
   * Refunds a charge, named directly or through its PaymentIntent, with
   * Stripe's refusals in Stripe's order: a disputed charge first, then one
   * with nothing left, then an amount larger than what is left.
   */
  createRefund(input: RefundInput): TwinRefund {
    this.settle();
    let charge: TwinCharge | undefined;
    if (input.charge !== undefined) {
      // An unknown charge here is a 404 naming `id`, as Stripe answers it
      // (test/golden/stripe-live.json, refund.unknown_charge).
      const found = this.tables.charge.get(input.charge);
      if (found === undefined) throw noSuch('charge', input.charge, 'id', 404);
      charge = found;
    }
    if (input.paymentIntent !== undefined) {
      const intent = this.stored('payment_intent', input.paymentIntent, 'payment_intent');
      const latest =
        typeof intent.latest_charge === 'string'
          ? this.tables.charge.get(intent.latest_charge)
          : undefined;
      if (latest === undefined || latest.status !== 'succeeded') {
        throw invalidRequest(
          `This PaymentIntent (${intent.id}) does not have a successful charge to refund.`,
          { param: 'payment_intent' },
        );
      }
      if (charge !== undefined && charge.id !== latest.id) {
        throw invalidRequest(`Charge ${charge.id} does not belong to PaymentIntent ${intent.id}.`, {
          param: 'charge',
        });
      }
      charge = latest;
    }
    if (charge === undefined) throw new Error('createRefund needs a charge or a PaymentIntent.');
    if (charge.disputed) {
      throw invalidRequest(`Charge ${charge.id} has been charged back; cannot issue a refund.`, {
        code: 'charge_disputed',
      });
    }
    const remaining = charge.amount - charge.amount_refunded;
    if (remaining <= 0) {
      throw invalidRequest(`Charge ${charge.id} has already been refunded.`, {
        code: 'charge_already_refunded',
      });
    }
    const amount = input.amount ?? remaining;
    if (amount > remaining) {
      throw invalidRequest(
        `Refund amount (${formatAmount(amount, charge.currency)}) is greater than unrefunded ` +
          `amount on charge (${formatAmount(remaining, charge.currency)})`,
        // Stripe test mode answers this one without a code (test/golden/stripe-live.json).
        { param: 'amount' },
      );
    }
    charge.amount_refunded += amount;
    charge.refunded = charge.amount_refunded === charge.amount;
    return structuredClone(
      this.insert('refund', {
        id: twinId('re'),
        object: 'refund',
        amount,
        balance_transaction: twinId('txn'),
        charge: charge.id,
        created: this.now(),
        currency: charge.currency,
        metadata: { ...input.metadata },
        payment_intent: charge.payment_intent,
        reason: input.reason,
        // A card refund in test mode succeeds at once.
        status: 'succeeded',
      }),
    );
  }

  // --------------------------------------------------------- expansion

  /**
   * Replaces ids with the objects they name, along each dotted path. The paths
   * must already have passed `checkExpand`; this only follows them.
   */
  expand<K extends TwinObjectKind>(kind: K, object: TwinObjects[K], paths: readonly string[]) {
    const result = structuredClone(object) as unknown as Record<string, unknown>;
    for (const path of paths) this.expandPath(kind, result, path.split('.'));
    return result;
  }

  private expandPath(kind: TwinObjectKind, object: Record<string, unknown>, path: string[]): void {
    const [head, ...rest] = path;
    if (head === undefined) return;
    if (kind === 'charge' && head === 'refunds') {
      const id = String(object['id']);
      const refunds = this.sorted('refund').filter((refund) => refund.charge === id);
      object['refunds'] = {
        object: 'list',
        data: refunds.map((refund) => structuredClone(refund)),
        has_more: false,
        url: `/v1/charges/${id}/refunds`,
      };
      return;
    }
    const target = EXPANDABLE[kind][head];
    if (target === undefined) return;
    const value = object[head];
    if (typeof value === 'string') {
      const found = this.tables[target].get(value);
      if (found !== undefined) object[head] = structuredClone(found);
    }
    const next = object[head];
    if (rest.length > 0 && next !== null && typeof next === 'object') {
      this.expandPath(target, next as Record<string, unknown>, rest);
    }
  }

  // ------------------------------------------------------- idempotency

  /** The saved response for a key, unless it is older than Stripe keeps one. */
  savedResponse(apiKey: string, idempotencyKey: string): SavedResponse | undefined {
    const forKey = this.saved.get(apiKey);
    const saved = forKey?.get(idempotencyKey);
    if (saved === undefined) return undefined;
    if (this.clock() - saved.savedAt >= IDEMPOTENCY_WINDOW_MS) {
      forKey?.delete(idempotencyKey);
      return undefined;
    }
    return saved;
  }

  saveResponse(apiKey: string, idempotencyKey: string, response: Omit<SavedResponse, 'savedAt'>) {
    let forKey = this.saved.get(apiKey);
    if (forKey === undefined) {
      forKey = new Map();
      this.saved.set(apiKey, forKey);
    }
    forKey.set(idempotencyKey, { ...response, savedAt: this.clock() });
  }

  // ----------------------------------------------------------- internals

  private insert<K extends TwinObjectKind>(kind: K, object: TwinObjects[K]): TwinObjects[K] {
    this.sequence += 1;
    this.order.set(object.id, this.sequence);
    this.tables[kind].set(object.id, object);
    return object;
  }

  /** The stored object itself, for a write to change or a cursor to compare against. */
  private stored<K extends TwinObjectKind>(kind: K, id: string, param: string): TwinObjects[K] {
    const found = this.tables[kind].get(id);
    if (found === undefined) throw noSuch(kind, id, param, 400);
    return found;
  }

  private sorted<K extends TwinObjectKind>(kind: K): TwinObjects[K][] {
    return [...this.tables[kind].values()].sort((a, b) => (this.precedes(a, b) ? -1 : 1));
  }

  /** Whether `a` comes before `b` in Stripe's order: newer first, then later-made first. */
  private precedes(a: { id: string; created: number }, b: { id: string; created: number }) {
    if (a.created !== b.created) return a.created > b.created;
    return (this.order.get(a.id) ?? 0) > (this.order.get(b.id) ?? 0);
  }
}

// ---------------------------------------------------------------- helpers

/**
 * Whether a list of expansion paths can be followed from this kind, checked
 * before the request does anything, so that a bad `expand[]` on a create
 * refuses the request instead of creating the object and then failing.
 */
export function checkExpand(kind: TwinObjectKind, paths: readonly string[], list: boolean): void {
  for (const path of paths) {
    let segments = path.split('.');
    if (list) {
      if (segments[0] !== 'data' || segments.length < 2) {
        throw invalidRequest(`This property cannot be expanded (${path}).`, { param: 'expand' });
      }
      segments = segments.slice(1);
    }
    if (segments.length > 4) {
      throw invalidRequest('You cannot expand more than 4 levels of a property.', {
        param: 'expand',
      });
    }
    let current: TwinObjectKind | null = kind;
    for (const segment of segments) {
      const next: TwinObjectKind | undefined =
        current === null ? undefined : EXPANDABLE[current][segment];
      const refunds = current === 'charge' && segment === 'refunds';
      if (next === undefined && !refunds) {
        throw invalidRequest(`This property cannot be expanded (${segment}).`, {
          param: 'expand',
        });
      }
      current = next ?? null;
    }
  }
}

interface TestCard {
  brand: string;
  last4: string;
  /** Whether Stripe opens a dispute against a payment made with it. */
  disputes: boolean;
}

const TEST_CARDS: Record<string, TestCard> = {
  [TEST_PAYMENT_METHODS.succeeds]: { brand: 'visa', last4: '4242', disputes: false },
  [TEST_PAYMENT_METHODS.disputed]: { brand: 'visa', last4: '0259', disputes: true },
};

/**
 * One of Stripe's test payment methods. Anything else is a PaymentMethod the
 * account does not have — including one the twin minted for an earlier
 * payment, which Stripe would not let a second PaymentIntent reuse without the
 * customer attachment the twin does not model.
 */
function testCard(paymentMethod: string): TestCard {
  const card = Object.hasOwn(TEST_CARDS, paymentMethod) ? TEST_CARDS[paymentMethod] : undefined;
  if (card === undefined) {
    throw invalidRequest(`No such PaymentMethod: '${paymentMethod}'`, {
      code: 'resource_missing',
      param: 'payment_method',
    });
  }
  return card;
}
