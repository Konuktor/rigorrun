/**
 * The slice of Stripe's HTTP API this pack speaks, as types.
 *
 * One declaration for both ends: the client that reads a real Stripe account,
 * and the twin that imitates one. Declaring them once is what makes the twin's
 * drift something the compiler and the golden conformance file can catch,
 * rather than something a run discovers.
 *
 * Only the fields something in this pack reads are declared. Stripe sends many
 * more, and adds fields without a version change, so both ends must accept
 * objects that carry extra keys and must never require one not listed here.
 */
import type {
  CHARGE_STATUSES,
  DISPUTE_STATUSES,
  REFUND_REASONS,
  REFUND_STATUSES,
} from './schema.ts';

/** Stripe metadata: string keys to string values, at most 50 of them. */
export type Metadata = Record<string, string>;

export type ChargeStatus = (typeof CHARGE_STATUSES)[number];
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type RefundReason = (typeof REFUND_REASONS)[number];
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'canceled'
  | 'succeeded';

export interface StripeCustomer {
  id: string;
  object: 'customer';
  email: string | null;
  name: string | null;
  metadata: Metadata;
  /** Unix seconds, by Stripe's clock. */
  created: number;
  livemode: boolean;
}

export interface StripeCharge {
  id: string;
  object: 'charge';
  amount: number;
  amount_refunded: number;
  currency: string;
  customer: string | null;
  payment_intent: string | null;
  refunded: boolean;
  disputed: boolean;
  status: ChargeStatus;
  metadata: Metadata;
  created: number;
  livemode: boolean;
}

export interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  currency: string;
  customer: string | null;
  status: PaymentIntentStatus;
  /** An id, or the whole charge when the request asked for `expand[]=latest_charge`. */
  latest_charge: string | StripeCharge | null;
  metadata: Metadata;
  created: number;
  livemode: boolean;
}

/** Stripe's refund object carries no `livemode`; the charge it names does. */
export interface StripeRefund {
  id: string;
  object: 'refund';
  amount: number;
  charge: string | null;
  payment_intent: string | null;
  currency: string;
  status: RefundStatus;
  reason: RefundReason | null;
  metadata: Metadata;
  created: number;
}

export interface StripeDispute {
  id: string;
  object: 'dispute';
  amount: number;
  charge: string;
  payment_intent: string | null;
  currency: string;
  status: DisputeStatus;
  reason: string;
  metadata: Metadata;
  created: number;
  livemode: boolean;
}

export interface StripeBalanceAmount {
  amount: number;
  currency: string;
}

/** `GET /v1/balance`: read before anything else, to prove the key is a test key. */
export interface StripeBalance {
  object: 'balance';
  livemode: boolean;
  available: StripeBalanceAmount[];
  pending: StripeBalanceAmount[];
}

/** One page of a list. `has_more` means there is another page, never that this one is all. */
export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

// ---------------------------------------------------------------- requests

/** Test payment methods Stripe provides in test mode, and the twin honours. */
export const TEST_PAYMENT_METHODS = {
  /** Succeeds, and the charge stays undisputed. */
  succeeds: 'pm_card_visa',
  /** Succeeds, and a dispute is opened against the charge shortly afterwards. */
  disputed: 'pm_card_createDispute',
} as const;

export interface CustomerCreateParams {
  email?: string;
  name?: string;
  metadata?: Metadata;
}

export interface PaymentIntentCreateParams {
  amount: number;
  currency: string;
  customer?: string;
  payment_method?: string;
  payment_method_types?: string[];
  confirm?: boolean;
  metadata?: Metadata;
  expand?: string[];
}

export interface RefundCreateParams {
  charge?: string;
  payment_intent?: string;
  /** Minor units. Absent means the whole remaining amount. */
  amount?: number;
  reason?: RefundReason;
  metadata?: Metadata;
}

// ------------------------------------------------------------------ errors

/**
 * The error codes this pack's cases and the twin depend on.
 *
 * Every one is Stripe's own spelling. A reused idempotency key is reported by
 * Stripe through the error's `type`, `idempotency_error`; it is listed here so
 * the twin and the client name that refusal the same way.
 */
export const STRIPE_ERROR_CODES = [
  'charge_already_refunded',
  'amount_too_large',
  'charge_disputed',
  'resource_missing',
  'parameter_invalid_integer',
  'parameter_missing',
  'idempotency_error',
] as const;
export type StripeErrorCode = (typeof STRIPE_ERROR_CODES)[number];

export const STRIPE_ERROR_TYPES = [
  'api_error',
  'card_error',
  'idempotency_error',
  'invalid_request_error',
] as const;
export type StripeErrorType = (typeof STRIPE_ERROR_TYPES)[number];

/**
 * Typed loosely on purpose. The twin only ever sends the types and codes listed
 * above; real Stripe may send others, and a client that refused to recognise an
 * error it had not heard of would read a refusal as a success.
 */
export interface StripeError {
  /** One of `STRIPE_ERROR_TYPES` from the twin. */
  type: string;
  /** Absent on some errors. One of `STRIPE_ERROR_CODES` from the twin. */
  code?: string;
  message: string;
  /** The request parameter at fault, in bracket notation, e.g. `metadata[order_ref]`. */
  param?: string;
}

/** Every non-2xx body Stripe sends. */
export interface StripeErrorBody {
  error: StripeError;
}

/** Whether a parsed response body is Stripe's error shape. */
export function isStripeErrorBody(body: unknown): body is StripeErrorBody {
  if (body === null || typeof body !== 'object') return false;
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return false;
  const { type, message } = error as { type?: unknown; message?: unknown };
  return typeof type === 'string' && typeof message === 'string';
}
