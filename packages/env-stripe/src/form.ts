/**
 * Stripe's form encoding, both ways.
 *
 * Stripe takes `application/x-www-form-urlencoded` bodies with nested values
 * written in bracket notation — `metadata[order_ref]=A1`, `expand[]=x`,
 * `items[0][price]=p` — and reads query strings the same way. The pack's client
 * encodes with this file and the twin decodes with it, so the two cannot
 * disagree about where a bracket goes.
 *
 * Decoding is literal, the way Stripe's own Rack-style parser is: `[]` appends
 * to a list, and `[0]` is a key like any other. Whether `expand[0]` was meant
 * as a list is a fact about the parameter that only the endpoint knows, so the
 * endpoint asks `asList`. That matters because agents call the twin through
 * Stripe's official libraries, and those write lists with indices.
 *
 * Keys come from whoever sent the request, so they are stored as own
 * properties: `__proto__` is an ordinary parameter name here, not a way in.
 */
import { setOwn } from '@rigorrun/environment';

export type FormScalar = string | number | boolean | null;

/** What can be encoded. `undefined` is left out; `null` is sent empty, Stripe's way of unsetting. */
export type FormInput =
  FormScalar | undefined | readonly FormInput[] | { readonly [key: string]: FormInput };

/** What decoding produces: every leaf a string, as it arrived. */
export type FormValue = string | FormValue[] | FormObject;
export interface FormObject {
  [key: string]: FormValue;
}

/** A body or query string that is not well-formed bracket notation. */
export class FormDecodeError extends Error {
  constructor(
    /** The parameter at fault, as sent. */
    readonly param: string,
    detail: string,
  ) {
    super(`${param} ${detail}`);
    this.name = 'FormDecodeError';
  }
}

/**
 * Encodes parameters as Stripe expects them.
 *
 * Lists of scalars are written `key[]=a&key[]=b`; lists holding objects are
 * written with indices, `key[0][field]=a`, because `[]` cannot say which
 * element a nested field belongs to. Empty lists and objects send nothing.
 */
export function encodeForm(params: { readonly [key: string]: FormInput }): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) collect(encodeKey(key), value, pairs);
  return pairs.join('&');
}

function collect(prefix: string, value: FormInput, pairs: string[]): void {
  if (value === undefined) return;
  if (value === null) {
    pairs.push(`${prefix}=`);
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`${prefix} is ${value}, which cannot be sent as a number.`);
  }
  if (typeof value !== 'object') {
    pairs.push(`${prefix}=${encodeURIComponent(String(value))}`);
    return;
  }
  if (isList(value)) {
    const scalars = value.every((item) => item === null || typeof item !== 'object');
    value.forEach((item, index) =>
      collect(scalars ? `${prefix}[]` : `${prefix}[${index}]`, item, pairs),
    );
    return;
  }
  for (const [key, item] of Object.entries(value))
    collect(`${prefix}[${encodeKey(key)}]`, item, pairs);
}

function isList(value: FormInput): value is readonly FormInput[] {
  return Array.isArray(value);
}

/** Stripe refuses brackets in a key, and one here would change the nesting it reads. */
function encodeKey(key: string): string {
  if (key === '' || /[[\]]/.test(key)) {
    throw new Error(`"${key}" cannot be a parameter name: it is empty or contains a bracket.`);
  }
  return encodeURIComponent(key);
}

/** A key: a name, then any number of `[segment]`s. Linear: no segment can match a bracket. */
const KEY = /^([^[\]]+)((?:\[[^[\]]*\])*)$/;
const SEGMENT = /\[([^[\]]*)\]/g;

/**
 * Decodes a form body, or a query string without its `?`.
 *
 * Every value stays a string; which ones are numbers or booleans is the
 * endpoint's to decide, as it is Stripe's. A parameter given twice keeps the
 * last value, except through `[]`, which collects them.
 */
export function decodeForm(body: string): FormObject {
  const root: FormObject = {};
  for (const part of body.split('&')) {
    if (part === '') continue;
    const at = part.indexOf('=');
    const rawKey = at === -1 ? part : part.slice(0, at);
    const key = decodeComponent(rawKey, rawKey);
    const value = at === -1 ? '' : decodeComponent(part.slice(at + 1), key);
    const match = KEY.exec(key);
    if (!match) throw new FormDecodeError(key, 'is not a parameter name in bracket notation.');
    const path = [match[1]!, ...[...match[2]!.matchAll(SEGMENT)].map((segment) => segment[1]!)];
    insert(root, path, value, key);
  }
  return root;
}

function decodeComponent(text: string, param: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    throw new FormDecodeError(param, 'is not valid percent-encoding.');
  }
}

function insert(root: FormObject, path: readonly string[], value: string, param: string): void {
  const appendOnly =
    'may end in [] but not continue after it: a list of objects is written with indices.';
  const mixed = 'is given both as a single value and as a set of keys or a list.';
  let node = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]!;
    if (key === '') throw new FormDecodeError(param, appendOnly);
    const existing = Object.hasOwn(node, key) ? node[key] : undefined;
    if (path[index + 1] === '') {
      if (index + 1 !== path.length - 1) throw new FormDecodeError(param, appendOnly);
      if (existing === undefined) setOwn<FormValue>(node, key, [value]);
      else if (Array.isArray(existing)) existing.push(value);
      else throw new FormDecodeError(param, mixed);
      return;
    }
    if (existing === undefined) {
      const child: FormObject = {};
      setOwn<FormValue>(node, key, child);
      node = child;
    } else if (typeof existing === 'string' || Array.isArray(existing)) {
      throw new FormDecodeError(param, mixed);
    } else {
      node = existing;
    }
  }
  const leaf = path[path.length - 1]!;
  const existing = Object.hasOwn(node, leaf) ? node[leaf] : undefined;
  if (existing !== undefined && typeof existing !== 'string')
    throw new FormDecodeError(param, mixed);
  setOwn<FormValue>(node, leaf, value);
}

/**
 * A parameter the endpoint takes as a list, however it was written: `x[]=a`
 * arrives as a list already, and `x[0]=a&x[1]=b` as keys read in numeric
 * order. `undefined` when it was not sent at all.
 */
export function asList(value: FormValue | undefined, param: string): FormValue[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') throw new FormDecodeError(param, 'must be a list.');
  const keys = Object.keys(value);
  if (!keys.every((key) => /^(0|[1-9][0-9]*)$/.test(key))) {
    throw new FormDecodeError(param, 'must be a list.');
  }
  return keys
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => value[String(index)]!);
}
