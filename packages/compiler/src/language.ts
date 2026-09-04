/**
 * Turning schema paths into sentences a person can answer yes or no to.
 *
 * Contract review is the step that decides whether this product is usable by
 * the person who actually knows the policy, and that person does not know what
 * a JSONPath is. So a rule is presented as "Should an invoice over $1,000
 * always need manager approval?" rather than as its predicate — and the
 * wording is assembled from the labels the environment declares, never from a
 * vocabulary held in the compiler.
 */
import {
  entityByName,
  fieldByName,
  relationshipsFrom,
  type EntitySchema,
  type EnvironmentSchema,
  type FieldSchema,
  type Unit,
} from '@rigorrun/environment';

/** `invoiceNumber` → `invoice number`, `PurchaseOrder` → `purchase order`. */
export function humanise(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function entityLabel(schema: EnvironmentSchema, name: string): string {
  return entityByName(schema, name)?.label ?? humanise(name);
}

export function fieldLabel(entity: EntitySchema | undefined, name: string): string {
  if (!entity) return humanise(name);
  return fieldByName(entity, name)?.label ?? humanise(name);
}

/**
 * Renders a projected path as a possessive phrase.
 *
 * `permit__state` on a Claim reads "the claim's permit state"; a two-hop
 * `item__account__tier` reads "the claim's item account tier". Prefixes the
 * projection adds — `seed__`, `agrees__`, `cmp__` — are handled by the callers
 * that know what they mean.
 */
export function describePath(
  schema: EnvironmentSchema,
  entityName: string,
  path: string,
): string {
  const entity = entityByName(schema, entityName);
  if (!entity) return humanise(path);

  const parts = path.split('__');
  if (parts.length === 1) return `the ${entityLabel(schema, entityName)}'s ${fieldLabel(entity, path)}`;

  const words: string[] = [];
  let current: EntitySchema | undefined = entity;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === undefined) continue;
    if (part === 'exists') {
      return `the ${entityLabel(schema, entityName)}'s ${words.join(' ')}`.replace(/\s+/g, ' ');
    }
    const relationship = current
      ? relationshipsFrom(schema, current.name).find((r) => r.name === part)
      : undefined;
    if (relationship) {
      words.push(entityLabel(schema, relationship.to));
      current = entityByName(schema, relationship.to);
      continue;
    }
    words.push(fieldLabel(current, part));
    current = undefined;
  }
  return `the ${entityLabel(schema, entityName)}'s ${words.join(' ')}`.replace(/\s+/g, ' ');
}

/** An indefinite article that reads correctly. */
export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

/** Renders a value the way its unit is normally written. */
export function formatQuantity(value: number, unit: Unit | undefined): string {
  switch (unit) {
    case 'currency':
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
    case 'percent':
      return `${value}%`;
    case 'duration_days':
      return `${value} ${value === 1 ? 'day' : 'days'}`;
    case 'duration_hours':
      return `${value} ${value === 1 ? 'hour' : 'hours'}`;
    case 'mass_kg':
      return `${value} kg`;
    case 'score':
    case 'count':
    default:
      return String(value);
  }
}

export function formatFieldValue(field: FieldSchema | undefined, value: unknown): string {
  if (value === null || value === undefined) return 'nothing';
  if (typeof value === 'number') return formatQuantity(value, field?.unit);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return `"${String(value)}"`;
}

/** Joins a list the way a person would write it. */
export function list(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
