/**
 * The twin's refusals, in Stripe's shape.
 *
 * Every error the twin sends is `{ error: { type, code?, message, param?,
 * doc_url? } }` with one of the four types Stripe documents (`STRIPE_ERROR_TYPES`).
 * Stripe has no `authentication_error` or `permission_error` type on the wire:
 * a missing or bad key is a 401 and a key without the permission is a 403, both
 * typed `invalid_request_error`. The official libraries name their exception
 * classes after the status, not the type, so a client that branches on the
 * type must see what Stripe sends.
 *
 * A `code` is attached only where Stripe documents one for the situation. An
 * error Stripe sends without a code is sent here without one, because a client
 * that learnt to depend on a code the twin invented would break on the real API.
 */
import type { StripeError, StripeErrorBody, StripeErrorType } from '../wire.ts';

/** Stripe's error object, with the link it adds whenever there is a code. */
export interface TwinErrorDetail extends StripeError {
  doc_url?: string;
}

export interface TwinErrorBody extends StripeErrorBody {
  error: TwinErrorDetail;
}

/** A refusal on its way to the caller: status, Stripe's body, and any extra headers. */
export class TwinError extends Error {
  readonly body: TwinErrorBody;
  readonly headers: Record<string, string>;

  constructor(
    readonly status: number,
    type: StripeErrorType,
    message: string,
    options: { code?: string; param?: string; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'TwinError';
    // In Stripe's key order, which is alphabetical.
    const detail = {} as TwinErrorDetail;
    if (options.code !== undefined) {
      detail.code = options.code;
      detail.doc_url = `https://stripe.com/docs/error-codes/${options.code.replace(/_/g, '-')}`;
    }
    detail.message = message;
    if (options.param !== undefined) detail.param = options.param;
    detail.type = type;
    this.body = { error: detail };
    this.headers = options.headers ?? {};
  }
}

/** A 400 (or the given status) of type `invalid_request_error`. */
export function invalidRequest(
  message: string,
  options: { code?: string; param?: string; status?: number } = {},
): TwinError {
  const { status = 400, ...rest } = options;
  return new TwinError(status, 'invalid_request_error', message, rest);
}

/** Stripe's wording for an id it cannot find, as a path segment (404) or a parameter (400). */
export function noSuch(noun: string, id: string, param: string, status: 400 | 404): TwinError {
  return invalidRequest(`No such ${noun}: '${id}'`, { code: 'resource_missing', param, status });
}

/**
 * A key as Stripe prints it in an error: the mode prefix, then asterisks, then
 * the last four characters. The whole key is never echoed, not even a fake one,
 * so nothing that logs responses can collect keys from the twin.
 */
export function redactKey(key: string): string {
  const prefix = /^(sk|rk|pk)_(test|live)_/.exec(key)?.[0] ?? '';
  const rest = key.slice(prefix.length);
  if (rest.length <= 4) return `${prefix}${'*'.repeat(rest.length)}`;
  return `${prefix}${'*'.repeat(rest.length - 4)}${rest.slice(-4)}`;
}
