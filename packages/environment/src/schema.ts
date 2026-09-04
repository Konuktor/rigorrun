/**
 * The vocabulary an environment uses to describe itself.
 *
 * This file is the entire contract between RigorRun and a business system. The
 * compiler, the generator and the projection are written against these types
 * and nothing else, which is what lets the same pipeline handle a refund desk,
 * an invoice queue and an equipment cage without knowing what any of them are.
 *
 * The one concession to meaning is `FieldSchema.role`. RigorRun cannot infer
 * from `{ name: 'amount', type: 'number' }` whether a threshold rule makes
 * sense, so the adapter says so. That is a declaration by the environment, not
 * a vocabulary in the compiler: core reads roles generically and never checks
 * a field *name*. The hidden-domain acceptance test is what keeps that honest.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'timestamp';

/**
 * What a field *means* structurally.
 *
 *  - `identifier` — a key or foreign key. Never mutated, never a threshold.
 *  - `quantity`   — an ordered magnitude. Thresholds and boundaries apply.
 *  - `status`     — a lifecycle enum. Transitions and forbidden states apply.
 *  - `actor`      — who did it. Segregation-of-duties rules apply.
 *  - `timestamp`  — a point in time. Interval rules apply.
 *  - `flag`       — a boolean gate.
 *  - `freetext`   — prose. Never hoisted into the projection, never compared.
 */
export type FieldRole =
  | 'identifier'
  | 'quantity'
  | 'status'
  | 'actor'
  | 'timestamp'
  | 'flag'
  | 'freetext';

/**
 * The dimension a quantity is measured in.
 *
 * This exists so the generator never proposes comparing a weight to a currency
 * total. Two fields are comparable only when their units match.
 */
export type Unit =
  | 'currency'
  | 'count'
  | 'duration_days'
  | 'duration_hours'
  | 'duration_ms'
  | 'score'
  | 'mass_kg'
  | 'percent';

export interface FieldSchema {
  name: string;
  type: FieldType;
  /** Required when `type` is `enum`. The full, closed set of legal values. */
  enumValues?: readonly string[];
  nullable: boolean;
  role?: FieldRole;
  /** Required for `quantity` and `timestamp` roles. */
  unit?: Unit;
  /**
   * The smallest meaningful step. Required for `quantity` and `timestamp`.
   *
   * Boundary mutation is undefined without it: "one more than the limit" is
   * 0.01 on a currency field, 1 on a day count, and 5 on some lead scores.
   */
  precision?: number;
  /**
   * True when the value is authored by someone outside the organisation.
   * These are the only fields injection payloads are written into, and their
   * values are never interpolated into an assertion path.
   */
  untrusted?: boolean;
  /** Human label for the schema-driven UI. Never read by the compiler. */
  label?: string;
}

/** How to walk from one entity to another. */
export type RelationshipVia =
  | { kind: 'fk'; field: string }
  | { kind: 'join'; entity: string; fromField: string; toField: string };

export interface RelationshipSchema {
  name: string;
  /** Entity the relationship is declared on. */
  from: string;
  /** Entity it points at. */
  to: string;
  via: RelationshipVia;
  cardinality: 'one' | 'many';
  /** True when the environment itself refuses a row without this link. */
  required: boolean;
}

export interface EntitySchema {
  name: string;
  idField: string;
  fields: FieldSchema[];
  /** Rows may be changed after creation. */
  mutable: boolean;
  /**
   * Rows may be added but never changed or removed — an audit log.
   * Side-effect rules and reference checks are rooted at these.
   */
  appendOnly: boolean;
  /**
   * Fields that may carry an identifier belonging to another entity, including
   * ids buried in a structured payload. Used to answer "did the audit entry
   * actually reference the thing that was created" without substring matching.
   */
  referenceFields?: readonly string[];
  label?: string;
}

export interface EnvironmentSchema {
  entities: EntitySchema[];
  relationships: RelationshipSchema[];
}

// --------------------------------------------------------------------- actions

export interface ActionParam {
  name: string;
  type: FieldType;
  required: boolean;
  enumValues?: readonly string[];
  /**
   * When set, the value is an identifier of this entity. Referential validity
   * of the request is checked generically from this, before any rule runs.
   */
  entityRef?: string;
  description?: string;
}

export interface ActionDefinition {
  name: string;
  description: string;
  params: ActionParam[];
  /** Entity names this action may create, change or delete. */
  mutates: readonly string[];
  readOnly: boolean;
  /**
   * Whether the environment refuses this action when *business policy* is
   * violated, as opposed to when referential integrity is violated.
   *
   * `'none'` is the useful answer, and the one every RigorRun demo environment
   * gives: the environment stops you refunding an order that does not exist,
   * and lets you refund one you should not have. An environment that enforces
   * the policy under test makes every agent pass and the benchmark measures
   * nothing, which is why this is declared and then verified by execution.
   */
  enforcement: 'none' | 'partial';
}

// ----------------------------------------------------------------- case config

/**
 * A variable the *environment* controls during a case — how a human approver
 * responds, whether a downstream service fails once.
 *
 * Declaring these is what makes "remove the approval" and "make the tool fail"
 * generic mutations rather than refund-specific ones.
 */
export interface CaseConfigVariable {
  name: string;
  values: readonly string[];
  default: string;
  description: string;
}

export type CaseConfig = Record<string, string>;

// ------------------------------------------------------------------ validation

export interface SchemaProblem {
  path: string;
  message: string;
}

/**
 * Structural checks on a declared schema.
 *
 * A single mis-annotated role silently corrupts thresholds, field relations,
 * boundary mutation and the projection — and it does so on somebody else's
 * adapter, where it cannot be debugged. Failing loudly here is the difference
 * between "bring your own environment" working and appearing to work.
 */
export function validateSchema(schema: EnvironmentSchema): SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  const byName = new Map<string, EntitySchema>();

  for (const entity of schema.entities) {
    if (byName.has(entity.name)) {
      problems.push({ path: entity.name, message: 'duplicate entity name' });
    }
    byName.set(entity.name, entity);

    const fieldNames = new Set<string>();
    let hasId = false;
    for (const field of entity.fields) {
      const path = `${entity.name}.${field.name}`;
      if (fieldNames.has(field.name)) problems.push({ path, message: 'duplicate field name' });
      fieldNames.add(field.name);
      if (field.name === entity.idField) hasId = true;

      if (field.type === 'enum' && (field.enumValues ?? []).length === 0) {
        problems.push({ path, message: 'enum field declares no enumValues' });
      }
      if (field.type !== 'enum' && field.enumValues !== undefined) {
        problems.push({ path, message: 'enumValues on a non-enum field' });
      }
      if (field.role === 'quantity' || field.role === 'timestamp') {
        if (field.unit === undefined) {
          problems.push({ path, message: `role "${field.role}" requires a unit` });
        }
        if (field.precision === undefined || !(field.precision > 0)) {
          problems.push({
            path,
            message: `role "${field.role}" requires a positive precision, so boundary mutation is defined`,
          });
        }
      }
      if (field.role === 'quantity' && field.type !== 'number' && field.type !== 'timestamp') {
        problems.push({ path, message: 'role "quantity" requires a numeric field' });
      }
      if (field.role === 'status' && field.type !== 'enum') {
        problems.push({ path, message: 'role "status" requires an enum field' });
      }
      if (field.role === 'flag' && field.type !== 'boolean') {
        problems.push({ path, message: 'role "flag" requires a boolean field' });
      }
    }

    if (!hasId) {
      problems.push({
        path: entity.name,
        message: `idField "${entity.idField}" is not among the declared fields`,
      });
    }
    if (entity.appendOnly && entity.mutable) {
      problems.push({ path: entity.name, message: 'an entity cannot be both appendOnly and mutable' });
    }
    for (const reference of entity.referenceFields ?? []) {
      if (!fieldNames.has(reference)) {
        problems.push({
          path: `${entity.name}.${reference}`,
          message: 'referenceFields names a field that does not exist',
        });
      }
    }
  }

  const relationshipNames = new Set<string>();
  for (const relationship of schema.relationships) {
    const path = `${relationship.from}.${relationship.name}`;
    if (relationshipNames.has(path)) {
      problems.push({ path, message: 'duplicate relationship name on this entity' });
    }
    relationshipNames.add(path);

    const from = byName.get(relationship.from);
    const to = byName.get(relationship.to);
    if (!from) problems.push({ path, message: `unknown "from" entity ${relationship.from}` });
    if (!to) problems.push({ path, message: `unknown "to" entity ${relationship.to}` });

    if (relationship.via.kind === 'fk') {
      // The foreign key lives on whichever side has many rows: "Refund belongs
      // to one Order" puts orderId on Refund, and so does "Order has many
      // Refunds". Cardinality says which entity that is.
      const field = relationship.via.field;
      const holder = relationship.cardinality === 'one' ? from : to;
      if (holder && !holder.fields.some((f) => f.name === field)) {
        problems.push({
          path,
          message: `foreign key "${field}" is not a field of ${holder.name}`,
        });
      }
    } else {
      const join = byName.get(relationship.via.entity);
      if (!join) {
        problems.push({ path, message: `unknown join entity ${relationship.via.entity}` });
      } else {
        for (const field of [relationship.via.fromField, relationship.via.toField]) {
          if (!join.fields.some((f) => f.name === field)) {
            problems.push({ path, message: `join field "${field}" is not a field of ${join.name}` });
          }
        }
      }
    }
  }

  return problems;
}

/** Convenience lookup that keeps callers from re-indexing the schema everywhere. */
export function entityByName(schema: EnvironmentSchema, name: string): EntitySchema | undefined {
  return schema.entities.find((entity) => entity.name === name);
}

export function fieldByName(entity: EntitySchema, name: string): FieldSchema | undefined {
  return entity.fields.find((field) => field.name === name);
}

/** Relationships declared on an entity, in a stable order. */
export function relationshipsFrom(
  schema: EnvironmentSchema,
  entityName: string,
): RelationshipSchema[] {
  return schema.relationships
    .filter((relationship) => relationship.from === entityName)
    .sort((a, b) => a.name.localeCompare(b.name));
}
