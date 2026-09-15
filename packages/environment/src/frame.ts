/**
 * What a job changed, for every kind of record, and what reading the world
 * twice proves about the reads themselves (audit IO-5).
 *
 * Both are built on `diffStates`, the one definition of what changed. A field
 * is only ever set aside because two readings with nothing in between showed it
 * changing — never because of its type — and the whole schema is covered, not
 * only the kinds of record a demonstration happened to touch.
 */
import type {
  DemonstratedFrame,
  EntityReadStability,
  FrameEntityObservation,
  FrameObservation,
} from '@rigorrun/core';
import { diffStates, type StateDelta } from './delta.ts';
import type { EnvironmentSchema } from './schema.ts';
import type { CanonicalState } from './state.ts';

function sortedEntities(schema: EnvironmentSchema) {
  return [...schema.entities].sort((a, b) => a.name.localeCompare(b.name));
}

/** Each kind of record's creations, deletions and changed records, from a list of deltas. */
function summarise(schema: EnvironmentSchema, deltas: readonly StateDelta[]) {
  const summary: Record<string, { created: string[]; deleted: string[]; updated: { key: string; fields: string[] }[] }> = {};
  for (const entity of sortedEntities(schema)) {
    const own = deltas.filter((delta) => delta.entity === entity.name);
    const fieldsByKey = new Map<string, Set<string>>();
    for (const delta of own) {
      if (delta.kind === 'entity_created' || delta.kind === 'entity_deleted') continue;
      const fields = fieldsByKey.get(delta.id) ?? new Set<string>();
      fields.add(delta.field);
      fieldsByKey.set(delta.id, fields);
    }
    summary[entity.name] = {
      created: own.filter((delta) => delta.kind === 'entity_created').map((delta) => delta.id).sort(),
      deleted: own.filter((delta) => delta.kind === 'entity_deleted').map((delta) => delta.id).sort(),
      updated: [...fieldsByKey.keys()].sort().map((key) => ({ key, fields: [...(fieldsByKey.get(key) ?? [])].sort() })),
    };
  }
  return summary;
}

/**
 * What two readings taken with nothing in between prove, per kind of record.
 *
 * A field that differs for the same record was changed by the reading itself —
 * a mailbox marking what it lists as seen. Records that appear or disappear
 * between the two mean the kind's membership cannot be attributed to anyone.
 */
export function readStability(
  schema: EnvironmentSchema,
  first: CanonicalState,
  second: CanonicalState,
): Record<string, EntityReadStability> {
  const summary = summarise(schema, diffStates(schema, first, second));
  const stability: Record<string, EntityReadStability> = {};
  for (const [name, changed] of Object.entries(summary)) {
    stability[name] = {
      volatileFields: [...new Set(changed.updated.flatMap((entry) => entry.fields))].sort(),
      membershipUnstable: changed.created.length > 0 || changed.deleted.length > 0,
    };
  }
  return stability;
}

/**
 * The evidence a `state_frame` check reads: what the case changed, per kind of
 * record, with what the readings at each end proved about themselves.
 */
export function frameObservation(
  schema: EnvironmentSchema,
  deltas: readonly StateDelta[],
  baseline: Record<string, EntityReadStability> | 'installed_seed',
  final: Record<string, EntityReadStability>,
): FrameObservation {
  const summary = summarise(schema, deltas);
  const entities: Record<string, FrameEntityObservation> = {};
  for (const [name, changed] of Object.entries(summary)) {
    const atStart = baseline === 'installed_seed' ? undefined : baseline[name];
    const atEnd = final[name];
    entities[name] = {
      ...changed,
      volatileFields: [...new Set([...(atStart?.volatileFields ?? []), ...(atEnd?.volatileFields ?? [])])].sort(),
      membershipUnstable: (atStart?.membershipUnstable ?? false) || (atEnd?.membershipUnstable ?? false),
    };
  }
  return {
    proof: { baseline: baseline === 'installed_seed' ? 'installed_seed' : 'double_read', final: 'double_read' },
    entities,
  };
}

/** What a demonstration did to every kind of record in the schema, touched or not. */
export function demonstratedFrame(
  schema: EnvironmentSchema,
  before: CanonicalState,
  after: CanonicalState,
): DemonstratedFrame {
  const summary = summarise(schema, diffStates(schema, before, after));
  const entities: DemonstratedFrame['entities'] = {};
  for (const entity of sortedEntities(schema)) {
    const changed = summary[entity.name] ?? { created: [], deleted: [], updated: [] };
    entities[entity.name] = {
      preExistingRows: Object.keys(before.entities[entity.name] ?? {}).length,
      created: changed.created.length,
      deleted: changed.deleted.length,
      updatedRows: changed.updated.length,
      updatedFields: [...new Set(changed.updated.flatMap((entry) => entry.fields))].sort(),
      identity: entity.identity === 'unestablished' ? 'unestablished' : 'named',
    };
  }
  return { entities };
}
