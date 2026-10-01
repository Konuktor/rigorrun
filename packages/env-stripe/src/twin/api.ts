/**
 * The twin's endpoints: Stripe's paths, Stripe's parameters, the model's work.
 *
 * Each route works in two stages, because Stripe's idempotency layer does. The
 * first reads and checks the parameters; a refusal there is not saved against
 * an Idempotency-Key, since "no API endpoint began execution", and a retry with
 * the same key is a new attempt. The second does the work; whatever it
 * answers, success or refusal, is saved and replayed to a retry. Splitting
 * them here is what lets the server reproduce that rule without guessing.
 */
import type { FormObject } from '../form.ts';
import { REFUND_REASONS } from '../schema.ts';
import { invalidRequest } from './errors.ts';
import {
  checkExpand,
  MAXIMUM_AMOUNT,
  formatAmount,
  type PaymentIntentInput,
  type RefundInput,
  type TwinModel,
  type TwinObjectKind,
} from './model.ts';
import {
  LIST_PARAMS,
  checkHashKeys,
  checkParams,
  missing,
  nonEmptyString,
  nullableString,
  optionalBoolean,
  optionalEnum,
  optionalHash,
  optionalInteger,
  optionalStringList,
  readCreated,
  readExpand,
  readMetadata,
  readPage,
} from './params.ts';

export interface RouteRequest {
  params: FormObject;
  /** The path's captures, e.g. the id in `/v1/charges/:id`. */
  captures: string[];
  /** The `Stripe-Version` header, when the caller pinned one. */
  stripeVersion: string | undefined;
}

/** The work a request asks for, once its parameters have been accepted. */
export type Execute = () => unknown;

export interface Route {
  method: 'GET' | 'POST';
  pattern: RegExp;
  prepare(model: TwinModel, request: RouteRequest): Execute;
}

const ID = '([^/]+)';

function retrieve(kind: TwinObjectKind, path: string, inert: string[] = []): Route {
  return {
    method: 'GET',
    pattern: new RegExp(`^/v1/${path}/${ID}$`),
    prepare(model, { params, captures }) {
      checkParams(params, { modelled: ['expand'], inert });
      const expand = readExpand(params);
      checkExpand(kind, expand, false);
      const id = captures[0]!;
      return () => model.expand(kind, model.get(kind, id, 'id', 404), expand);
    },
  };
}

/**
 * A list endpoint. Each filter is a parameter named after the field it matches
 * exactly (`?customer=cus_…` keeps the objects whose `customer` is that id).
 */
function list(kind: TwinObjectKind, path: string, filters: string[], inert: string[] = []): Route {
  return {
    method: 'GET',
    pattern: new RegExp(`^/v1/${path}/?$`),
    prepare(model, { params }) {
      checkParams(params, { modelled: [...LIST_PARAMS, 'created', ...filters], inert });
      const page = readPage(params);
      const created = readCreated(params);
      const expand = readExpand(params);
      checkExpand(kind, expand, true);
      const wanted: [string, string][] = [];
      for (const field of filters) {
        const value = nonEmptyString(params, field);
        if (value !== undefined) wanted.push([field, value]);
      }
      const where = (item: object) =>
        wanted.every(([field, value]) => (item as Record<string, unknown>)[field] === value);
      return () => {
        const result = model.list(
          kind,
          created === undefined ? { where } : { where, created },
          page,
        );
        const itemPaths = expand.map((item) => item.slice('data.'.length));
        return { ...result, data: result.data.map((item) => model.expand(kind, item, itemPaths)) };
      };
    },
  };
}

// --------------------------------------------------------------- customers

const createCustomer: Route = {
  method: 'POST',
  pattern: /^\/v1\/customers\/?$/,
  prepare(model, { params }) {
    checkParams(params, {
      modelled: ['email', 'name', 'description', 'phone', 'metadata', 'expand'],
      inert: [
        'address',
        'shipping',
        'preferred_locales',
        'invoice_prefix',
        'invoice_settings',
        'next_invoice_sequence',
        'tax',
        'tax_exempt',
      ],
      unsupported: [
        'balance',
        'cash_balance',
        'coupon',
        'payment_method',
        'promotion_code',
        'source',
        'tax_id_data',
        'test_clock',
      ],
    });
    const email = nullableString(params, 'email');
    if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw invalidRequest(`Invalid email address: ${email}`, {
        code: 'email_invalid',
        param: 'email',
      });
    }
    const input = {
      email,
      name: nullableString(params, 'name'),
      description: nullableString(params, 'description'),
      phone: nullableString(params, 'phone'),
      metadata: readMetadata(params) ?? {},
    };
    const expand = readExpand(params);
    checkExpand('customer', expand, false);
    return () => model.expand('customer', model.createCustomer(input), expand);
  },
};

// --------------------------------------------------------- payment intents

/**
 * The first Stripe API version on which a PaymentIntent without
 * `payment_method_types` chooses payment methods automatically. A caller that
 * pins an earlier version (an older official library does) gets cards only, as
 * it would from Stripe.
 */
const AUTOMATIC_METHODS_SINCE = '2023-08-16';

const createPaymentIntent: Route = {
  method: 'POST',
  pattern: /^\/v1\/payment_intents\/?$/,
  prepare(model, { params, stripeVersion }) {
    checkParams(params, {
      modelled: [
        'amount',
        'currency',
        'customer',
        'payment_method',
        'confirm',
        'payment_method_types',
        'automatic_payment_methods',
        'return_url',
        'capture_method',
        'description',
        'receipt_email',
        'metadata',
        'expand',
      ],
      inert: [
        'confirmation_method',
        'error_on_requires_action',
        'off_session',
        'payment_method_options',
        'radar_options',
        'setup_future_usage',
        'shipping',
        'statement_descriptor',
        'statement_descriptor_suffix',
        'use_stripe_sdk',
      ],
      unsupported: [
        'application_fee_amount',
        'confirmation_token',
        'mandate',
        'mandate_data',
        'on_behalf_of',
        'payment_method_configuration',
        'payment_method_data',
        'transfer_data',
        'transfer_group',
      ],
    });
    const amount = optionalInteger(params, 'amount', { min: 1 });
    if (amount === undefined) missing('amount');
    const currencyRaw = nonEmptyString(params, 'currency');
    if (currencyRaw === undefined) missing('currency');
    const currency = currencyRaw.toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) {
      throw invalidRequest(`Invalid currency: ${currencyRaw}.`, { param: 'currency' });
    }
    if (amount > MAXIMUM_AMOUNT) {
      throw invalidRequest(
        `Amount must be no more than ${formatAmount(MAXIMUM_AMOUNT, currency)}`,
        { code: 'amount_too_large', param: 'amount' },
      );
    }
    let paymentMethodTypes = optionalStringList(params, 'payment_method_types') ?? null;
    const automaticHash = optionalHash(params, 'automatic_payment_methods');
    let automatic: PaymentIntentInput['automaticPaymentMethods'] = null;
    if (automaticHash !== undefined) {
      checkHashKeys(automaticHash, 'automatic_payment_methods', ['enabled', 'allow_redirects']);
      const enabled = optionalBoolean(automaticHash, 'enabled');
      if (enabled === undefined) missing('automatic_payment_methods[enabled]');
      const allowRedirects = optionalEnum(automaticHash, 'allow_redirects', [
        'always',
        'never',
      ] as const);
      automatic = { enabled };
      if (allowRedirects !== undefined) automatic.allow_redirects = allowRedirects;
    }
    if (paymentMethodTypes !== null && automatic !== null) {
      throw invalidRequest(
        'You may only specify one of these parameters: automatic_payment_methods, ' +
          'payment_method_types.',
        { param: 'automatic_payment_methods' },
      );
    }
    if (paymentMethodTypes !== null) {
      const other = paymentMethodTypes.find((type) => type !== 'card');
      if (other !== undefined) {
        throw invalidRequest(
          `The RigorRun twin models card payments only, not \`${other}\`. Run this request ` +
            'against Stripe test mode.',
          { param: 'payment_method_types' },
        );
      }
    }
    const pinned = stripeVersion?.slice(0, 10);
    if (
      paymentMethodTypes === null &&
      automatic === null &&
      pinned !== undefined &&
      pinned < AUTOMATIC_METHODS_SINCE
    ) {
      paymentMethodTypes = ['card'];
    }
    const captureMethod = optionalEnum(params, 'capture_method', [
      'automatic',
      'automatic_async',
      'manual',
    ] as const);
    if (captureMethod === 'manual') {
      throw invalidRequest(
        'The RigorRun twin does not model `capture_method=manual`. Run this request against ' +
          'Stripe test mode.',
        { param: 'capture_method' },
      );
    }
    const input: PaymentIntentInput = {
      amount,
      currency,
      customer: nonEmptyString(params, 'customer') ?? null,
      paymentMethod: nonEmptyString(params, 'payment_method') ?? null,
      confirm: optionalBoolean(params, 'confirm') ?? false,
      paymentMethodTypes,
      automaticPaymentMethods: automatic,
      returnUrl: nullableString(params, 'return_url'),
      captureMethod: captureMethod ?? 'automatic_async',
      description: nullableString(params, 'description'),
      receiptEmail: nullableString(params, 'receipt_email'),
      metadata: readMetadata(params) ?? {},
    };
    const expand = readExpand(params);
    checkExpand('payment_intent', expand, false);
    return () => model.expand('payment_intent', model.createPaymentIntent(input), expand);
  },
};

// ----------------------------------------------------------------- refunds

const createRefund: Route = {
  method: 'POST',
  pattern: /^\/v1\/refunds\/?$/,
  prepare(model, { params }) {
    checkParams(params, {
      modelled: ['charge', 'payment_intent', 'amount', 'reason', 'metadata', 'expand'],
      inert: ['instructions_email', 'refund_application_fee', 'reverse_transfer'],
      unsupported: ['origin', 'customer', 'currency'],
    });
    const charge = nonEmptyString(params, 'charge');
    const paymentIntent = nonEmptyString(params, 'payment_intent');
    const amount = optionalInteger(params, 'amount', { min: 1 });
    const reason = optionalEnum(
      params,
      'reason',
      REFUND_REASONS.filter((value) => value !== 'expired_uncaptured_charge'),
    );
    if (charge === undefined && paymentIntent === undefined) {
      throw invalidRequest(
        'One of the following params should be provided for this request: payment_intent or ' +
          'charge.',
        // Without a code or a param, as Stripe test mode answers it.
        {},
      );
    }
    const input: RefundInput = { reason: reason ?? null, metadata: readMetadata(params) ?? {} };
    if (charge !== undefined) input.charge = charge;
    if (paymentIntent !== undefined) input.paymentIntent = paymentIntent;
    if (amount !== undefined) input.amount = amount;
    const expand = readExpand(params);
    checkExpand('refund', expand, false);
    return () => model.expand('refund', model.createRefund(input), expand);
  },
};

// ----------------------------------------------------------------- balance

const getBalance: Route = {
  method: 'GET',
  pattern: /^\/v1\/balance\/?$/,
  prepare(model, { params }) {
    checkParams(params, { modelled: ['expand'] });
    if (readExpand(params).length > 0) {
      throw invalidRequest('This property cannot be expanded.', { param: 'expand' });
    }
    return () => model.balance();
  },
};

/**
 * Stripe's Search API, which the twin does not implement. Without this a
 * search would fall through to "No such charge: 'search'", which reads like an
 * answer from Stripe; this says what is missing instead.
 */
function search(path: string): Route {
  return {
    method: 'GET',
    pattern: new RegExp(`^/v1/${path}/search/?$`),
    prepare() {
      throw invalidRequest(
        `The RigorRun twin does not implement the Search API (GET /v1/${path}/search). ` +
          `List with filters instead, e.g. GET /v1/${path}?customer=…`,
        { status: 404 },
      );
    },
  };
}

/** Every route the twin answers, in match order. */
export const ROUTES: readonly Route[] = [
  createCustomer,
  search('customers'),
  search('charges'),
  search('payment_intents'),
  list('customer', 'customers', ['email'], ['test_clock']),
  retrieve('customer', 'customers'),
  createPaymentIntent,
  list('payment_intent', 'payment_intents', ['customer']),
  retrieve('payment_intent', 'payment_intents', ['client_secret']),
  list('charge', 'charges', ['customer', 'payment_intent'], ['transfer_group']),
  retrieve('charge', 'charges'),
  createRefund,
  list('refund', 'refunds', ['charge', 'payment_intent']),
  retrieve('refund', 'refunds'),
  list('dispute', 'disputes', ['charge', 'payment_intent']),
  retrieve('dispute', 'disputes'),
  getBalance,
];

/** The route for a method and path, with the path's captures, or `undefined`. */
export function matchRoute(
  method: string,
  path: string,
): { route: Route; captures: string[] } | undefined {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (match) return { route, captures: match.slice(1).map(decodePathPart) };
  }
  return undefined;
}

/** A path segment as sent; one that is not valid percent-encoding is looked up as written. */
function decodePathPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
