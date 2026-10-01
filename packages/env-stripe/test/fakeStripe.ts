/**
 * A hand-written stand-in for Stripe, for the pack's client-side tests.
 *
 * Not the twin: it answers only what the client, the key guard, materializing,
 * reading and the actions call, with Stripe-shaped JSON, and it records every
 * request so a test can say exactly what went over the wire. Scripted answers
 * (a 429, a live-mode object, an error) are queued ahead of the normal ones.
 */
import { decodeForm, type FormObject, type FormValue } from '../src/form.ts';

export interface RecordedCall {
  method: string;
  path: string;
  query: FormObject;
  body: FormObject;
  headers: Record<string, string>;
}

export interface ScriptedAnswer {
  /** Which request it answers; the next request of any kind when absent. */
  match?: (call: RecordedCall) => boolean;
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FakeStripeOptions {
  /** Objects per page, whatever `limit` asks for. Default 100. */
  pageSize?: number;
  /** Retrievals of a dispute-card charge before it reads disputed; `never` keeps it undisputed. */
  disputeAfterPolls?: number | 'never';
  /** Stripe copies PaymentIntent metadata onto the charge. Off to imitate a server that does not. */
  copyMetadata?: boolean;
  /** Return `latest_charge` expanded when asked. Off to make the client fetch the charge. */
  expand?: boolean;
  /** Rewrites a successful answer, e.g. to mark something live. */
  tamper?: (call: RecordedCall, body: Record<string, unknown>) => Record<string, unknown>;
}

type Obj = Record<string, unknown> & { id: string; created: number };

export class FakeStripe {
  readonly calls: RecordedCall[] = [];
  readonly customers = new Map<string, Obj>();
  readonly intents = new Map<string, Obj>();
  readonly charges = new Map<string, Obj>();
  readonly refunds = new Map<string, Obj>();
  readonly disputes = new Map<string, Obj>();
  /** Unix seconds; every object created moves it on by one. */
  clock = 1_790_000_000;

  private readonly script: ScriptedAnswer[] = [];
  private readonly idempotent = new Map<
    string,
    { params: string; status: number; body: unknown }
  >();
  private readonly polls = new Map<string, number>();
  private sequence = 1000;

  constructor(private readonly options: FakeStripeOptions = {}) {}

  /** Answers the next matching request with this, ahead of everything else. */
  enqueue(answer: ScriptedAnswer, times = 1): void {
    for (let index = 0; index < times; index += 1) this.script.push(answer);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: decodeForm(url.search.replace(/^\?/, '')),
      body: decodeForm(typeof init?.body === 'string' ? init.body : ''),
      headers,
    };
    this.calls.push(call);

    const scripted = this.script.findIndex((answer) => answer.match?.(call) ?? true);
    if (scripted !== -1) {
      const [answer] = this.script.splice(scripted, 1);
      return respond(answer!.status, answer!.body ?? {}, answer!.headers);
    }

    const auth = headers['authorization'] ?? '';
    if (!/^Bearer (sk|rk)_test_/.test(auth)) {
      return respond(
        ...error(401, 'invalid_request_error', undefined, 'Invalid API Key provided.'),
      );
    }

    const key = headers['idempotency-key'];
    const params = JSON.stringify(call.body);
    if (call.method === 'POST' && key !== undefined) {
      const earlier = this.idempotent.get(key);
      if (earlier) {
        if (earlier.params !== params) {
          return respond(...error(400, 'idempotency_error', undefined, 'Key reused.'));
        }
        return respond(earlier.status, earlier.body);
      }
    }

    const [status, body] = this.route(call);
    if (call.method === 'POST' && key !== undefined) {
      this.idempotent.set(key, { params, status, body });
    }
    const tampered =
      status < 300 && this.options.tamper
        ? this.options.tamper(call, body as Record<string, unknown>)
        : body;
    return respond(status, tampered);
  };

  // ------------------------------------------------------------ test helpers

  /** A customer and a succeeded charge made by somebody else, outside any case. */
  outsider(amount: number): { customer: string; charge: string } {
    const customer = this.makeCustomer({ email: 'outsider@example.com', name: 'Outsider' });
    const charge = this.makeCharge(customer.id, amount, 'usd', {}, 'pm_card_visa');
    return { customer: customer.id, charge: charge.id };
  }

  /** A new succeeded payment from an existing customer, as an agent with its own key could take one. */
  charge(customer: string, amount: number): string {
    return this.makeCharge(customer, amount, 'usd', {}, 'pm_card_visa').id;
  }

  /** What Stripe answers for a customer once it is deleted: a stub that says so. */
  deleteCustomer(id: string): void {
    const customer = this.customers.get(id);
    if (!customer) throw new Error(`no customer ${id}`);
    this.customers.set(id, { id, object: 'customer', deleted: true, created: customer.created });
  }

  /** A refund made directly, as an agent with its own key would make one. */
  refund(charge: string, amount?: number): string {
    const [status, body] = this.createRefund({
      charge,
      ...(amount === undefined ? {} : { amount: String(amount) }),
    });
    if (status !== 200) throw new Error(`fake refund refused: ${JSON.stringify(body)}`);
    return (body as Obj).id;
  }

  // ---------------------------------------------------------------- routing

  private route(call: RecordedCall): [number, unknown] {
    const { method, path } = call;
    const parts = path.split('/').filter(Boolean);
    const [, resource, id] = parts;
    if (method === 'GET' && path === '/v1/balance') {
      return [200, { object: 'balance', livemode: false, available: [], pending: [] }];
    }
    if (method === 'POST' && path === '/v1/customers') {
      return [200, this.makeCustomer(call.body)];
    }
    if (method === 'POST' && path === '/v1/payment_intents') return this.createIntent(call.body);
    if (method === 'POST' && path === '/v1/refunds') return this.createRefund(call.body);
    if (method === 'GET' && id !== undefined) {
      const table = this.table(resource);
      const found = table?.get(id);
      if (!found) return error(404, 'invalid_request_error', 'resource_missing', `No such ${id}`);
      if (resource === 'charges') this.poll(found);
      return [200, found];
    }
    if (method === 'GET' && resource !== undefined) {
      const table = this.table(resource);
      if (!table) return error(404, 'invalid_request_error', undefined, 'Unrecognized request URL');
      return [200, this.list(path, [...table.values()], call.query)];
    }
    return error(404, 'invalid_request_error', undefined, 'Unrecognized request URL');
  }

  private table(resource: string | undefined): Map<string, Obj> | undefined {
    switch (resource) {
      case 'customers':
        return this.customers;
      case 'payment_intents':
        return this.intents;
      case 'charges':
        return this.charges;
      case 'refunds':
        return this.refunds;
      case 'disputes':
        return this.disputes;
      default:
        return undefined;
    }
  }

  private list(path: string, all: Obj[], query: FormObject): unknown {
    const filters: [string, FormValue][] = Object.entries(query).filter(
      ([name]) => !['limit', 'starting_after', 'created', 'expand'].includes(name),
    );
    let rows = all.filter((row) => filters.every(([name, value]) => row[name] === value));
    const created = query['created'];
    if (created !== undefined && typeof created === 'object' && !Array.isArray(created)) {
      const gte = created['gte'];
      if (typeof gte === 'string') rows = rows.filter((row) => row.created >= Number(gte));
    }
    // Newest first, as Stripe lists.
    rows = rows.reverse();
    const after = query['starting_after'];
    if (typeof after === 'string') {
      const at = rows.findIndex((row) => row.id === after);
      rows = rows.slice(at + 1);
    }
    const limit = Math.min(
      Number(typeof query['limit'] === 'string' ? query['limit'] : 10),
      this.options.pageSize ?? 100,
    );
    return { object: 'list', url: path, data: rows.slice(0, limit), has_more: rows.length > limit };
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_RR${this.sequence}`;
  }

  private makeCustomer(body: FormObject): Obj {
    this.clock += 1;
    const customer: Obj = {
      id: this.nextId('cus'),
      object: 'customer',
      email: body['email'] ?? null,
      name: body['name'] ?? null,
      metadata: body['metadata'] ?? {},
      created: this.clock,
      livemode: false,
    };
    this.customers.set(customer.id, customer);
    return customer;
  }

  private makeCharge(
    customer: string,
    amount: number,
    currency: string,
    metadata: FormValue,
    method: string,
    intent: string | null = null,
  ): Obj {
    this.clock += 1;
    const charge: Obj = {
      id: this.nextId('ch'),
      object: 'charge',
      amount,
      amount_refunded: 0,
      currency,
      customer,
      payment_intent: intent,
      refunded: false,
      disputed: false,
      status: 'succeeded',
      metadata: this.options.copyMetadata === false ? {} : metadata,
      created: this.clock,
      livemode: false,
      payment_method_details: { type: 'card', card: { brand: 'visa' } },
      _disputeCard: method === 'pm_card_createDispute',
    };
    this.charges.set(charge.id, charge);
    return charge;
  }

  private createIntent(body: FormObject): [number, unknown] {
    const customer = body['customer'];
    if (typeof customer !== 'string' || !this.customers.has(customer)) {
      return error(
        400,
        'invalid_request_error',
        'resource_missing',
        'No such customer',
        'customer',
      );
    }
    this.clock += 1;
    const id = this.nextId('pi');
    const amount = Number(body['amount']);
    const currency = String(body['currency']);
    const method = String(body['payment_method']);
    const charge = this.makeCharge(customer, amount, currency, body['metadata'] ?? {}, method, id);
    const expand = body['expand'];
    const expanded =
      this.options.expand !== false && Array.isArray(expand) && expand.includes('latest_charge');
    const intent: Obj = {
      id,
      object: 'payment_intent',
      amount,
      currency,
      customer,
      status: body['confirm'] === 'true' ? 'succeeded' : 'requires_confirmation',
      latest_charge: charge.id,
      metadata: body['metadata'] ?? {},
      created: this.clock,
      livemode: false,
    };
    this.intents.set(id, intent);
    return [200, expanded ? { ...intent, latest_charge: charge } : intent];
  }

  private createRefund(body: FormObject): [number, unknown] {
    const chargeId = body['charge'];
    const charge = typeof chargeId === 'string' ? this.charges.get(chargeId) : undefined;
    if (!charge) {
      return error(400, 'invalid_request_error', 'resource_missing', 'No such charge', 'charge');
    }
    if (charge['disputed'] === true) {
      return error(400, 'invalid_request_error', 'charge_disputed', 'Charge is disputed.');
    }
    const remaining = Number(charge['amount']) - Number(charge['amount_refunded']);
    if (remaining <= 0) {
      return error(400, 'invalid_request_error', 'charge_already_refunded', 'Already refunded.');
    }
    const amount = body['amount'] === undefined ? remaining : Number(body['amount']);
    if (!Number.isInteger(amount)) {
      return error(
        400,
        'invalid_request_error',
        'parameter_invalid_integer',
        'Invalid integer',
        'amount',
      );
    }
    if (amount > remaining) {
      return error(400, 'invalid_request_error', 'amount_too_large', 'Amount too large', 'amount');
    }
    this.clock += 1;
    const refund: Obj = {
      id: this.nextId('re'),
      object: 'refund',
      amount,
      charge: charge.id,
      payment_intent: charge['payment_intent'],
      currency: charge['currency'],
      status: 'succeeded',
      reason: body['reason'] ?? null,
      metadata: body['metadata'] ?? {},
      created: this.clock,
    };
    this.refunds.set(refund.id, refund);
    charge['amount_refunded'] = Number(charge['amount_refunded']) + amount;
    charge['refunded'] = charge['amount_refunded'] === charge['amount'];
    return [200, refund];
  }

  /** A dispute-card charge reads disputed after enough retrievals. */
  private poll(charge: Obj): void {
    if (charge['_disputeCard'] !== true || charge['disputed'] === true) return;
    const after = this.options.disputeAfterPolls ?? 0;
    if (after === 'never') return;
    const seen = (this.polls.get(charge.id) ?? 0) + 1;
    this.polls.set(charge.id, seen);
    if (seen < after) return;
    charge['disputed'] = true;
    this.clock += 1;
    const dispute: Obj = {
      id: this.nextId('dp'),
      object: 'dispute',
      amount: charge['amount'],
      charge: charge.id,
      payment_intent: charge['payment_intent'],
      currency: charge['currency'],
      status: 'needs_response',
      reason: 'fraudulent',
      metadata: {},
      created: this.clock,
      livemode: false,
    };
    this.disputes.set(dispute.id, dispute);
  }
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function error(
  status: number,
  type: string,
  code: string | undefined,
  message: string,
  param?: string,
): [number, unknown] {
  return [
    status,
    {
      error: {
        type,
        message,
        ...(code === undefined ? {} : { code }),
        ...(param === undefined ? {} : { param }),
      },
    },
  ];
}
