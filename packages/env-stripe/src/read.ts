/**
 * Reading one case's part of a Stripe account back, as canonical state.
 *
 * What is read is what the case is about and what could have been done to it:
 *
 *  - each of the case's customers, and every charge each of them has;
 *  - every refund and dispute on those charges;
 *  - every refund created in the account since the case's first object. This
 *    is the read that catches a refund made on a charge the case never
 *    created — an agent that found the wrong payment by searching the account.
 *    The charge such a refund names is read too, so the projection can say
 *    whose payment it was (`charge__customer`) and that it exists
 *    (`charge__exists`) instead of reporting a refund against nothing.
 *
 * A refund in that window on a payment RigorRun made for a different case —
 * another case, attempt, agent or run, as the payment's metadata says — is
 * that case's, not this one's: most often a slow agent's work for a case that
 * had already timed out, landing while the next one ran. It is left out of
 * the state, so no check here counts it, and handed back in `elsewhere` so it
 * is said rather than hidden. A refund on a payment that carries no RigorRun
 * metadata at all is outside every case, and counts here as before. (The
 * pre-registered oracle draws the same line: reports/stripe-pack-2026-10/
 * AMENDMENT-2.md, section 1.)
 *
 * A charge read only because a refund named it is read on its own: its
 * customer is somebody outside the case, and is not read.
 *
 * Lists are read to the end, up to `MAX_LIST_PAGES`. Past that, the kind of
 * record the list holds is reported as windowed — exactly as the connector
 * reports a read that answered with one page of a longer list — so a check on
 * which of those records exist abstains rather than guesses.
 *
 * A failed read throws `StateReadError`: an unknown world is never handed back
 * as an empty one. A live-mode answer is not a failed read; it stops the
 * session and passes through untouched.
 */
import {
  StateReadError,
  emptyState,
  setOwn,
  type CanonicalState,
  type EntityRow,
  type PackScope,
} from '@rigorrun/environment';
import {
  MAX_LIST_PAGES,
  PAGE_LIMIT,
  StripeApiError,
  StripeConnectionError,
  type StripeClient,
  type StripeParams,
} from './client.ts';
import { caseMarkIn, sameCase, type CaseMark } from './conventions.ts';
import { StripeScopeDataSchema } from './materialize.ts';
import { stripeSchema } from './schema.ts';
import type { StripeCharge, StripeCustomer, StripeDispute, StripeRefund } from './wire.ts';

/** A state, and the currency of every charge and refund in it. */
export interface StripeReadResult {
  state: CanonicalState;
  /**
   * Object id to its lower-case currency. Kept beside the state, not in it:
   * the schema has no currency field, because amounts are only ever compared
   * within one case's single currency, and a reality line still has to say
   * whether 2500 is $25.00 or ¥2500.
   */
  currencies: Map<string, string>;
  /**
   * Refunds the account-wide window found on payments RigorRun made for some
   * other case, left out of `state`. Empty when there were none.
   */
  elsewhere: LateWrite[];
}

/** A refund that landed on another case's payment while this case's reads looked. */
export interface LateWrite {
  refund: string;
  amount: number;
  currency: string;
  status: string;
  charge: string;
  /** The case the payment was made for, as its metadata names it. */
  madeFor: CaseMark;
}

export interface ReadOptions {
  /** Default `MAX_LIST_PAGES`. */
  maxPages?: number;
}

/** Stripe answers a deleted customer with a stub that says so. */
type MaybeDeletedCustomer = StripeCustomer & { deleted?: boolean };

/**
 * Everything the scope covers. `null` — no case materialized yet — reads
 * nothing and answers with a world that holds nothing, which is what the
 * contract asks for.
 */
export async function readCase(
  client: StripeClient,
  scope: PackScope | null,
  options: ReadOptions = {},
): Promise<StripeReadResult> {
  const currencies = new Map<string, string>();
  if (scope === null) return { state: emptyState(stripeSchema), currencies, elsewhere: [] };

  const parsed = StripeScopeDataSchema.safeParse(scope.data);
  if (!parsed.success) {
    // Not a failed read: the pack was handed a scope it never made.
    throw new Error('The Stripe pack was asked to read a scope it did not create.');
  }
  const data = parsed.data;
  const maxPages = options.maxPages ?? MAX_LIST_PAGES;
  const reader = new Reader(client, maxPages);

  const customers = new Map<string, StripeCustomer>();
  const charges = new Map<string, StripeCharge>();
  const refunds = new Map<string, StripeRefund>();
  const disputes = new Map<string, StripeDispute>();

  for (const id of data.customers) {
    const customer = await reader.retrieve<MaybeDeletedCustomer>(`/v1/customers/${id}`);
    // A deleted customer is gone; the projection should see it gone.
    if (customer !== undefined && customer.deleted !== true) customers.set(customer.id, customer);
    const owned = await reader.list<StripeCharge>(
      '/v1/charges',
      { customer: id },
      'Charge',
      `the charges of ${id}`,
    );
    for (const charge of owned) charges.set(charge.id, charge);
  }

  // Every case charge is listed under its customer; one that is not (a charge
  // moved, or a customer deleted) is still the case's, so it is fetched.
  for (const id of data.charges) {
    if (charges.has(id)) continue;
    const charge = await reader.retrieve<StripeCharge>(`/v1/charges/${id}`);
    if (charge !== undefined) charges.set(charge.id, charge);
  }

  for (const id of [...charges.keys()].sort()) {
    const onCharge = await reader.list<StripeRefund>(
      '/v1/refunds',
      { charge: id },
      'Refund',
      `the refunds on ${id}`,
    );
    for (const refund of onCharge) refunds.set(refund.id, refund);
    const disputed = await reader.list<StripeDispute>(
      '/v1/disputes',
      { charge: id },
      'Dispute',
      `the disputes on ${id}`,
    );
    for (const dispute of disputed) disputes.set(dispute.id, dispute);
  }

  const recent = await reader.list<StripeRefund>(
    '/v1/refunds',
    { created: { gte: data.createdGte } },
    'Refund',
    'the refunds created in the account since the case began',
  );
  for (const refund of recent) refunds.set(refund.id, refund);

  // A refund on a charge outside the case: read the charge it names, so the
  // refund is seen against a real charge and its owner rather than nothing.
  const outside = [...refunds.values()]
    .map((refund) => idOf(refund.charge))
    .filter((id): id is string => id !== null && !charges.has(id));
  const elsewhere: LateWrite[] = [];
  for (const id of [...new Set(outside)].sort()) {
    const charge = await reader.retrieve<StripeCharge>(`/v1/charges/${id}`);
    if (charge === undefined) continue;
    const madeFor = caseMarkIn(charge.metadata);
    if (madeFor !== null && (data.owner === undefined || !sameCase(madeFor, data.owner))) {
      // Another case's payment: its refunds are that case's, said, not counted.
      for (const refund of [...refunds.values()]) {
        if (idOf(refund.charge) !== id) continue;
        refunds.delete(refund.id);
        elsewhere.push({
          refund: refund.id,
          amount: refund.amount,
          currency: refund.currency,
          status: refund.status,
          charge: id,
          madeFor,
        });
      }
      continue;
    }
    charges.set(charge.id, charge);
  }

  const state = emptyState(stripeSchema);
  const put = (entity: string, row: EntityRow & { id: string }) => {
    const table = state.entities[entity];
    if (table) setOwn(table, row.id, row);
  };
  for (const customer of customers.values()) put('Customer', customerRow(customer));
  for (const charge of charges.values()) {
    put('Charge', chargeRow(charge));
    currencies.set(charge.id, charge.currency);
  }
  for (const refund of refunds.values()) {
    put('Refund', refundRow(refund));
    currencies.set(refund.id, refund.currency);
  }
  for (const dispute of disputes.values()) put('Dispute', disputeRow(dispute));

  const windowed = reader.windowed;
  return {
    state: Object.keys(windowed).length > 0 ? { ...state, windowed } : state,
    currencies,
    elsewhere: elsewhere.sort((a, b) => a.refund.localeCompare(b.refund)),
  };
}

// -------------------------------------------------------------------- reading

class Reader {
  /** Kind of record to why which of them exist cannot be known. */
  readonly windowed: Record<string, string> = {};

  constructor(
    private readonly client: StripeClient,
    private readonly maxPages: number,
  ) {}

  /** One object, or `undefined` when Stripe says there is no such thing. */
  async retrieve<T>(path: string): Promise<T | undefined> {
    try {
      return await this.client.get<T>(path);
    } catch (error) {
      if (
        error instanceof StripeApiError &&
        (error.status === 404 || error.code === 'resource_missing')
      ) {
        return undefined;
      }
      throw failed(`GET ${path}`, error);
    }
  }

  /** A whole list. Past the page cap, `kind` is marked windowed and what was read is kept. */
  async list<T extends { id: string }>(
    path: string,
    params: StripeParams,
    kind: string,
    what: string,
  ): Promise<T[]> {
    try {
      const { data, truncated } = await this.client.listAll<T>(path, params, {
        maxPages: this.maxPages,
      });
      if (truncated && this.windowed[kind] === undefined) {
        this.windowed[kind] =
          `Stripe's list of ${what} ran past ${this.maxPages} pages of ${PAGE_LIMIT}, and ` +
          'RigorRun reads no further, so records beyond them are unseen rather than absent';
      }
      return data;
    } catch (error) {
      throw failed(`GET ${path} (${what})`, error);
    }
  }
}

/** A Stripe failure as a read that did not answer; anything else passes through. */
function failed(read: string, error: unknown): unknown {
  if (error instanceof StripeApiError || error instanceof StripeConnectionError) {
    return new StateReadError(read, error.message);
  }
  return error;
}

// ----------------------------------------------------------------------- rows

/** An id, whether Stripe sent it bare or expanded into the object it names. */
function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return null;
}

/**
 * Only the schema's fields: nothing else Stripe sends can be judged by
 * accident. Of a charge's metadata, only the order reference is kept.
 */
function customerRow(customer: StripeCustomer): EntityRow & { id: string } {
  return { id: customer.id, email: customer.email ?? null, name: customer.name ?? null };
}

function chargeRow(charge: StripeCharge): EntityRow & { id: string } {
  return {
    id: charge.id,
    customer: idOf(charge.customer),
    payment_intent: idOf(charge.payment_intent),
    amount: charge.amount,
    amount_refunded: charge.amount_refunded,
    refunded: charge.refunded,
    disputed: charge.disputed,
    status: charge.status,
    order_ref: charge.metadata?.['order_ref'] ?? null,
  };
}

function refundRow(refund: StripeRefund): EntityRow & { id: string } {
  return {
    id: refund.id,
    charge: idOf(refund.charge),
    payment_intent: idOf(refund.payment_intent),
    amount: refund.amount,
    status: refund.status,
    reason: refund.reason ?? null,
  };
}

function disputeRow(dispute: StripeDispute): EntityRow & { id: string } {
  return { id: dispute.id, charge: idOf(dispute.charge), status: dispute.status };
}
