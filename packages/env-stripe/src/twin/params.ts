/**
 * Reading a request's parameters the way Stripe does.
 *
 * Stripe is strict about what it is sent, and an agent that is wrong about a
 * parameter should learn that from the twin exactly as it would from Stripe: a
 * misspelt name is `parameter_unknown`, a required one left out is
 * `parameter_missing`, an amount that is not a whole number is
 * `parameter_invalid_integer`, and an empty value for something that cannot be
 * unset is `parameter_invalid_empty`. Accepting what Stripe would refuse is the
 * most expensive way a twin can drift, because the agent passes here and fails
 * on the real API.
 *
 * Every endpoint declares its parameters in three groups. Modelled ones change
 * what the twin does. Inert ones are real Stripe parameters that make no
 * difference to anything the twin records (a phone number, a shipping
 * address), so they are accepted and dropped. Unsupported ones are real
 * parameters whose effect the twin does not model (connected accounts, manual
 * capture): they are refused with a message saying so, rather than ignored, so
 * a run never passes because the twin skipped what Stripe would have done.
 */
import { setOwn } from '@rigorrun/environment';
import { FormDecodeError, asList, type FormObject, type FormValue } from '../form.ts';
import type { Metadata } from '../wire.ts';
import { invalidRequest } from './errors.ts';

export interface ParamSpec {
  modelled: readonly string[];
  inert?: readonly string[];
  unsupported?: readonly string[];
}

/** Refuses any top-level parameter the endpoint does not declare. */
export function checkParams(params: FormObject, spec: ParamSpec): void {
  for (const name of Object.keys(params)) {
    if (spec.modelled.includes(name) || spec.inert?.includes(name)) continue;
    if (spec.unsupported?.includes(name)) {
      throw invalidRequest(
        `The RigorRun twin does not model \`${name}\`. Run this request against Stripe test mode.`,
        { param: name },
      );
    }
    throw invalidRequest(`Received unknown parameter: ${name}`, {
      code: 'parameter_unknown',
      param: name,
    });
  }
}

/** Refuses any key inside a hash parameter (`name[key]`) that is not listed. */
export function checkHashKeys(value: FormObject, name: string, keys: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw invalidRequest(`Received unknown parameter: ${name}[${key}]`, {
        code: 'parameter_unknown',
        param: `${name}[${key}]`,
      });
    }
  }
}

function describe(value: FormValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** A single string value, or `undefined` when the parameter was not sent. */
export function optionalString(params: FormObject, name: string): string | undefined {
  const value = Object.hasOwn(params, name) ? params[name] : undefined;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw invalidRequest(`Invalid string: ${describe(value)}`, { param: name });
  }
  return value;
}

/**
 * A string Stripe cannot treat as "unset": an empty value is refused with
 * Stripe's own explanation, since Stripe reads an empty value as an attempt to
 * clear the field.
 */
export function nonEmptyString(params: FormObject, name: string): string | undefined {
  const value = optionalString(params, name);
  if (value === '') {
    throw invalidRequest(
      `You passed an empty string for '${name}'. We assume empty values are an attempt to unset ` +
        `a parameter; however '${name}' cannot be unset. You should remove '${name}' from your ` +
        `request or supply a non-empty value.`,
      { code: 'parameter_invalid_empty', param: name },
    );
  }
  return value;
}

export function requiredString(params: FormObject, name: string): string {
  const value = nonEmptyString(params, name);
  if (value === undefined) throw missing(name);
  return value;
}

export function missing(name: string): never {
  throw invalidRequest(`Missing required param: ${name}.`, {
    code: 'parameter_missing',
    param: name,
  });
}

/** A string that is optional, but may not be empty when it is sent (an email, a name). */
export function nullableString(params: FormObject, name: string): string | null {
  const value = optionalString(params, name);
  return value === undefined || value === '' ? null : value;
}

const INTEGER = /^-?[0-9]+$/;

/**
 * A whole number within bounds. Stripe reads `2500.0`, `25.00` and `1e3` as
 * not integers at all, which is the refusal an agent that sends a major-unit
 * amount with decimals gets.
 */
export function optionalInteger(
  params: FormObject,
  name: string,
  bounds: { min?: number; max?: number } = {},
  /** How the parameter is named in an error, when it sits inside a hash (`created[gte]`). */
  param: string = name,
): number | undefined {
  const raw = Object.hasOwn(params, name) ? params[name] : undefined;
  if (raw === undefined) return undefined;
  const refuse = (message: string) =>
    invalidRequest(message, { code: 'parameter_invalid_integer', param });
  if (typeof raw !== 'string' || !INTEGER.test(raw))
    throw refuse(`Invalid integer: ${describe(raw)}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw refuse(`Invalid integer: ${raw}`);
  if (bounds.min !== undefined && value < bounds.min) {
    throw refuse(`This value must be greater than or equal to ${bounds.min}.`);
  }
  if (bounds.max !== undefined && value > bounds.max) {
    throw refuse(`This value must be less than or equal to ${bounds.max}.`);
  }
  return value;
}

export function optionalBoolean(params: FormObject, name: string): boolean | undefined {
  const raw = Object.hasOwn(params, name) ? params[name] : undefined;
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw invalidRequest(`Invalid boolean: ${describe(raw)}`, { param: name });
}

/** One of a fixed set of values, worded as Stripe words it. */
export function optionalEnum<T extends string>(
  params: FormObject,
  name: string,
  values: readonly T[],
): T | undefined {
  const value = optionalString(params, name);
  if (value === undefined) return undefined;
  if (!(values as readonly string[]).includes(value)) {
    const listed =
      values.length > 1
        ? `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`
        : values.join('');
    throw invalidRequest(`Invalid ${name}: must be one of ${listed}`, { param: name });
  }
  return value as T;
}

/** A hash parameter (`name[key]=…`), or `undefined` when not sent. */
export function optionalHash(params: FormObject, name: string): FormObject | undefined {
  const value = Object.hasOwn(params, name) ? params[name] : undefined;
  if (value === undefined) return undefined;
  if (typeof value === 'string' || Array.isArray(value)) {
    throw invalidRequest(`Invalid object`, { param: name });
  }
  return value;
}

/** A list of strings, written `name[]=a` or with indices. */
export function optionalStringList(params: FormObject, name: string): string[] | undefined {
  const raw = Object.hasOwn(params, name) ? params[name] : undefined;
  let list: FormValue[] | undefined;
  try {
    list = asList(raw, name);
  } catch (error) {
    if (error instanceof FormDecodeError) throw invalidRequest(`Invalid array`, { param: name });
    throw error;
  }
  if (list === undefined) return undefined;
  return list.map((item, index) => {
    if (typeof item !== 'string') {
      throw invalidRequest(`Invalid string: ${describe(item)}`, { param: `${name}[${index}]` });
    }
    return item;
  });
}

/**
 * Metadata as Stripe takes it: at most 50 keys, keys up to 40 characters and
 * values up to 500. An empty value removes a key, and `metadata=` with nothing
 * removes them all, which on a create means none.
 */
export function readMetadata(params: FormObject, existing: Metadata = {}): Metadata | undefined {
  const raw = Object.hasOwn(params, 'metadata') ? params['metadata'] : undefined;
  if (raw === undefined) return undefined;
  if (raw === '') return {};
  if (typeof raw === 'string' || Array.isArray(raw)) {
    throw invalidRequest('Invalid hash', { param: 'metadata' });
  }
  const result: Metadata = { ...existing };
  for (const [key, value] of Object.entries(raw)) {
    const param = `metadata[${key}]`;
    if (typeof value !== 'string') throw invalidRequest('Invalid string', { param });
    if (key.length > 40) {
      throw invalidRequest(`Metadata keys can have up to 40 characters. Key '${key}' is longer.`, {
        param,
      });
    }
    if (value.length > 500) {
      throw invalidRequest(`Metadata values can have up to 500 characters.`, { param });
    }
    if (value === '') delete result[key];
    else setOwn(result, key, value);
  }
  if (Object.keys(result).length > 50) {
    throw invalidRequest('You can have up to 50 metadata keys.', { param: 'metadata' });
  }
  return result;
}

/** `expand[]=…`, as a list of dotted paths. */
export function readExpand(params: FormObject): string[] {
  return optionalStringList(params, 'expand') ?? [];
}

/** A range filter on `created`: `created=<ts>` or `created[gte]=<ts>` and its kin. */
export interface CreatedFilter {
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

export function readCreated(params: FormObject): CreatedFilter | undefined {
  const raw = Object.hasOwn(params, 'created') ? params['created'] : undefined;
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const exact = optionalInteger(params, 'created');
    return exact === undefined ? undefined : { gte: exact, lte: exact };
  }
  if (Array.isArray(raw)) throw invalidRequest('Invalid hash', { param: 'created' });
  checkHashKeys(raw, 'created', ['gt', 'gte', 'lt', 'lte']);
  const filter: CreatedFilter = {};
  for (const bound of ['gt', 'gte', 'lt', 'lte'] as const) {
    const value = optionalInteger(raw, bound, {}, `created[${bound}]`);
    if (value !== undefined) filter[bound] = value;
  }
  return filter;
}

export function matchesCreated(created: number, filter: CreatedFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.gt !== undefined && !(created > filter.gt)) return false;
  if (filter.gte !== undefined && !(created >= filter.gte)) return false;
  if (filter.lt !== undefined && !(created < filter.lt)) return false;
  if (filter.lte !== undefined && !(created <= filter.lte)) return false;
  return true;
}

/** `limit`, `starting_after` and `ending_before`, as every list endpoint takes them. */
export interface PageParams {
  limit: number;
  startingAfter?: string;
  endingBefore?: string;
}

export const LIST_PARAMS = ['limit', 'starting_after', 'ending_before', 'expand'] as const;

export function readPage(params: FormObject): PageParams {
  const limit = optionalInteger(params, 'limit', { min: 1, max: 100 }) ?? 10;
  const startingAfter = nonEmptyString(params, 'starting_after');
  const endingBefore = nonEmptyString(params, 'ending_before');
  if (startingAfter !== undefined && endingBefore !== undefined) {
    throw invalidRequest(
      'You may only specify one of these parameters: ending_before, starting_after.',
      { param: 'ending_before' },
    );
  }
  const page: PageParams = { limit };
  if (startingAfter !== undefined) page.startingAfter = startingAfter;
  if (endingBefore !== undefined) page.endingBefore = endingBefore;
  return page;
}
