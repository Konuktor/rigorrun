/**
 * Finding the records of one kind inside whatever a tool handed back.
 *
 * A read might answer with a bare record, a list, or a list wrapped in an
 * object under some key. Rather than require the operator to describe which,
 * this looks for objects whose fields match the entity's — the same structural
 * matching that induced the schema in the first place, so a shape that was
 * recognisable then stays recognisable now.
 *
 * Values that are not scalars are dropped rather than stringified. A verifier
 * assertion compares scalars; keeping a nested object here would produce a row
 * that looks complete and compares as unequal to everything.
 */
import {
  deepEqual,
  emptyState,
  keyedRows,
  type CanonicalState,
  type EntityRow,
  type EntitySchema,
  type EnvironmentSchema,
} from '@rigorrun/environment';
import { canonicalisePayload } from './result.ts';

const MAX_DEPTH = 6;

function looksLike(value: unknown, entity: EntitySchema): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = new Set(Object.keys(value));
  // What names the record must be there: its identifier, or at least one of
  // the fields that name it together (a system may omit a null dimension). A
  // record with no established identity is recognised by its fields alone.
  if (entity.identity !== 'unestablished') {
    const naming = entity.keyFields ?? [entity.idField];
    if (!naming.some((field) => keys.has(field))) return false;
  }
  // Most of the declared fields should be present. Not all: a system may omit
  // a null, and refusing the row for that would lose the record entirely.
  const present = entity.fields.filter((field) => keys.has(field.name)).length;
  return present >= Math.max(2, Math.ceil(entity.fields.length / 2));
}

function toRow(raw: Record<string, unknown>, entity: EntitySchema): EntityRow {
  const row: EntityRow = {};
  for (const field of entity.fields) {
    const value = raw[field.name];
    if (value === undefined) continue;
    if (value === null || typeof value !== 'object') row[field.name] = value;
  }
  return row;
}

export function rowsFromPayload(payload: unknown, entity: EntitySchema): EntityRow[] {
  const found: EntityRow[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (looksLike(value, entity)) {
      found.push(toRow(value, entity));
      return;
    }
    for (const nested of Object.values(value)) walk(nested, depth + 1);
  };
  // The same rewrite induction applied, so a shape recognised then is
  // recognised now — a tagged cell or a wrapped row must not match as a
  // record in one place and vanish in the other.
  walk(canonicalisePayload(payload), 0);
  return found;
}

/**
 * Everything a set of read results says about the world.
 *
 * Each payload is offered to every declared record type, and rows land wherever
 * their shape fits. That is deliberately not "the operator told us this read
 * returns bookings": at the moment somebody nominates a read, RigorRun has not
 * worked out what a booking is yet, because it works that out from these very
 * calls. Matching on structure keeps the order of operations honest, and it is
 * the same matching that induced the schema, so a shape recognised then is
 * recognised now.
 *
 * A read that returns two kinds of record at once is handled by the same
 * mechanism rather than by a special case: each type takes what fits it.
 */
export function stateFromPayloads(
  payloads: readonly unknown[],
  schema: EnvironmentSchema,
  reads: readonly ReadCall[] = [],
): CanonicalState {
  const state = emptyState(schema);
  const windowed: Record<string, string> = {};
  payloads.forEach((payload, payloadIndex) => {
    const counts = new Map<string, number>();
    for (const entity of schema.entities) counts.set(entity.name, rowsFromPayload(payload, entity).length);
    const page = pageSignal(payload, schema, reads[payloadIndex], Math.max(0, ...counts.values()));
    if (page) {
      for (const [name, count] of counts) if (count > 0 && !windowed[name]) windowed[name] = page;
    }
    for (const entity of schema.entities) {
      const table = state.entities[entity.name] ?? {};
      // Within one answer a record seen twice must be the same record. Across
      // the answers of the reads a verdict uses, the later reading stands. Those
      // are never a verifier's and the system's own at once: see readsForVerdict.
      const inThisAnswer = new Map<string, EntityRow>();
      for (const [key, row] of keyedRows(entity, rowsFromPayload(payload, entity))) {
        const earlier = inThisAnswer.get(key);
        const kept = earlier === undefined ? row : oneRecord(entity, earlier, row);
        if (kept === undefined) throw new IdentityConflictError(entity.name, key, payloadIndex);
        inThisAnswer.set(key, kept);
        table[key] = kept;
      }
      state.entities[entity.name] = table;
    }
  });
  return Object.keys(windowed).length > 0 ? { ...state, windowed } : state;
}

/** A nominated read as it was called, so a full page can be told from a complete list. */
export interface ReadCall {
  tool: string;
  args?: Record<string, unknown> | undefined;
}

// Keys compared lower-case with `_`, `-`, `$` and `@` removed, so `has_more`,
// `hasMore` and `@odata.nextLink` read alike.
const MORE_FLAGS = new Set(['hasmore', 'hasnextpage', 'moreavailable', 'moreresults', 'truncated', 'incomplete']);
const NEXT_MARKERS = new Set([
  'nextcursor',
  'nextpagetoken',
  'nextpage',
  'next',
  'nextlink',
  'odata.nextlink',
  'nexturl',
  'nextpageurl',
  'continuationtoken',
]);
const TOTALS = new Set(['total', 'totalcount', 'totalresults', 'totalsize', 'totalitems', 'totalrecords']);
const LIMIT_ARGS = new Set(['limit', 'pagesize', 'perpage', 'maxresults', 'first', 'top', 'size', 'maxitems']);
const normal = (key: string) => key.toLowerCase().replace(/[_$@-]/g, '');

/**
 * Why a read's answer is one page of something longer, or undefined when
 * nothing says so. Only the wrapper around the records is read: a record's own
 * `total` or `next` is its data, not a page marker.
 */
function pageSignal(
  payload: unknown,
  schema: EnvironmentSchema,
  read: ReadCall | undefined,
  rows: number,
): string | undefined {
  const name = read?.tool ?? 'a nominated read';
  const isRecord = (value: unknown) => schema.entities.some((entity) => looksLike(value, entity));
  let found: string | undefined;
  const walk = (value: unknown, depth: number): void => {
    if (found || depth > 3 || value === null || typeof value !== 'object' || Array.isArray(value) || isRecord(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      const k = normal(key);
      if (MORE_FLAGS.has(k) && entry === true) found = `${key} is true`;
      else if (NEXT_MARKERS.has(k) && (typeof entry === 'number' || (typeof entry === 'string' && entry !== '')))
        found = `${key} names a next page`;
      // An integer only: a `total` of 1234.56 is an amount, not a count of records.
      else if (TOTALS.has(k) && Number.isInteger(entry) && (entry as number) > rows)
        found = `${key} is ${entry}, and ${rows} came back`;
      if (found) return;
    }
    for (const entry of Object.values(value)) walk(entry, depth + 1);
  };
  walk(canonicalisePayload(payload), 0);
  if (!found) {
    for (const [key, value] of Object.entries(read?.args ?? {})) {
      if (LIMIT_ARGS.has(normal(key)) && typeof value === 'number' && rows > 0 && rows >= value) {
        found = `it was called with ${key} ${value} and ${rows} came back`;
        break;
      }
    }
  }
  return found ? `${name} returned one page of a longer list: ${found}` : undefined;
}

/**
 * Two different records in one answer that what names them says are one.
 *
 * Writing that world down would silently drop one of them, which is how a
 * record the agent created twice used to disappear. So it is not written
 * down: a live read turns this into StateReadError and the case abstains.
 */
export class IdentityConflictError extends Error {
  constructor(
    readonly entity: string,
    readonly key: string,
    readonly payloadIndex: number,
  ) {
    super(`two different ${entity} records in one answer share the identity ${key}`);
    this.name = 'IdentityConflictError';
  }
}

/** The one record two copies describe: every field both carry agrees, and the fuller copy's other fields are kept. */
function oneRecord(entity: EntitySchema, a: EntityRow, b: EntityRow): EntityRow | undefined {
  const merged: EntityRow = {};
  for (const field of entity.fields) {
    const inA = Object.prototype.hasOwnProperty.call(a, field.name);
    const inB = Object.prototype.hasOwnProperty.call(b, field.name);
    if (inA && inB && !deepEqual(a[field.name], b[field.name])) return undefined;
    if (inA) merged[field.name] = a[field.name];
    else if (inB) merged[field.name] = b[field.name];
  }
  return merged;
}
