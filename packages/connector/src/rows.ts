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
  emptyState,
  type CanonicalState,
  type EntityRow,
  type EntitySchema,
  type EnvironmentSchema,
} from '@rigorrun/environment';

const MAX_DEPTH = 6;

function looksLike(value: unknown, entity: EntitySchema): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = new Set(Object.keys(value));
  if (!keys.has(entity.idField)) return false;
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
  walk(payload, 0);
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
): CanonicalState {
  const state = emptyState(schema);
  for (const payload of payloads) {
    for (const entity of schema.entities) {
      const table = state.entities[entity.name] ?? {};
      for (const row of rowsFromPayload(payload, entity)) {
        const id = row[entity.idField];
        if (id === undefined || id === null) continue;
        table[String(id)] = row;
      }
      state.entities[entity.name] = table;
    }
  }
  return state;
}
