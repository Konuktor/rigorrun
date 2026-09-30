/**
 * Canonical state — the shape every environment reports the world in.
 *
 * Two collections of rows keyed by id, and nothing else. No projection, no
 * joins, no judgement. Everything RigorRun asks about the world is computed
 * from this plus the declared schema, which is why an adapter cannot smuggle a
 * domain opinion into the verifier even by accident.
 */
import type { EntitySchema, EnvironmentSchema } from './schema.ts';

export type EntityRow = Record<string, unknown>;

export interface CanonicalState {
  entities: Record<string, Record<string, EntityRow>>;
  /**
   * Kinds of record a read answered with one page of a longer list, and why
   * that is known. Records outside the page are not absent, so which of these
   * exist cannot be read from this state. Absent when every read was complete.
   */
  windowed?: Record<string, string>;
}

/** An action the environment recorded actually happening, in order. */
export interface EnvEvent {
  type: string;
  /** Monotonic ordinal within the case. Logical, not wall-clock. */
  ordinal: number;
  at: number;
  payload: Record<string, unknown>;
  ok: boolean;
  error?: string;
}

export interface StateSnapshot {
  state: CanonicalState;
  events: EnvEvent[];
  config: Record<string, string>;
  clock: number;
}

export function emptyState(schema: EnvironmentSchema): CanonicalState {
  const entities: Record<string, Record<string, EntityRow>> = {};
  for (const entity of schema.entities) entities[entity.name] = {};
  return { entities };
}

/** Structural clone that does not depend on `structuredClone` being present. */
export function cloneState(state: CanonicalState): CanonicalState {
  return JSON.parse(JSON.stringify(state)) as CanonicalState;
}

export function rowsOf(state: CanonicalState, entityName: string): EntityRow[] {
  const table = state.entities[entityName];
  if (!table) return [];
  // Sorted by id so every downstream consumer sees one deterministic order.
  return Object.keys(table)
    .sort()
    .map((id) => table[id])
    .filter((row): row is EntityRow => row !== undefined);
}

export function rowById(
  state: CanonicalState,
  entityName: string,
  id: unknown,
): EntityRow | undefined {
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  return state.entities[entityName]?.[String(id)];
}

/** A table's rows with the keys they are stored under, in key order. */
export function entriesOf(state: CanonicalState, entityName: string): [string, EntityRow][] {
  const table = state.entities[entityName];
  if (!table) return [];
  return Object.keys(table)
    .sort()
    .map((key): [string, EntityRow | undefined] => [key, table[key]])
    .filter((entry): entry is [string, EntityRow] => entry[1] !== undefined);
}

/**
 * The key a row is stored under, and the only place one is worked out.
 *
 * A record named by one field keeps that field's value as its key, exactly as
 * it always has. One named by several fields is keyed by all of them together,
 * with null a value like any other: the report row for "no project" is still a
 * row. One with no established identity is keyed by its content, and
 * `keyedRows` numbers identical rows so that two of them stay two. `undefined`
 * when the row does not carry what names it.
 */
export function recordKey(entity: EntitySchema, row: EntityRow): string | undefined {
  if (entity.identity === 'unestablished') {
    return JSON.stringify(entity.fields.map((field) => scalarOrNull(row[field.name])));
  }
  if (entity.keyFields !== undefined && entity.keyFields.length > 0) {
    if (!entity.keyFields.some((field) => row[field] !== undefined)) return undefined;
    const values = entity.keyFields.map((field) => row[field] ?? null);
    if (values.some((value) => typeof value === 'object' && value !== null)) return undefined;
    return JSON.stringify(values);
  }
  const id = row[entity.idField];
  return id === undefined || id === null ? undefined : String(id);
}

/**
 * The rows of one answer under their keys. Identical rows of a record with no
 * established identity are numbered, so both are kept; rows that do not carry
 * what names them are left out.
 */
export function keyedRows(entity: EntitySchema, rows: readonly EntityRow[]): [string, EntityRow][] {
  const occurrences = new Map<string, number>();
  const keyed: [string, EntityRow][] = [];
  for (const row of rows) {
    const key = recordKey(entity, row);
    if (key === undefined) continue;
    if (entity.identity !== 'unestablished') {
      keyed.push([key, row]);
      continue;
    }
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    keyed.push([`${key}#${occurrence}`, row]);
  }
  return keyed;
}

function scalarOrNull(value: unknown): unknown {
  return value === undefined || (typeof value === 'object' && value !== null) ? null : value;
}

/**
 * Builds a state from plain arrays, which is how fixtures are written.
 * Rows are keyed by what names them, through `recordKey`.
 */
export function stateFromRows(
  schema: EnvironmentSchema,
  rows: Record<string, EntityRow[]>,
): CanonicalState {
  const state = emptyState(schema);
  for (const entity of schema.entities) {
    const table = state.entities[entity.name];
    if (!table) continue;
    const given = rows[entity.name] ?? [];
    const keyed = keyedRows(entity, given);
    if (keyed.length !== given.length) {
      throw new Error(`${entity.name} row is missing its id field "${entity.idField}"`);
    }
    for (const [key, row] of keyed) table[key] = { ...row };
  }
  return state;
}

/** Deep structural equality, used by the delta engine and the conformance kit. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  if (!leftKeys.every((key, index) => key === rightKeys[index])) return false;
  return leftKeys.every((key) => deepEqual(left[key], right[key]));
}

/**
 * Does any value inside `row` refer to `id`?
 *
 * Structured values must match a whole value. Free text must contain the id as
 * a *whole token*, delimited by something that cannot be part of an
 * identifier. The projection this replaces asked
 * `JSON.stringify(details).includes(id)`, which happily reports that an audit
 * entry references `REF-1` when it actually references `REF-10` — and audit
 * entries are exactly where "did the agent record what it did" is decided.
 */
export function rowReferences(row: EntityRow, id: string, fields?: readonly string[]): boolean {
  const candidates = fields === undefined ? Object.values(row) : fields.map((name) => row[name]);
  return candidates.some((value) => valueContainsId(value, id));
}

function valueContainsId(value: unknown, id: string): boolean {
  if (typeof value === 'number') return String(value) === id;
  if (typeof value === 'string') return value === id || containsToken(value, id);
  if (Array.isArray(value)) return value.some((item) => valueContainsId(item, id));
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) =>
      valueContainsId(item, id),
    );
  }
  return false;
}

/** Characters that can be part of an identifier, so `REF-1` never matches
 * inside `REF-10` and `REF-1a` is a different token again. */
function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_-]/.test(char);
}

function containsToken(haystack: string, id: string): boolean {
  if (id.length === 0) return false;
  for (let from = 0; ; ) {
    const at = haystack.indexOf(id, from);
    if (at === -1) return false;
    const before = at === 0 ? undefined : haystack[at - 1];
    const after = haystack[at + id.length];
    if (!isIdentifierChar(before) && !isIdentifierChar(after)) return true;
    from = at + 1;
  }
}
