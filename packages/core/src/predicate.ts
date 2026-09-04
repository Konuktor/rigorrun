/**
 * The machine form of a policy rule.
 *
 * A rule has to do three jobs: read as a plain-English question a person can
 * answer yes or no to, compile into typed assertions the verifier can check,
 * and be *evaluated* against a hypothetical world so RigorRun can work out
 * what a compliant operator would have done. A sentence cannot do all three,
 * and arbitrary code should not be allowed to, so rules carry this instead.
 *
 * Every predicate here compiles to the existing assertion kinds. Nothing in
 * this language needs the verifier to learn a new operator.
 */
import { z } from 'zod';

export const COMPARISONS = [
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'not_in',
  'exists',
  'not_exists',
] as const;
export const ComparisonSchema = z.enum(COMPARISONS);
export type Comparison = z.infer<typeof ComparisonSchema>;

export const LiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Literal = z.infer<typeof LiteralSchema>;

/**
 * One comparison against a field of a projected row.
 *
 * `field` is always a path the projection publishes, so it is verified against
 * the published key schema before an assertion is built from it. `value` is
 * always a literal: a value observed in an untrusted field is never
 * interpolated into a path, because our own injection mutation would otherwise
 * be an attack on our own filter parser.
 */
export const ConditionSchema = z.object({
  field: z.string().min(1),
  op: ComparisonSchema,
  value: z.union([LiteralSchema, z.array(LiteralSchema)]).optional(),
  /** Human-readable restatement, used in questions and failure messages. */
  describe: z.string().default(''),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ROW_SCOPES = ['created', 'changed', 'all'] as const;
export const RowScopeSchema = z.enum(ROW_SCOPES);
export type RowScope = z.infer<typeof RowScopeSchema>;

/**
 * "For every row in scope, if `when` holds then `then` must hold."
 *
 * Thresholds, required links, path agreement, required fields and field
 * relations are all this shape. `when` empty means the rule applies to every
 * row in scope.
 */
export const RowConstraintSchema = z.object({
  kind: z.literal('row_constraint'),
  entity: z.string().min(1),
  scope: RowScopeSchema,
  when: z.array(ConditionSchema).default([]),
  then: z.array(ConditionSchema).min(1),
});

/**
 * "At most N rows sharing these field values, among rows matching `where`."
 *
 * The filter is what makes this usable on work that *changes* a record rather
 * than creating one: "at most one invoice per vendor and number ends up
 * approved" is a real policy, and counting every invoice regardless of state
 * would fail an agent for duplicates that were already there.
 */
export const CountConstraintSchema = z.object({
  kind: z.literal('count_constraint'),
  entity: z.string().min(1),
  scope: RowScopeSchema,
  /** Fields whose combination must be unique, e.g. vendor + invoice number. */
  groupBy: z.array(z.string()).default([]),
  where: z.array(ConditionSchema).default([]),
  max: z.number().int().nonnegative().optional(),
  min: z.number().int().nonnegative().optional(),
});

/** "Every row created in `target` must be referenced by a row in `source`." */
export const ReferenceRequiredSchema = z.object({
  kind: z.literal('reference_required'),
  source: z.string().min(1),
  target: z.string().min(1),
});

/** "`before` must happen, and must happen before `after`." */
export const EventOrderSchema = z.object({
  kind: z.literal('event_order'),
  before: z.string().min(1),
  after: z.string().min(1),
});

/** "This status field may only move along these edges." */
export const TransitionAllowedSchema = z.object({
  kind: z.literal('transition_allowed'),
  entity: z.string().min(1),
  field: z.string().min(1),
  allowed: z.array(z.tuple([z.string(), z.string()])).default([]),
  forbidden: z.array(z.tuple([z.string(), z.string()])).default([]),
});

export const RulePredicateSchema = z.discriminatedUnion('kind', [
  RowConstraintSchema,
  CountConstraintSchema,
  ReferenceRequiredSchema,
  EventOrderSchema,
  TransitionAllowedSchema,
]);
export type RulePredicate = z.infer<typeof RulePredicateSchema>;
export type RowConstraint = z.infer<typeof RowConstraintSchema>;
export type CountConstraint = z.infer<typeof CountConstraintSchema>;

/** The opposite of a condition, used to turn "must" into "must not exist". */
export function negate(condition: Condition): Condition[] {
  const base = { field: condition.field, describe: condition.describe };
  switch (condition.op) {
    case 'eq':
      return [{ ...base, op: 'ne', value: condition.value as Literal }];
    case 'ne':
      return [{ ...base, op: 'eq', value: condition.value as Literal }];
    case 'lt':
      return [{ ...base, op: 'gte', value: condition.value as Literal }];
    case 'lte':
      return [{ ...base, op: 'gt', value: condition.value as Literal }];
    case 'gt':
      return [{ ...base, op: 'lte', value: condition.value as Literal }];
    case 'gte':
      return [{ ...base, op: 'lt', value: condition.value as Literal }];
    case 'exists':
      return [{ ...base, op: 'eq', value: null }];
    case 'not_exists':
      return [{ ...base, op: 'ne', value: null }];
    case 'in':
      // NOT IN is a conjunction of inequalities, which the filter language can
      // express directly.
      return asArray(condition.value).map((value) => ({ ...base, op: 'ne' as const, value }));
    case 'not_in':
      // IN is a disjunction, so the caller expands it into several assertions.
      return asArray(condition.value).map((value) => ({ ...base, op: 'eq' as const, value }));
  }
}

/** True when negating this condition produces alternatives, not a conjunction. */
export function negationIsDisjunctive(condition: Condition): boolean {
  return condition.op === 'not_in' && asArray(condition.value).length > 1;
}

export function asArray(value: Literal | Literal[] | undefined): Literal[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Every projection path a predicate reads. Used to validate before compiling. */
export function pathsUsed(predicate: RulePredicate): string[] {
  switch (predicate.kind) {
    case 'row_constraint':
      return [...predicate.when, ...predicate.then].map((condition) => condition.field);
    case 'count_constraint':
      return [...predicate.groupBy, ...predicate.where.map((condition) => condition.field)];
    case 'transition_allowed':
      return [predicate.field, `seed__${predicate.field}`];
    case 'reference_required':
    case 'event_order':
      return [];
  }
}
