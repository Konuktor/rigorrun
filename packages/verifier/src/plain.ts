/**
 * What a check looked at, in words a person reads without the path language.
 *
 * A failed check used to read `derived.all.Refund[customerId=C-1].length = 3,
 * required <= 1`. That is exact, and it is the sentence a founder reading a
 * report skips. The same fact — three records where the customer is C-1, and
 * at most one allowed — is what this module writes instead.
 *
 * Only the shapes the compiler and generator emit are translated, and each one
 * says no more than the path does: a record kind, the view it is read from,
 * the filter as written. Anything else is returned as `undefined`, and the
 * caller keeps the path. A sentence that guessed at a path it did not
 * recognise would be a second, unmeasured account of the check.
 */
import { closingBracket, splitClauses } from '@rigorrun/core';

export type PlainTarget =
  | { kind: 'records'; noun: string; where: string; counted: boolean }
  | { kind: 'occurred'; action: string }
  | { kind: 'order'; first: string; second: string };

const VIEWS: Record<string, string> = {
  created: 'new ',
  all: '',
  changed: 'changed ',
  deleted: 'deleted ',
};

const RECORDS = /^derived\.(created|all|changed|deleted)\.([A-Za-z_][\w]*)(\[.*\])?(\.(?:length|count))?$/;
const OCCURRED = /^derived\.events\.occurred\.([\w.-]+)$/;
const ORDER_PREFIX = 'derived.events.orderOk.';
const BEFORE = '__before__';
const ACTION = /^[\w.-]+$/;

export function plainTarget(target: string): PlainTarget | undefined {
  const occurred = OCCURRED.exec(target);
  if (occurred) return { kind: 'occurred', action: occurred[1]! };
  // Split rather than matched: a pattern with `__before__` between two runs of
  // word characters backtracks on a long enough name.
  if (target.startsWith(ORDER_PREFIX)) {
    const pair = target.slice(ORDER_PREFIX.length);
    const at = pair.indexOf(BEFORE);
    const first = pair.slice(0, at);
    const second = pair.slice(at + BEFORE.length);
    if (at > 0 && ACTION.test(first) && ACTION.test(second)) return { kind: 'order', first, second };
    return undefined;
  }

  const records = RECORDS.exec(target);
  if (!records) return undefined;
  const [, view, entity, filter, counted] = records;
  // The bracket has to close at the end: `[a][b]` is a second filter this
  // module does not describe, and a path it does not describe keeps its path.
  if (filter && closingBracket(filter, 0) !== filter.length - 1) return undefined;
  const conditions = filter ? describeFilter(filter.slice(1, -1)) : '';
  if (conditions === undefined) return undefined;
  return { kind: 'records', noun: `${VIEWS[view!]}${entity} record`, where: conditions, counted: Boolean(counted) };
}

/** `3 new Refund records where customerId is C-1` — the noun, counted and filtered. */
export function countOf(target: PlainTarget, n: unknown): string {
  if (target.kind !== 'records') return '';
  const plural = n === 1 ? '' : 's';
  return `${String(n)} ${target.noun}${plural}${target.where ? ` where ${target.where}` : ''}`;
}

/** `a new Refund record where amount is above 50` — the noun, once. */
export function oneOf(target: PlainTarget): string {
  if (target.kind !== 'records') return '';
  return `a ${target.noun}${target.where ? ` where ${target.where}` : ''}`;
}

const OPERATORS: Record<string, string> = {
  '=': 'is',
  '!=': 'is not',
  '>': 'is above',
  '<': 'is below',
  '>=': 'is at least',
  '<=': 'is at most',
  '~=': 'contains',
};

function describeFilter(inner: string): string | undefined {
  const parts: string[] = [];
  for (const clause of splitClauses(inner)) {
    const match = /^\s*([A-Za-z0-9_.]+)\s*(!=|>=|<=|~=|=|>|<)\s*(.*?)\s*$/.exec(clause);
    if (!match) return undefined;
    const [, field, op, raw] = match;
    const value = raw!.length >= 2 && raw!.startsWith('"') && raw!.endsWith('"') ? raw!.slice(1, -1) : raw!;
    // `<link>__exists` is how a filter asks whether a linked record is there.
    const link = /^(.+)__exists$/.exec(field!);
    if (link && (value === 'true' || value === 'false') && (op === '=' || op === '!=')) {
      const has = (op === '=') === (value === 'true');
      parts.push(`${has ? 'with' : 'with no'} ${link[1]}`);
      continue;
    }
    parts.push(`${field} ${OPERATORS[op!]} ${value}`);
  }
  return parts.join(' and ');
}
