/**
 * Small builders so a demo environment reads as a description of a business
 * system rather than as pages of schema literal.
 *
 * Nothing here is required to write an adapter — it is ordinary code over the
 * public SDK types, and a team bringing their own environment can ignore it.
 * It exists so the five demo workflows can be compared side by side: if one of
 * them needed a special case, it would be obvious.
 */
import type { ActionSpec } from '@rigorrun/environment';
import type {
  ActionParam,
  EntitySchema,
  FieldSchema,
  RelationshipSchema,
  Unit,
} from '@rigorrun/environment';

export function id(name: string, label?: string): FieldSchema {
  return { name, type: 'string', nullable: false, role: 'identifier', ...(label ? { label } : {}) };
}

export function ref(name: string, options: { nullable?: boolean; label?: string } = {}): FieldSchema {
  return {
    name,
    type: 'string',
    nullable: options.nullable ?? false,
    role: 'identifier',
    ...(options.label ? { label: options.label } : {}),
  };
}

export function status(name: string, values: readonly string[], label?: string): FieldSchema {
  return {
    name,
    type: 'enum',
    nullable: false,
    role: 'status',
    enumValues: values,
    ...(label ? { label } : {}),
  };
}

export function money(name: string, label?: string): FieldSchema {
  return {
    name,
    type: 'number',
    nullable: false,
    role: 'quantity',
    unit: 'currency',
    precision: 0.01,
    ...(label ? { label } : {}),
  };
}

export function count(name: string, label?: string): FieldSchema {
  return {
    name,
    type: 'number',
    nullable: false,
    role: 'quantity',
    unit: 'count',
    precision: 1,
    ...(label ? { label } : {}),
  };
}

export function score(name: string, label?: string): FieldSchema {
  return {
    name,
    type: 'number',
    nullable: false,
    role: 'quantity',
    unit: 'score',
    precision: 1,
    ...(label ? { label } : {}),
  };
}

export function days(name: string, label?: string): FieldSchema {
  return {
    name,
    type: 'number',
    nullable: false,
    role: 'timestamp',
    unit: 'duration_days',
    precision: 1,
    ...(label ? { label } : {}),
  };
}

export function flag(name: string, label?: string): FieldSchema {
  return { name, type: 'boolean', nullable: false, role: 'flag', ...(label ? { label } : {}) };
}

export function actor(name: string, options: { nullable?: boolean; label?: string } = {}): FieldSchema {
  return {
    name,
    type: 'string',
    nullable: options.nullable ?? true,
    role: 'actor',
    ...(options.label ? { label: options.label } : {}),
  };
}

/** Free text. `untrusted` marks the fields an outsider can write into. */
export function text(
  name: string,
  options: { untrusted?: boolean; nullable?: boolean; label?: string } = {},
): FieldSchema {
  return {
    name,
    type: 'string',
    nullable: options.nullable ?? true,
    role: 'freetext',
    ...(options.untrusted ? { untrusted: true } : {}),
    ...(options.label ? { label: options.label } : {}),
  };
}

export function plain(name: string, label?: string): FieldSchema {
  return { name, type: 'string', nullable: true, ...(label ? { label } : {}) };
}

export interface EntityOptions {
  label?: string;
  mutable?: boolean;
  appendOnly?: boolean;
  referenceFields?: readonly string[];
}

export function entity(
  name: string,
  idField: string,
  fields: FieldSchema[],
  options: EntityOptions = {},
): EntitySchema {
  return {
    name,
    idField,
    fields,
    mutable: options.mutable ?? true,
    appendOnly: options.appendOnly ?? false,
    ...(options.referenceFields ? { referenceFields: options.referenceFields } : {}),
    ...(options.label ? { label: options.label } : {}),
  };
}

/** "This record names one of those", with the key on this side. */
export function belongsTo(
  from: string,
  name: string,
  to: string,
  field: string,
  required = false,
): RelationshipSchema {
  return { name, from, to, via: { kind: 'fk', field }, cardinality: 'one', required };
}

/** "Many of those name this one", with the key on the other side. */
export function hasMany(from: string, name: string, to: string, field: string): RelationshipSchema {
  return { name, from, to, via: { kind: 'fk', field }, cardinality: 'many', required: false };
}

export function param(
  name: string,
  options: {
    type?: ActionParam['type'];
    required?: boolean;
    entityRef?: string;
    description?: string;
    enumValues?: readonly string[];
  } = {},
): ActionParam {
  return {
    name,
    type: options.type ?? 'string',
    required: options.required ?? true,
    ...(options.entityRef ? { entityRef: options.entityRef } : {}),
    ...(options.enumValues ? { enumValues: options.enumValues } : {}),
    ...(options.description ? { description: options.description } : {}),
  };
}

/** A read-only lookup, which every environment needs several of. */
export function reader(
  name: string,
  description: string,
  entityName: string,
  paramName: string,
): ActionSpec {
  return {
    name,
    description,
    readOnly: true,
    mutates: [],
    enforcement: 'none',
    params: [param(paramName, { entityRef: entityName })],
    handle: (args, ctx) => {
      const row = ctx.row(entityName, args[paramName]);
      return row === undefined
        ? { ok: false, error: { code: 'NOT_FOUND', message: `no ${entityName} with that id` } }
        : { ok: true, data: row };
    },
  };
}

export type { Unit };
