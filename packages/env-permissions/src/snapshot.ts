/**
 * What one side of the server shows: the rows its read tools return, each
 * tagged with its owner, and the server's audit log when the matrix names one.
 * Read through the side's own credential, so B's snapshot is B's view of B.
 */
import { createHash } from 'node:crypto';
import { emptyState, setOwn, type CanonicalState, type EntityRow } from '@rigorrun/environment';
import { permissionsSchema } from './schema.ts';

/** Calls one tool and returns its JSON result. Throws on an error result. */
export type ToolCaller = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface ReadSpec {
  tool: string;
  args: Record<string, unknown>;
  /** Dotted path to the row array in the result; "" when the result is the array. */
  rows: string;
  /** What the rows are, in the matrix's words (e.g. the entity's plural). */
  entity: string;
  /**
   * Call once per row of an entity read earlier, passing that row's `field` as
   * the argument `arg` — for records reached through another (a booking
   * through its client). A row without the tenant field takes its parent's
   * owner: whose it is runs through the relation.
   */
  for_each?: { entity: string; arg: string; field: string };
}

export interface SnapshotRow {
  entity: string;
  rowId: string;
  owner: string | null;
  row: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  actor: string | null;
  owner: string | null;
  detail: string;
}

/** A dotted path inside a value; `""` is the value itself. */
export function at(value: unknown, path: string): unknown {
  if (path === '') return value;
  let current = value;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 32);
}

/** Every row the reads return, tagged with its owner by `tenantField`. */
export async function snapshot(
  call: ToolCaller,
  reads: readonly ReadSpec[],
  tenantField: string,
): Promise<SnapshotRow[]> {
  const out: SnapshotRow[] = [];
  const take = (read: ReadSpec, result: unknown, parentOwner: string | null) => {
    const rows = at(result, read.rows);
    if (!Array.isArray(rows)) {
      throw new Error(`${read.tool} did not return a list at "${read.rows || '(the result)'}"`);
    }
    for (const row of rows) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;
      const owner = at(record, tenantField);
      const id = record['id'];
      out.push({
        entity: read.entity,
        rowId: typeof id === 'string' || typeof id === 'number' ? String(id) : digest(record),
        owner: typeof owner === 'string' || typeof owner === 'number' ? String(owner) : parentOwner,
        row: record,
      });
    }
  };
  for (const read of reads) {
    if (!read.for_each) {
      take(read, await call(read.tool, read.args), null);
      continue;
    }
    const { entity, arg, field } = read.for_each;
    const parents = out.filter((row) => row.entity === entity);
    for (const parent of parents) {
      const key = at(parent.row, field);
      if (typeof key !== 'string' && typeof key !== 'number') continue;
      take(read, await call(read.tool, { ...read.args, [arg]: key }), parent.owner);
    }
  }
  return out;
}

export interface AuditSpec {
  rows: string;
  ownerField: string;
  actorField: string;
}

/** The audit rows of a raw audit result, newest last. */
export function auditRows(result: unknown, spec: AuditSpec): AuditRow[] {
  const rows = at(result, spec.rows);
  if (!Array.isArray(rows)) throw new Error(`the audit source has no list at "${spec.rows}"`);
  return rows
    .filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
    .map((row) => {
      const owner = at(row, spec.ownerField);
      const actor = at(row, spec.actorField);
      return {
        id: digest(row),
        actor: typeof actor === 'string' || typeof actor === 'number' ? String(actor) : null,
        owner: typeof owner === 'string' || typeof owner === 'number' ? String(owner) : null,
        detail: canonical(row),
      };
    });
}

/**
 * The canonical state of one read: every row of both sides, and the audit
 * rows. A row's key is its entity and id, so the same record read through
 * either side is one row.
 */
export function canonicalState(
  rows: readonly SnapshotRow[],
  audit: readonly AuditRow[],
): CanonicalState {
  const state = emptyState(permissionsSchema);
  const table = state.entities['Row']!;
  for (const row of rows) {
    setOwn(table, `${row.entity}:${row.rowId}`, {
      id: `${row.entity}:${row.rowId}`,
      entity: row.entity,
      row_id: row.rowId,
      owner: row.owner,
      digest: digest(row.row),
      content: canonical(row.row),
    } as EntityRow);
  }
  const log = state.entities['Audit']!;
  for (const entry of audit) setOwn(log, entry.id, { ...entry } as EntityRow);
  return state;
}
