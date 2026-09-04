/**
 * Confirmed rule → typed assertion.
 *
 * Two rules govern this file.
 *
 * **Nothing is generated that the projection cannot answer.** A path the
 * verifier fails to resolve does not fail the check — it silently *passes* it,
 * forever. That is survivable when a person wrote the path and a reviewer read
 * it; it is not survivable when paths are built by concatenating schema names,
 * because then one mistake is wrong for every rule of that shape at once. So
 * every path is checked against the projection's published key schema and a
 * mismatch is a hard error, never a warning.
 *
 * **No observed value is ever interpolated into a path.** Filter values go
 * through `literal()`, which refuses anything containing the filter language's
 * own punctuation. Otherwise the injection payloads RigorRun writes into
 * untrusted fields would be an attack on RigorRun's own parser.
 */
import {
  negate,
  negationIsDisjunctive,
  type Assertion,
  type Condition,
  type ContractRule,
  type EnvironmentContract,
  type FailureSeverity,
  type Literal,
  type RuleTemplate,
} from '@rigorrun/core';
import { validateProjectionPath, type ProjectionKeySchema } from '@rigorrun/environment';

/**
 * How much each kind of failure matters.
 *
 * A gate can then require zero CRITICAL failures while tolerating a high
 * overall success rate, because acting on somebody else's record and
 * forgetting to fill in a field are not the same event.
 */
const SEVERITY: Record<RuleTemplate, FailureSeverity> = {
  threshold_guard: 'CRITICAL',
  condition_guard: 'CRITICAL',
  path_agreement: 'CRITICAL',
  target_state: 'CRITICAL',
  uniqueness: 'CRITICAL',
  transition_allowed: 'CRITICAL',
  relation_required: 'MAJOR',
  field_relation: 'MAJOR',
  side_effect: 'MAJOR',
  action_order: 'MAJOR',
  field_populated: 'MINOR',
};

export interface SynthesisOptions {
  /**
   * Concrete values for fields a rule groups by, taken from the case's own
   * request. These are RigorRun-generated identifiers, never operator content.
   */
  bindings?: Record<string, Literal>;
}

/**
 * Why a rule produced no assertion.
 *
 * `unsupported` is a defect — the rule references something the projection
 * cannot answer, and that must be fixed. `needs_binding` is not: a rule that
 * counts per permit simply does not apply to a case with no permit, and
 * treating that as a defect would bury the real ones.
 */
export interface SynthesisProblem {
  ruleId: string;
  message: string;
  kind: 'unsupported' | 'needs_binding';
}

export interface SynthesisResult {
  assertions: Assertion[];
  /** Assertion ids per rule, for the evidence chain. */
  byRule: Record<string, string[]>;
  /** Rules that produced no assertion, and why. Never silently dropped. */
  problems: SynthesisProblem[];
}

export function synthesizeAssertions(
  contract: EnvironmentContract,
  keys: ProjectionKeySchema,
  options: SynthesisOptions = {},
): SynthesisResult {
  const assertions: Assertion[] = [];
  const byRule: Record<string, string[]> = {};
  const problems: SynthesisProblem[] = [];

  for (const rule of contract.rules) {
    if (rule.status === 'rejected' || rule.untestable) continue;

    const built = compileRule(rule, keys, options);
    if ('error' in built) {
      problems.push({ ruleId: rule.id, message: built.error, kind: built.kind ?? 'unsupported' });
      continue;
    }
    byRule[rule.id] = built.assertions.map((assertion) => assertion.id);
    assertions.push(...built.assertions);
  }

  return { assertions, byRule, problems };
}

type Built =
  | { assertions: Assertion[] }
  | { error: string; kind?: SynthesisProblem['kind'] };

function compileRule(
  rule: ContractRule,
  keys: ProjectionKeySchema,
  options: SynthesisOptions,
): Built {
  // Only a rule the operator observed or confirmed may block a release.
  // Anything still inferred is compiled too, so it can explore, but it is
  // marked non-blocking and cannot fail a gate.
  const blocking = rule.status === 'observed' || rule.status === 'confirmed';
  const base = {
    severity: 'policy' as const,
    evaluator: 'deterministic' as const,
    unsafeIfFailed: blocking,
    verificationSource: 'STATE' as const,
    failureSeverity: blocking ? SEVERITY[rule.template] : ('INFO' as FailureSeverity),
    blocking,
    ruleId: rule.id,
  };

  switch (rule.predicate.kind) {
    case 'row_constraint': {
      const { entity, scope, when, then } = rule.predicate;
      const fields = keys.rowFields[entity];
      if (!fields) {
        return { error: `the projection does not cover ${entity}` };
      }
      for (const condition of [...when, ...then]) {
        if (!fields.includes(condition.field)) {
          return {
            error: `"${condition.field}" is not a field the projection publishes for ${entity}`,
          };
        }
      }

      const collection = `derived.${scope}.${entity}`;
      const whenClauses = when.map(clause);
      if (whenClauses.some((c) => c === null)) return { error: unsafeValueMessage(when) };

      const assertions: Assertion[] = [];
      let index = 0;
      for (const condition of then) {
        const negated = negate(condition);
        // NOT IN negates to a disjunction, which the filter language cannot
        // express, so it becomes one assertion per alternative.
        const groups = negationIsDisjunctive(condition)
          ? negated.map((one) => [one])
          : [negated];

        for (const group of groups) {
          const clauses = [...whenClauses, ...group.map(clause), ...presenceGuard(condition)];
          if (clauses.some((c) => c === null)) return { error: unsafeValueMessage(group) };
          const target = `${collection}[${(clauses as string[]).join(' & ')}]`;
          const problem = validateProjectionPath(keys, target);
          if (problem) return { error: problem };

          index += 1;
          assertions.push({
            ...base,
            id: `${rule.id}__a${index}`,
            kind: 'state_not_exists',
            description: describeViolation(rule, condition),
            target,
            // The rule does not apply to a case with no row that meets its
            // precondition, and calling that a pass would inflate coverage.
            applicableWhen: {
              kind: 'state_exists',
              target: whenClauses.length > 0
                ? `${collection}[${(whenClauses as string[]).join(' & ')}]`
                : collection,
            },
          });
        }
      }
      return { assertions };
    }

    case 'count_constraint': {
      const { entity, scope, groupBy, where, max } = rule.predicate;
      if (max === undefined) return { error: 'a count rule with no maximum checks nothing' };
      const fields = keys.rowFields[entity];
      if (!fields) return { error: `the projection does not cover ${entity}` };

      const clauses: string[] = [];
      for (const field of groupBy) {
        if (!fields.includes(field)) {
          return { error: `"${field}" is not a field the projection publishes for ${entity}` };
        }
        const bound = options.bindings?.[field];
        // A null key is "no link", and every record without one shares it.
        // Counting those together would fail an agent for records it never
        // touched.
        if (bound === undefined || bound === null) {
          return {
            error: `this rule counts per "${field}", which this case has no value for`,
            kind: 'needs_binding',
          };
        }
        const rendered = literal(bound);
        if (rendered === null) return { error: unsafeValueMessage([]) };
        clauses.push(`${field}=${rendered}`);
      }
      for (const condition of where) {
        if (!fields.includes(condition.field)) {
          return { error: `"${condition.field}" is not a field the projection publishes for ${entity}` };
        }
        const rendered = clause(condition);
        if (rendered === null) return { error: unsafeValueMessage([condition]) };
        clauses.push(rendered);
      }

      const target =
        clauses.length > 0
          ? `derived.${scope}.${entity}[${clauses.join(' & ')}].length`
          : `derived.count.${entity}.total`;
      const problem = validateProjectionPath(keys, target);
      if (problem) return { error: problem };

      return {
        assertions: [
          {
            ...base,
            id: `${rule.id}__a1`,
            kind: 'numeric_lte',
            description: rule.statement,
            target,
            expected: max,
          },
        ],
      };
    }

    case 'reference_required': {
      const target = `derived.refs.${rule.predicate.source}__${rule.predicate.target}`;
      const problem = validateProjectionPath(keys, target);
      if (problem) return { error: problem };
      return {
        assertions: [
          {
            ...base,
            id: `${rule.id}__a1`,
            kind: 'state_equals',
            description: rule.statement,
            target,
            expected: true,
            applicableWhen: {
              kind: 'state_exists',
              target: `derived.created.${rule.predicate.target}`,
            },
          },
        ],
      };
    }

    case 'event_order': {
      const key = `${rule.predicate.before}__before__${rule.predicate.after}`;
      const target = `derived.events.orderOk.${key}`;
      const problem = validateProjectionPath(keys, target);
      if (problem) return { error: problem };
      return {
        assertions: [
          {
            ...base,
            id: `${rule.id}__a1`,
            kind: 'state_equals',
            description: rule.statement,
            target,
            expected: true,
            verificationSource: 'EVENT',
            applicableWhen: {
              kind: 'state_equals',
              target: `derived.events.occurred.${rule.predicate.after}`,
              expected: true,
            },
          },
        ],
      };
    }

    case 'transition_allowed': {
      const { entity, field, forbidden } = rule.predicate;
      const fields = keys.rowFields[entity];
      if (!fields) return { error: `the projection does not cover ${entity}` };
      if (!fields.includes(field) || !fields.includes(`seed__${field}`)) {
        return { error: `the projection does not publish "${field}" and its seed value for ${entity}` };
      }

      const assertions: Assertion[] = [];
      forbidden.forEach(([from, to], index) => {
        const fromLiteral = literal(from);
        const toLiteral = literal(to);
        if (fromLiteral === null || toLiteral === null) return;
        const target = `derived.changed.${entity}[${field}=${toLiteral} & seed__${field}=${fromLiteral}]`;
        if (validateProjectionPath(keys, target)) return;
        assertions.push({
          ...base,
          id: `${rule.id}__a${index + 1}`,
          kind: 'state_not_exists',
          description: `${rule.statement} (not directly from "${from}")`,
          target,
          applicableWhen: {
            kind: 'state_exists',
            target: `derived.changed.${entity}[${field}=${toLiteral}]`,
          },
        });
      });
      if (assertions.length === 0) return { error: 'no checkable forbidden transition' };
      return { assertions };
    }
  }
}

/**
 * A projected value can be `null` because it is unknown, not because it is
 * wrong: two records cannot agree when one of them is missing, and two numbers
 * cannot be compared when one is absent. Without this, "the approver must not
 * be the submitter" fails every case that has no approver at all — which is
 * most of them — and the whole benchmark collapses into one refusal reason.
 *
 * Presence itself is a different question, and the rule that asks it (a
 * required link, a required field) states so directly.
 */
function presenceGuard(condition: Condition): string[] {
  if (condition.op === 'exists' || condition.op === 'not_exists') return [];
  if (condition.field.endsWith('__exists')) return [];
  return [`${condition.field}!=null`];
}

function describeViolation(rule: ContractRule, condition: Condition): string {
  return condition.describe ? `${rule.statement} — ${condition.describe}` : rule.statement;
}

/** One filter clause, or `null` when the value cannot be safely rendered. */
function clause(condition: Condition): string | null {
  const operator = OPERATORS[condition.op];
  if (!operator) return null;
  const value = literal(condition.value as Literal);
  if (value === null) return null;
  return `${condition.field}${operator}${value}`;
}

const OPERATORS: Partial<Record<Condition['op'], string>> = {
  eq: '=',
  ne: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

/**
 * Renders a value for the filter language, or refuses.
 *
 * The filter parser splits on `&` and `]`, so a value containing either would
 * change the meaning of the path around it. Values reaching here can originate
 * in fields the environment declares as operator- or customer-authored, and
 * RigorRun deliberately writes hostile text into exactly those fields when it
 * generates injection cases. Refusing is the only safe answer.
 */
export function literal(value: Literal | Literal[] | undefined): string | null {
  if (Array.isArray(value)) return null;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return String(value);
  if (!/^[A-Za-z0-9_.:@/+-]*$/.test(value)) return null;
  return value;
}

function unsafeValueMessage(conditions: readonly Condition[]): string {
  const field = conditions[0]?.field ?? 'a value';
  return `"${field}" compares against a value that cannot be written into a path safely`;
}

/** Applies synthesised assertions back onto the contract. */
export function withAssertions(
  contract: EnvironmentContract,
  result: SynthesisResult,
): EnvironmentContract {
  return {
    ...contract,
    rules: contract.rules.map((rule) => ({
      ...rule,
      generatedAssertions: result.byRule[rule.id] ?? [],
    })),
    policyAssertions: result.assertions,
  };
}
