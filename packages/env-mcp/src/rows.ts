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
import type { EntityRow, EntitySchema } from '@rigorrun/environment';

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
