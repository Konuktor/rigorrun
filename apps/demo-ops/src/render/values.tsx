/**
 * Turning a stored value into something a person reads.
 *
 * Every decision here is made from the field's declared schema — its type, its
 * role, its unit — and from the environment's declared status tones. There is
 * no list of field names anywhere in this file, which is the only reason four
 * different-looking products can share it.
 */
import type { ReactNode } from 'react';
import {
  entityByName,
  fieldByName,
  relationshipsFrom,
  type EntityRow,
  type EnvironmentSchema,
  type FieldSchema,
  type PresentationHints,
  type StatusTone,
} from '@rigorrun/environment';

const TONE_CLASS: Record<StatusTone, string> = {
  positive: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  progress: 'bg-sky-50 text-sky-800 ring-sky-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-rose-50 text-rose-800 ring-rose-200',
  neutral: 'bg-slate-100 text-ink-soft ring-slate-200',
};

/** `invoiceNumber` → `Invoice number`. Used only when no label is declared. */
export function humanise(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Resolves `field` or `relation__field` against a row.
 *
 * One hop, because that is what a person reading a record expects to see
 * without clicking: the invoice's vendor name, the grant's employee.
 */
export function resolveValue(
  schema: EnvironmentSchema,
  entityName: string,
  row: EntityRow,
  path: string,
  lookup: (entity: string, id: unknown) => EntityRow | undefined,
): { value: unknown; field: FieldSchema | undefined } {
  const [head, tail] = path.split('__');
  const entity = entityByName(schema, entityName);
  if (!entity) return { value: undefined, field: undefined };

  if (!tail) {
    return { value: row[path], field: fieldByName(entity, path) };
  }

  const relationship = relationshipsFrom(schema, entityName).find(
    (candidate) => candidate.name === head,
  );
  if (!relationship || relationship.via.kind !== 'fk') {
    return { value: undefined, field: undefined };
  }
  const related = lookup(relationship.to, row[relationship.via.field]);
  const target = entityByName(schema, relationship.to);
  return {
    value: related?.[tail],
    field: target ? fieldByName(target, tail) : undefined,
  };
}

/** The label for a path, from the declared labels where there are any. */
export function labelFor(
  schema: EnvironmentSchema,
  entityName: string,
  path: string,
  declared?: string,
): string {
  if (declared) return declared;
  const [head, tail] = path.split('__');
  if (!tail) {
    const entity = entityByName(schema, entityName);
    return entity ? (fieldByName(entity, path)?.label ?? humanise(path)) : humanise(path);
  }
  const relationship = relationshipsFrom(schema, entityName).find((r) => r.name === head);
  const target = relationship ? entityByName(schema, relationship.to) : undefined;
  const fieldLabel = target ? (fieldByName(target, tail)?.label ?? humanise(tail)) : humanise(tail);
  const targetLabel = target?.label ?? humanise(relationship?.to ?? '');
  // "vendor" + "vendor name" reads as "vendor vendor name". A field whose
  // label already names its own record does not need the prefix.
  if (fieldLabel.toLowerCase().startsWith(targetLabel.toLowerCase())) {
    return fieldLabel.charAt(0).toUpperCase() + fieldLabel.slice(1);
  }
  const prefixed = `${targetLabel} ${fieldLabel.toLowerCase()}`;
  return prefixed.charAt(0).toUpperCase() + prefixed.slice(1);
}

export function Value({
  value,
  field,
  hints,
}: {
  value: unknown;
  field: FieldSchema | undefined;
  hints: PresentationHints;
}): ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-ink-faint">—</span>;
  }

  if (field?.role === 'status' || (field?.type === 'enum' && typeof value === 'string')) {
    const tone = hints.statusTones?.[String(value)] ?? 'neutral';
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset ${TONE_CLASS[tone]}`}
      >
        {String(value).replace(/_/g, ' ')}
      </span>
    );
  }

  if (typeof value === 'boolean') {
    return value ? (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
        yes
      </span>
    ) : (
      <span className="text-ink-faint">no</span>
    );
  }

  if (typeof value === 'number') {
    return <span className="tabular-nums">{formatQuantity(value, field)}</span>;
  }

  if (field?.role === 'identifier') {
    return <span className="font-mono text-[12.5px]">{String(value)}</span>;
  }

  return <span>{String(value)}</span>;
}

/** The unit is declared, so the renderer never has to guess what a number is. */
export function formatQuantity(value: number, field: FieldSchema | undefined): string {
  switch (field?.unit) {
    case 'currency':
      return value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      });
    case 'percent':
      return `${value}%`;
    case 'duration_days':
      return `day ${value}`;
    case 'duration_hours':
      return `${value}h`;
    case 'mass_kg':
      return `${value} kg`;
    default:
      return value.toLocaleString('en-US');
  }
}

/** A record's own title: its most identifying declared column, or its id. */
export function titleOf(
  schema: EnvironmentSchema,
  entityName: string,
  row: EntityRow,
  emphasisField: string | undefined,
  lookup: (entity: string, id: unknown) => EntityRow | undefined,
): string {
  const entity = entityByName(schema, entityName);
  if (emphasisField) {
    const { value } = resolveValue(schema, entityName, row, emphasisField, lookup);
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return String(entity ? row[entity.idField] : '');
}
