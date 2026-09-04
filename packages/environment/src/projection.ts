/**
 * The generic projection.
 *
 * Assertions need to ask joined questions — "was the order this refund names
 * owned by the customer the refund names", "was the ticket open when work
 * began" — and the verifier must stay domain-blind while they do. Previously
 * that gap was closed by a human hand-writing a `derived` object per domain,
 * which is why the "generic" verifier only ever worked on refunds.
 *
 * This computes the same class of facts from the declared schema alone: rows
 * that appeared, related rows hoisted onto them, the same rows as they were at
 * seed time, agreement between two paths that reach the same kind of thing,
 * counts, event ordinals and reference checks.
 *
 * Two properties it is responsible for:
 *
 *  1. **Determinism.** Keys are generated in a fixed order — entity, then
 *     relationship, then field, each ascending. Object key order is a real
 *     source of nondeterminism, and replay stability depends on there being
 *     none of it here.
 *
 *  2. **A published key schema.** Every path an assertion may use is
 *     enumerated. Machine-generated paths make typos systematic rather than
 *     sporadic, and a path the verifier cannot resolve silently *passes*, so
 *     the compiler validates every generated path against this list and fails
 *     loudly instead.
 */
import {
  entityByName,
  relationshipsFrom,
  type EntitySchema,
  type EnvironmentSchema,
  type FieldSchema,
  type RelationshipSchema,
} from './schema.ts';
import {
  deepEqual,
  rowById,
  rowsOf,
  rowReferences,
  type CanonicalState,
  type EntityRow,
  type EnvEvent,
} from './state.ts';
import { diffStates, type StateDelta } from './delta.ts';

/** Relationship hops the projection will follow. Two is enough for "the
 * approver is the requester's manager" and stops the key count exploding. */
export const MAX_RELATIONSHIP_DEPTH = 2;
/** Hard ceiling on generated keys. Truncation is reported, never silent. */
export const MAX_PROJECTION_KEYS = 2000;
/** Enums wider than this are not bucketed — the rollup stops being useful. */
export const MAX_ENUM_BUCKETS = 12;

export type DecoratedRow = Record<string, unknown>;

export interface EntityCounts {
  total: number;
  created: number;
  changed: number;
  deleted: number;
  by: Record<string, Record<string, number>>;
}

export interface Projection {
  created: Record<string, DecoratedRow[]>;
  changed: Record<string, DecoratedRow[]>;
  deleted: Record<string, DecoratedRow[]>;
  all: Record<string, DecoratedRow[]>;
  count: Record<string, EntityCounts>;
  events: {
    list: EnvEvent[];
    occurred: Record<string, boolean>;
    firstOrdinalOf: Record<string, number>;
    /** `null` when the later action never happened, so the rule is moot. */
    orderOk: Record<string, boolean | null>;
  };
  refs: Record<string, boolean>;
}

export interface ProjectionKeySchema {
  /** Entities that have a row list, i.e. everything in `focus`. */
  entities: string[];
  /** Decorated field names available on each entity's rows. */
  rowFields: Record<string, string[]>;
  /** Fully qualified scalar paths, e.g. `derived.count.Order.total`. */
  scalarPaths: string[];
  /** Event types seen or declared. */
  eventTypes: string[];
  truncated: boolean;
  keyCount: number;
}

export interface ProjectionInput {
  seed: CanonicalState;
  final: CanonicalState;
  events?: readonly EnvEvent[];
  /**
   * Entities the projection is rooted at. Defaults to whatever the work
   * actually touched, which is the point: the demonstration says which part of
   * a large system this job is about.
   */
  focus?: readonly string[];
  /** Action names to publish ordinals for even when they did not occur. */
  knownEventTypes?: readonly string[];
}

export interface ProjectionResult {
  derived: Projection;
  keys: ProjectionKeySchema;
  deltas: StateDelta[];
}

export function buildProjection(
  schema: EnvironmentSchema,
  input: ProjectionInput,
): ProjectionResult {
  const deltas = diffStates(schema, input.seed, input.final);
  const focus = resolveFocus(schema, input, deltas);
  const events = [...(input.events ?? [])];

  const created: Record<string, DecoratedRow[]> = {};
  const changed: Record<string, DecoratedRow[]> = {};
  const deleted: Record<string, DecoratedRow[]> = {};
  const all: Record<string, DecoratedRow[]> = {};
  const count: Record<string, EntityCounts> = {};
  const rowFields: Record<string, string[]> = {};
  const scalarPaths: string[] = [];
  let keyCount = 0;
  let truncated = false;

  const createdIds = idsByEntity(deltas, 'entity_created');
  const deletedIds = idsByEntity(deltas, 'entity_deleted');
  const changedIds = changedIdsByEntity(deltas);

  for (const entityName of focus) {
    const entity = entityByName(schema, entityName);
    if (!entity) continue;

    const decorated = rowsOf(input.final, entityName).map((row) =>
      decorateRow(schema, entity, row, input),
    );
    const deletedRows = [...(deletedIds[entityName] ?? [])]
      .sort()
      .map((id) => rowById(input.seed, entityName, id))
      .filter((row): row is EntityRow => row !== undefined)
      .map((row) => decorateRow(schema, entity, row, { ...input, final: input.seed }));

    all[entityName] = decorated;
    created[entityName] = decorated.filter((row) =>
      (createdIds[entityName] ?? new Set()).has(String(row[entity.idField])),
    );
    changed[entityName] = decorated.filter((row) =>
      (changedIds[entityName] ?? new Set()).has(String(row[entity.idField])),
    );
    deleted[entityName] = deletedRows;

    const fields = decorated[0] ? Object.keys(decorated[0]).sort() : declaredFieldNames(entity);
    rowFields[entityName] = fields;
    keyCount += fields.length;

    count[entityName] = {
      total: decorated.length,
      created: created[entityName]?.length ?? 0,
      changed: changed[entityName]?.length ?? 0,
      deleted: deletedRows.length,
      by: bucketise(entity, decorated),
    };
    for (const suffix of ['total', 'created', 'changed', 'deleted']) {
      scalarPaths.push(`derived.count.${entityName}.${suffix}`);
    }
    for (const [field, buckets] of Object.entries(count[entityName]?.by ?? {})) {
      for (const value of Object.keys(buckets)) {
        scalarPaths.push(`derived.count.${entityName}.by.${field}.${value}`);
      }
    }
    keyCount += scalarPaths.length;

    if (keyCount > MAX_PROJECTION_KEYS) {
      truncated = true;
      break;
    }
  }

  const occurred: Record<string, boolean> = {};
  const firstOrdinalOf: Record<string, number> = {};
  const eventTypes = [
    ...new Set([...(input.knownEventTypes ?? []), ...events.map((event) => event.type)]),
  ].sort();
  for (const type of eventTypes) {
    const first = events.find((event) => event.type === type && event.ok);
    occurred[type] = first !== undefined;
    // -1 means "never happened", which orders before everything that did, so
    // `a before b` stays a plain numeric comparison.
    firstOrdinalOf[type] = first?.ordinal ?? -1;
    scalarPaths.push(`derived.events.occurred.${type}`, `derived.events.firstOrdinalOf.${type}`);
  }

  // "Approve before you provision", "capture payment before you ship".
  // Published as a boolean so an ordering rule needs no new assertion kind.
  const orderOk: Record<string, boolean | null> = {};
  for (const before of eventTypes) {
    for (const after of eventTypes) {
      if (before === after) continue;
      const key = `${before}__before__${after}`;
      const a = firstOrdinalOf[before] ?? -1;
      const b = firstOrdinalOf[after] ?? -1;
      // Neither happening is not a violation of an ordering rule; it is a case
      // the rule does not apply to.
      orderOk[key] = b < 0 ? null : a >= 0 && a < b;
      scalarPaths.push(`derived.events.orderOk.${key}`);
    }
  }

  const refs = buildReferences(schema, input, createdIds);
  for (const key of Object.keys(refs)) scalarPaths.push(`derived.refs.${key}`);

  return {
    derived: {
      created,
      changed,
      deleted,
      all,
      count,
      events: { list: events, occurred, firstOrdinalOf, orderOk },
      refs,
    },
    keys: {
      entities: focus.filter((name) => rowFields[name] !== undefined),
      rowFields,
      scalarPaths: [...new Set(scalarPaths)].sort(),
      eventTypes,
      truncated,
      keyCount,
    },
    deltas,
  };
}

// ------------------------------------------------------------------ decoration

function decorateRow(
  schema: EnvironmentSchema,
  entity: EntitySchema,
  row: EntityRow,
  input: ProjectionInput,
): DecoratedRow {
  const decorated: DecoratedRow = {};
  for (const name of Object.keys(row).sort()) decorated[name] = row[name];

  // The row's own fields as they were when work began. This is what makes
  // "this status may not go straight from new to closed" answerable without
  // the verifier knowing what a status is.
  const seedRow = rowById(input.seed, entity.name, row[entity.idField]);
  for (const field of hoistableFields(entity)) {
    decorated[`seed__${field.name}`] = seedRow?.[field.name] ?? null;
  }

  const slots: ReferenceSlot[] = ownReferenceSlots(schema, entity, row);

  for (const relationship of relationshipsFrom(schema, entity.name)) {
    if (relationship.via.kind === 'join') {
      decorated[`${relationship.name}__count`] = countViaJoin(input.final, relationship, row, entity);
      continue;
    }
    if (relationship.cardinality === 'many') {
      decorated[`${relationship.name}__count`] = countInbound(input.final, relationship, row, entity);
      continue;
    }

    const target = entityByName(schema, relationship.to);
    if (!target) continue;
    const foreignKey = row[relationship.via.field];
    const finalRow = rowById(input.final, relationship.to, foreignKey);
    const seedRow = rowById(input.seed, relationship.to, foreignKey);

    decorated[`${relationship.name}__exists`] = finalRow !== undefined;
    decorated[`seed__${relationship.name}__exists`] = seedRow !== undefined;

    for (const field of hoistableFields(target)) {
      decorated[`${relationship.name}__${field.name}`] = finalRow?.[field.name] ?? null;
      decorated[`seed__${relationship.name}__${field.name}`] = seedRow?.[field.name] ?? null;
      slots.push(...slotFor(schema, target, field, `${relationship.name}__${field.name}`, finalRow?.[field.name]));
    }

    // Depth 2 — enough for "the approver is the requester's manager".
    for (const second of relationshipsFrom(schema, relationship.to)) {
      if (second.via.kind !== 'fk' || second.cardinality !== 'one') continue;
      const secondTarget = entityByName(schema, second.to);
      if (!secondTarget) continue;
      const prefix = `${relationship.name}__${second.name}`;
      const secondRow = rowById(input.final, second.to, finalRow?.[second.via.field]);
      decorated[`${prefix}__exists`] = secondRow !== undefined;
      for (const field of hoistableFields(secondTarget)) {
        decorated[`${prefix}__${field.name}`] = secondRow?.[field.name] ?? null;
        slots.push(...slotFor(schema, secondTarget, field, `${prefix}__${field.name}`, secondRow?.[field.name]));
      }
    }
  }

  for (const [key, value] of agreementFlags(slots, decorated)) decorated[key] = value;
  for (const [key, value] of comparisonPairs(schema, entity, decorated)) decorated[key] = value;
  return decorated;
}

/**
 * Differences between two numbers measured in the same unit.
 *
 * "Return it within the loan period", "ship no more than you hold", "the
 * invoice must match the purchase order" are all one field compared to
 * another, and the filter language only compares a field to a constant.
 * Publishing the difference as its own field turns every one of them into an
 * ordinary numeric comparison, so neither the path language nor the verifier
 * needs to learn anything new.
 *
 * Only unit-compatible pairs are emitted, which is what stops the generator
 * proposing that a weight should be less than a currency total.
 */
function comparisonPairs(
  schema: EnvironmentSchema,
  entity: EntitySchema,
  row: DecoratedRow,
): [string, number | null][] {
  const pairs: [string, number | null][] = [];
  const slots = quantitySlots(schema, entity).sort((a, b) => a.path.localeCompare(b.path));

  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      const left = slots[i];
      const right = slots[j];
      if (!left || !right || left.unit !== right.unit) continue;
      const a = row[left.path];
      const b = row[right.path];
      const value =
        typeof a === 'number' && typeof b === 'number' ? round6(a - b) : null;
      pairs.push([`cmp__${left.path}__minus__${right.path}`, value]);
    }
  }
  return pairs;
}

interface QuantitySlot {
  path: string;
  unit: string;
}

/** Numeric paths on a row: its own, and one hop out. */
function quantitySlots(schema: EnvironmentSchema, entity: EntitySchema): QuantitySlot[] {
  const slots: QuantitySlot[] = [];
  const isQuantity = (field: FieldSchema): boolean =>
    (field.role === 'quantity' || field.role === 'timestamp') && field.unit !== undefined;

  for (const field of [...entity.fields].sort((a, b) => a.name.localeCompare(b.name))) {
    if (isQuantity(field) && field.unit) slots.push({ path: field.name, unit: field.unit });
  }
  for (const relationship of relationshipsFrom(schema, entity.name)) {
    if (relationship.via.kind !== 'fk' || relationship.cardinality !== 'one') continue;
    const target = entityByName(schema, relationship.to);
    if (!target) continue;
    for (const field of [...target.fields].sort((a, b) => a.name.localeCompare(b.name))) {
      if (isQuantity(field) && field.unit) {
        slots.push({ path: `${relationship.name}__${field.name}`, unit: field.unit });
      }
    }
  }
  return slots;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * A path on a row that points at something comparable to another path: an
 * identifier of a particular entity, or a person.
 */
interface ReferenceSlot {
  path: string;
  /** `entity:Order` or `actor`. Only same-tag paths are ever compared. */
  tag: string;
  /** Set when this path is the foreign key of a relationship, so the pair
   * "FK equals the id of the row it resolves to" is never emitted. */
  viaRelationship?: string;
}

function ownReferenceSlots(
  schema: EnvironmentSchema,
  entity: EntitySchema,
  row: EntityRow,
): ReferenceSlot[] {
  const slots: ReferenceSlot[] = [];
  for (const field of [...entity.fields].sort((a, b) => a.name.localeCompare(b.name))) {
    if (row[field.name] === undefined) continue;
    if (field.name === entity.idField) continue;
    slots.push(...slotFor(schema, entity, field, field.name, row[field.name]));
  }
  return slots;
}

function slotFor(
  schema: EnvironmentSchema,
  owner: EntitySchema,
  field: FieldSchema,
  path: string,
  _value: unknown,
): ReferenceSlot[] {
  if (field.role === 'actor') return [{ path, tag: 'actor' }];
  const relationship = schema.relationships.find(
    (candidate) =>
      candidate.via.kind === 'fk' &&
      candidate.via.field === field.name &&
      (candidate.cardinality === 'one' ? candidate.from : candidate.to) === owner.name,
  );
  if (relationship) {
    return [{ path, tag: `entity:${relationship.to}`, viaRelationship: relationship.name }];
  }
  return [];
}

/**
 * Agreement between two paths that reach the same kind of thing.
 *
 * Emitted as `true`, `false`, or `null` when either side is missing. `null`
 * matters: a mutated case where one side no longer exists is neither a pass
 * nor a violation, it is a case the rule does not apply to.
 */
function agreementFlags(slots: ReferenceSlot[], row: DecoratedRow): [string, boolean | null][] {
  const flags: [string, boolean | null][] = [];
  const sorted = [...slots].sort((a, b) => a.path.localeCompare(b.path));

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const left = sorted[i];
      const right = sorted[j];
      if (!left || !right || left.tag !== right.tag) continue;
      // `refund.orderId` and `refund.order__id` are the same value by
      // construction; comparing them measures nothing.
      if (left.viaRelationship && right.path.startsWith(`${left.viaRelationship}__`)) continue;
      if (right.viaRelationship && left.path.startsWith(`${right.viaRelationship}__`)) continue;

      const a = row[left.path];
      const b = row[right.path];
      const value =
        a === null || a === undefined || b === null || b === undefined ? null : deepEqual(a, b);
      flags.push([`agrees__${left.path}__vs__${right.path}`, value]);
    }
  }
  return flags;
}

// ---------------------------------------------------------------------- counts

function countInbound(
  state: CanonicalState,
  relationship: RelationshipSchema,
  row: EntityRow,
  entity: EntitySchema,
): number {
  if (relationship.via.kind !== 'fk') return 0;
  const id = row[entity.idField];
  const field = relationship.via.field;
  return rowsOf(state, relationship.to).filter(
    (candidate) => candidate[field] !== undefined && String(candidate[field]) === String(id),
  ).length;
}

function countViaJoin(
  state: CanonicalState,
  relationship: RelationshipSchema,
  row: EntityRow,
  entity: EntitySchema,
): number {
  if (relationship.via.kind !== 'join') return 0;
  const { entity: joinEntity, fromField } = relationship.via;
  const id = String(row[entity.idField]);
  return rowsOf(state, joinEntity).filter((join) => String(join[fromField]) === id).length;
}

function bucketise(
  entity: EntitySchema,
  rows: readonly DecoratedRow[],
): Record<string, Record<string, number>> {
  const by: Record<string, Record<string, number>> = {};
  for (const field of [...entity.fields].sort((a, b) => a.name.localeCompare(b.name))) {
    const bucketable =
      field.role === 'flag' ||
      (field.role === 'status' && (field.enumValues ?? []).length <= MAX_ENUM_BUCKETS) ||
      (field.type === 'enum' && (field.enumValues ?? []).length <= MAX_ENUM_BUCKETS);
    if (!bucketable) continue;

    const buckets: Record<string, number> = {};
    for (const value of field.enumValues ?? ['true', 'false']) buckets[value] = 0;
    for (const row of rows) {
      const key = String(row[field.name]);
      buckets[key] = (buckets[key] ?? 0) + 1;
    }
    by[field.name] = buckets;
  }
  return by;
}

// ------------------------------------------------------------------ references

function buildReferences(
  schema: EnvironmentSchema,
  input: ProjectionInput,
  createdIds: Record<string, Set<string>>,
): Record<string, boolean> {
  const refs: Record<string, boolean> = {};
  const sources = schema.entities
    .filter((entity) => entity.appendOnly || (createdIds[entity.name]?.size ?? 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const targets = schema.entities
    .filter((entity) => (createdIds[entity.name]?.size ?? 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const source of sources) {
    const sourceRows = rowsOf(input.final, source.name).filter((row) =>
      (createdIds[source.name] ?? new Set()).has(String(row[source.idField])),
    );
    for (const target of targets) {
      if (source.name === target.name) continue;
      const targetIds = [...(createdIds[target.name] ?? new Set())].sort();
      refs[`${source.name}__${target.name}`] =
        targetIds.length > 0 &&
        targetIds.every((id) =>
          sourceRows.some((row) => rowReferences(row, id, source.referenceFields)),
        );
    }
  }
  return refs;
}

// ----------------------------------------------------------------------- utils

function resolveFocus(
  schema: EnvironmentSchema,
  input: ProjectionInput,
  deltas: readonly StateDelta[],
): string[] {
  if (input.focus && input.focus.length > 0) {
    return [...new Set(input.focus)].sort();
  }
  const touched = new Set(deltas.map((delta) => delta.entity));
  if (touched.size === 0) {
    // Nothing happened. Project the entities an action could have touched so
    // "no row was created" is still an answerable question.
    return schema.entities.map((entity) => entity.name).sort();
  }
  return [...touched].sort();
}

function idsByEntity(
  deltas: readonly StateDelta[],
  kind: 'entity_created' | 'entity_deleted',
): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const delta of deltas) {
    if (delta.kind !== kind) continue;
    (out[delta.entity] ??= new Set()).add(delta.id);
  }
  return out;
}

function changedIdsByEntity(deltas: readonly StateDelta[]): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const delta of deltas) {
    if (delta.kind === 'entity_created' || delta.kind === 'entity_deleted') continue;
    (out[delta.entity] ??= new Set()).add(delta.id);
  }
  return out;
}

function declaredFieldNames(entity: EntitySchema): string[] {
  return entity.fields.map((field) => field.name).sort();
}

/**
 * Fields worth copying onto a related row. Free text is never hoisted: it is
 * the injection surface, it is never compared, and it would dominate the key
 * budget for nothing.
 */
export function hoistableFields(entity: EntitySchema): FieldSchema[] {
  return entity.fields
    .filter((field) => field.role !== undefined && field.role !== 'freetext')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Is this a path the projection can actually answer?
 *
 * The compiler calls this on every path it generates. An unresolvable path
 * makes an assertion quietly pass forever, and machine-generated paths get
 * that wrong in whole families at a time rather than one at a time.
 */
export function validateProjectionPath(keys: ProjectionKeySchema, path: string): string | null {
  if (!path.startsWith('derived.')) return null;
  if (keys.scalarPaths.includes(path)) return null;

  const withoutFilters = path.replace(/\[[^\]]*\]/g, '');
  const parts = withoutFilters.split('.');
  const section = parts[1];
  if (section === undefined) return `"${path}" names no projection section`;

  if (['created', 'changed', 'deleted', 'all'].includes(section)) {
    const entity = parts[2];
    if (entity === undefined) return `"${path}" names no entity`;
    const fields = keys.rowFields[entity];
    if (!fields) {
      return `"${path}" reads entity "${entity}", which the projection does not cover (covered: ${keys.entities.join(', ') || 'none'})`;
    }
    const filterFields = [...path.matchAll(/\[([^\]]*)\]/g)]
      .flatMap((match) => (match[1] ?? '').split('&'))
      .map((clause) => /^\s*([A-Za-z0-9_.]+)/.exec(clause)?.[1])
      .filter((name): name is string => name !== undefined && !/^\d+$/.test(name));
    for (const field of filterFields) {
      if (!fields.includes(field)) {
        return `"${path}" filters on "${field}", which is not a field of the projected ${entity}`;
      }
    }
    const trailing = parts.slice(3).filter((part) => part.length > 0);
    for (const part of trailing) {
      if (part === 'length' || part === 'count') continue;
      if (!fields.includes(part)) {
        return `"${path}" reads "${part}", which is not a field of the projected ${entity}`;
      }
    }
    return null;
  }

  if (section === 'count' || section === 'events' || section === 'refs') {
    return `"${path}" is not among the projection's published scalar paths`;
  }
  return `"${path}" names unknown projection section "${section}"`;
}
