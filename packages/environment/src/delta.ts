/**
 * What changed between two states.
 *
 * This is the whole of RigorRun's observation step. It reports facts — a row
 * appeared, a field moved from one value to another, a link was set — and
 * stops there. Deciding that a fact implies a *rule* is a separate step done
 * by the compiler, with a confidence and a question attached, because watching
 * somebody do a job once does not reveal their policy.
 *
 * Keeping the two apart in code is what lets the product say "observed" and
 * "inferred" and mean it.
 */
import { entityByName, type EnvironmentSchema, type RelationshipSchema } from './schema.ts';
import { deepEqual, type CanonicalState, type EntityRow } from './state.ts';

export type StateDelta =
  | { kind: 'entity_created'; entity: string; id: string; row: EntityRow }
  | { kind: 'entity_deleted'; entity: string; id: string; row: EntityRow }
  | {
      kind: 'field_changed';
      entity: string;
      id: string;
      field: string;
      from: unknown;
      to: unknown;
    }
  | {
      kind: 'relationship_set';
      entity: string;
      id: string;
      relationship: string;
      field: string;
      target: string;
    }
  | {
      kind: 'relationship_cleared';
      entity: string;
      id: string;
      relationship: string;
      field: string;
      previous: string;
    };

/**
 * Deltas in a stable order: entity name, then row id, then field name. Two
 * runs of the same case must produce byte-identical deltas or replay
 * stability is meaningless.
 */
export function diffStates(
  schema: EnvironmentSchema,
  before: CanonicalState,
  after: CanonicalState,
): StateDelta[] {
  const deltas: StateDelta[] = [];
  const entities = [...schema.entities].sort((a, b) => a.name.localeCompare(b.name));

  for (const entity of entities) {
    const previous = before.entities[entity.name] ?? {};
    const current = after.entities[entity.name] ?? {};
    const ids = [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort();

    for (const id of ids) {
      const was = previous[id];
      const now = current[id];

      if (!was && now) {
        deltas.push({ kind: 'entity_created', entity: entity.name, id, row: now });
        continue;
      }
      if (was && !now) {
        deltas.push({ kind: 'entity_deleted', entity: entity.name, id, row: was });
        continue;
      }
      if (!was || !now) continue;

      const fields = [...new Set([...Object.keys(was), ...Object.keys(now)])].sort();
      for (const field of fields) {
        if (deepEqual(was[field], now[field])) continue;

        const relationship = relationshipForField(schema, entity.name, field);
        if (relationship) {
          const target = now[field];
          const previousTarget = was[field];
          if (target !== null && target !== undefined) {
            deltas.push({
              kind: 'relationship_set',
              entity: entity.name,
              id,
              relationship: relationship.name,
              field,
              target: String(target),
            });
          } else if (previousTarget !== null && previousTarget !== undefined) {
            deltas.push({
              kind: 'relationship_cleared',
              entity: entity.name,
              id,
              relationship: relationship.name,
              field,
              previous: String(previousTarget),
            });
          }
          continue;
        }

        deltas.push({
          kind: 'field_changed',
          entity: entity.name,
          id,
          field,
          from: was[field] ?? null,
          to: now[field] ?? null,
        });
      }
    }
  }

  return deltas;
}

/**
 * Entities the work actually touched.
 *
 * Everything downstream — which rules are even considered, how far the
 * projection reaches — is rooted here rather than at every entity in the
 * schema. The demonstration is what tells us which part of a large system the
 * job is about.
 */
export function focusEntities(deltas: readonly StateDelta[]): string[] {
  return [...new Set(deltas.map((delta) => delta.entity))].sort();
}

/** Rows created during the observed work, by entity. */
export function createdRows(deltas: readonly StateDelta[]): Record<string, EntityRow[]> {
  const out: Record<string, EntityRow[]> = {};
  for (const delta of deltas) {
    if (delta.kind !== 'entity_created') continue;
    (out[delta.entity] ??= []).push(delta.row);
  }
  return out;
}

/** A relationship whose foreign key is this field on this entity, if any. */
export function relationshipForField(
  schema: EnvironmentSchema,
  entityName: string,
  field: string,
): RelationshipSchema | undefined {
  return schema.relationships.find((relationship) => {
    if (relationship.via.kind !== 'fk') return false;
    const holder = relationship.cardinality === 'one' ? relationship.from : relationship.to;
    return holder === entityName && relationship.via.field === field;
  });
}

/** Human-readable delta, used in the contract review UI and the report. */
export function describeDelta(schema: EnvironmentSchema, delta: StateDelta): string {
  const label = entityByName(schema, delta.entity)?.label ?? delta.entity;
  switch (delta.kind) {
    case 'entity_created':
      return `${label} ${delta.id} was created`;
    case 'entity_deleted':
      return `${label} ${delta.id} was removed`;
    case 'field_changed':
      return `${label} ${delta.id}: ${delta.field} changed ${format(delta.from)} → ${format(delta.to)}`;
    case 'relationship_set':
      return `${label} ${delta.id} was linked to ${delta.target} via ${delta.relationship}`;
    case 'relationship_cleared':
      return `${label} ${delta.id} was unlinked from ${delta.previous} (${delta.relationship})`;
  }
}

function format(value: unknown): string {
  if (value === null || value === undefined) return 'nothing';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}
