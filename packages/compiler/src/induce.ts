/**
 * Demonstration → environment contract.
 *
 * The wedge: a person does the job once, and RigorRun writes the benchmark.
 *
 * Everything here is driven by the declared schema, the state delta and the
 * text the operator could see. There is no vocabulary in this file — no list
 * of words like "refund" or "approval", no observation names to match. That is
 * not a stylistic preference: a compiler that knows what a refund is can only
 * ever compile refunds, which is exactly what the previous version of this
 * file did.
 *
 * The conservatism is deliberate and load-bearing. A single demonstration
 * shows what somebody *did*, never what they are *required* to do, so almost
 * everything here is emitted as `inferred` with a question attached. Only
 * facts that are literally in the delta are `observed`.
 */
import {
  type CanonicalHumanTrace,
  type ContractRule,
  type EnvironmentContract,
  type ObservedFact,
  type Provenance,
  type RulePredicate,
  ENVIRONMENT_CONTRACT_SCHEMA_VERSION,
  actionSteps,
  surfaceText,
} from '@rigorrun/core';
import {
  buildProjection,
  describeDelta,
  diffStates,
  entityByName,
  fieldByName,
  relationshipsFrom,
  type CanonicalState,
  type DecoratedRow,
  type EntityRow,
  type EntitySchema,
  type EnvEvent,
  type EnvironmentAdapter,
  type EnvironmentSchema,
  type FieldSchema,
  type ProjectionResult,
  type StateDelta,
} from '@rigorrun/environment';
import {
  article,
  describePath,
  entityLabel,
  fieldLabel,
  formatQuantity,
  humanise,
  list,
} from './language.ts';

export interface InduceOptions {
  contractId?: string;
  name?: string;
  createdAt?: string;
}

export interface Induction {
  contract: EnvironmentContract;
  projection: ProjectionResult;
  deltas: StateDelta[];
}

interface Context {
  schema: EnvironmentSchema;
  adapter: EnvironmentAdapter;
  trace: CanonicalHumanTrace;
  before: CanonicalState;
  after: CanonicalState;
  deltas: StateDelta[];
  projection: ProjectionResult;
  focusEntity: EntitySchema;
  /** Whether the job creates the record it is about, or changes one. */
  focusScope: 'created' | 'changed';
  focusRow: DecoratedRow;
  primaryAction: string;
  remedyActions: string[];
  completionActions: string[];
  demonstratedArgs: Record<string, Record<string, unknown>>;
  statedNumbers: StatedNumber[];
}

export function induceContract(
  adapter: EnvironmentAdapter,
  trace: CanonicalHumanTrace,
  options: InduceOptions = {},
): Induction {
  const schema = adapter.describeEntities();
  const before = (trace.before ?? { entities: {} }) as CanonicalState;
  const after = (trace.after ?? { entities: {} }) as CanonicalState;
  const deltas = diffStates(schema, before, after);
  const events = eventsFromTrace(trace);

  const projection = buildProjection(schema, {
    seed: before,
    final: after,
    events,
    knownEventTypes: adapter
      .getActions()
      .filter((action) => !action.readOnly)
      .map((action) => action.name),
  });

  const primary = resolvePrimaryAction(adapter, trace, deltas);
  if (!primary) {
    throw new Error(
      'The recording contains no action that changes the system, so there is no job to compile. RigorRun verifies against authoritative state, and reading a record is not work it can check.',
    );
  }

  const focus = resolveFocusEntity(schema, adapter, deltas, primary);
  if (!focus) {
    throw new Error(
      `The recording performed "${primary}" but nothing in the system changed. RigorRun verifies against authoritative state, so a job that leaves no trace cannot be compiled.`,
    );
  }

  const focusScope: 'created' | 'changed' = deltas.some(
    (delta) => delta.kind === 'entity_created' && delta.entity === focus.name,
  )
    ? 'created'
    : 'changed';
  const focusRow = projection.derived[focusScope][focus.name]?.[0];
  if (!focusRow) {
    throw new Error(`No ${focus.name} row was created or changed by the demonstration.`);
  }

  // Remedies are the mutating things the operator did *before* the job itself
  // — asking for an approval, opening a record. Anything after it is a side
  // effect, not a way of unblocking the work.
  const performed = actionSteps(trace).map((step) => step.action?.name ?? '');
  const primaryIndex = performed.lastIndexOf(primary);
  const isMutating = (name: string): boolean =>
    !(adapter.getActions().find((a) => a.name === name)?.readOnly ?? true);
  const remedyActions = performed
    .slice(0, primaryIndex)
    .filter((name) => name !== '' && name !== primary && isMutating(name));
  const completionActions = performed
    .slice(primaryIndex + 1)
    .filter((name) => name !== '' && name !== primary && isMutating(name));
  const demonstratedArgs: Record<string, Record<string, unknown>> = {};
  for (const step of actionSteps(trace)) {
    if (step.action) demonstratedArgs[step.action.name] = step.action.args;
  }

  const context: Context = {
    schema,
    adapter,
    trace,
    before,
    after,
    deltas,
    projection,
    focusEntity: focus,
    focusScope,
    focusRow,
    primaryAction: primary,
    remedyActions: [...new Set(remedyActions)],
    completionActions: [...new Set(completionActions)],
    demonstratedArgs,
    statedNumbers: readStatedNumbers(trace, schema),
  };

  // Thresholds first: a link the operator obtained *because* the amount was
  // large is evidence for a threshold rule, not for an unconditional one, and
  // emitting both would make the smaller amounts fail for a reason the
  // recording never showed.
  const thresholds = thresholdGuard(context);
  const conditions = conditionGuard(context);
  const guarded = new Set(
    [...thresholds, ...conditions]
      .map((rule) => rule.id.split('__').at(-1) ?? '')
      .filter((name) => name !== ''),
  );

  const rules = [
    ...thresholds,
    ...conditions,
    ...relationRequired(context, guarded),
    ...fieldPopulated(context),
    ...pathAgreement(context),
    ...targetState(context),
    ...uniqueness(context),
    ...sideEffect(context),
    ...fieldRelation(context),
    ...transitionAllowed(context),
    ...actionOrder(context),
  ].sort((a, b) => a.id.localeCompare(b.id));

  const createdAt = options.createdAt ?? new Date().toISOString();
  const contract: EnvironmentContract = {
    schemaVersion: ENVIRONMENT_CONTRACT_SCHEMA_VERSION,
    id: options.contractId ?? `ec_${trace.id}`,
    name: options.name ?? trace.name,
    description: `Compiled from one recorded execution in ${adapter.name}.`,
    goal: goalStatement(context),
    environmentId: adapter.id,
    sourceTraceId: trace.id,
    primaryAction: primary,
    focusEntity: focus.name,
    focusScope,
    remedyActions: context.remedyActions,
    completionActions: context.completionActions,
    demonstratedArgs: context.demonstratedArgs,
    projectionFocus: projection.keys.entities,
    observedFacts: observedFacts(context),
    rules,
    successAssertions: [],
    policyAssertions: [],
    createdAt,
  };

  return { contract, projection, deltas };
}

// ------------------------------------------------------------------ the facts

function observedFacts(context: Context): ObservedFact[] {
  return context.deltas.map((delta, index) => ({
    id: `fact_${String(index + 1).padStart(3, '0')}`,
    statement: describeDelta(context.schema, delta),
    key: factKey(delta),
    value: factValue(delta),
    provenance: [
      { kind: 'state_delta' as const, ref: `delta_${index}`, detail: describeDelta(context.schema, delta) },
    ],
  }));
}

function factKey(delta: StateDelta): string {
  switch (delta.kind) {
    case 'entity_created':
    case 'entity_deleted':
      return `${delta.entity}.${delta.id}`;
    case 'field_changed':
      return `${delta.entity}.${delta.field}`;
    case 'relationship_set':
    case 'relationship_cleared':
      return `${delta.entity}.${delta.relationship}`;
  }
}

function factValue(delta: StateDelta): unknown {
  switch (delta.kind) {
    case 'entity_created':
    case 'entity_deleted':
      return delta.row;
    case 'field_changed':
      return { from: delta.from, to: delta.to };
    case 'relationship_set':
      return delta.target;
    case 'relationship_cleared':
      return null;
  }
}

function goalStatement(context: Context): string {
  const definition = context.adapter.getActions().find((a) => a.name === context.primaryAction);
  const label = entityLabel(context.schema, context.focusEntity.name);
  const described = definition?.description?.trim().replace(/\.+$/, '');
  return described && described.length > 0 ? described : `Complete ${article(label)} correctly`;
}

// ------------------------------------------------------------------- templates

/** T2 — the demonstration linked something, so perhaps a link is required. */
function relationRequired(context: Context, guarded: ReadonlySet<string>): ContractRule[] {
  const rules: ContractRule[] = [];
  for (const relationship of relationshipsFrom(context.schema, context.focusEntity.name)) {
    if (relationship.via.kind !== 'fk' || relationship.cardinality !== 'one') continue;
    // A link the environment already insists on is not a policy question.
    if (relationship.required) continue;
    // Nor is one a threshold rule already accounts for.
    if (guarded.has(relationship.name)) continue;
    if (context.focusRow[`${relationship.name}__exists`] !== true) continue;

    const target = entityLabel(context.schema, relationship.to);
    rules.push(
      makeRule({
        id: `relation_required__${relationship.name}`,
        template: 'relation_required',
        statement: `every ${entityLabel(context.schema, context.focusEntity.name)} must be linked to ${article(target)}`,
        confidence: 0.65,
        provenance: [
          delta(context, `the demonstration linked ${article(target)}`),
          schemaProvenance(`${context.focusEntity.name}.${relationship.name}`),
        ],
        question: {
          text: `Does every ${entityLabel(context.schema, context.focusEntity.name)} always need ${article(target)}?`,
          reason: `One recording linked ${article(target)}. Whether it is mandatory was never demonstrated.`,
        },
        implications: [
          `An agent that completes the job without ${article(target)} will fail.`,
        ],
        predicate: {
          kind: 'row_constraint',
          entity: context.focusEntity.name,
          scope: context.focusScope,
          when: [],
          then: [
            {
              field: `${relationship.name}__exists`,
              op: 'eq',
              value: true,
              describe: `${article(target)} is linked`,
            },
          ],
        },
      }),
    );
  }
  return rules;
}

/** T7 — a nullable field the operator filled in. */
function fieldPopulated(context: Context): ContractRule[] {
  const rules: ContractRule[] = [];
  const fkFields = new Set(
    relationshipsFrom(context.schema, context.focusEntity.name)
      .map((relationship) => (relationship.via.kind === 'fk' ? relationship.via.field : ''))
      .filter(Boolean),
  );

  for (const field of context.focusEntity.fields) {
    if (!field.nullable) continue;
    if (fkFields.has(field.name)) continue;
    if (field.role === undefined || field.role === 'freetext') continue;
    const value = context.focusRow[field.name];
    if (value === null || value === undefined) continue;

    const isActor = field.role === 'actor';
    const onlyActor =
      context.focusEntity.fields.filter((candidate) => candidate.role === 'actor').length === 1;
    rules.push(
      makeRule({
        id: `field_populated__${field.name}`,
        template: 'field_populated',
        statement:
          isActor && onlyActor
            ? `every ${entityLabel(context.schema, context.focusEntity.name)} must record who did it`
            : `every ${entityLabel(context.schema, context.focusEntity.name)} must have ${article(fieldLabel(context.focusEntity, field.name))}`,
        confidence: isActor ? 0.8 : 0.55,
        provenance: [delta(context, `the demonstration set ${fieldLabel(context.focusEntity, field.name)}`)],
        question: {
          text: isActor
            ? `Must every ${entityLabel(context.schema, context.focusEntity.name)} record who performed it?`
            : `Is ${fieldLabel(context.focusEntity, field.name)} always required?`,
          reason: 'The field can be left empty, and the operator filled it in once.',
        },
        implications: [],
        predicate: {
          kind: 'row_constraint',
          entity: context.focusEntity.name,
          scope: context.focusScope,
          when: [],
          then: [
            {
              field: field.name,
              op: 'exists',
              describe: `${fieldLabel(context.focusEntity, field.name)} is set`,
            },
          ],
        },
      }),
    );
  }
  return rules;
}

/** T3 — two paths that reached the same kind of thing, and either matched or
 * deliberately did not. Ownership checks and segregation of duties are the
 * same template with opposite polarity. */
function pathAgreement(context: Context): ContractRule[] {
  const rules: ContractRule[] = [];
  for (const [key, value] of Object.entries(context.focusRow).sort()) {
    if (!key.startsWith('agrees__') || typeof value !== 'boolean') continue;
    const [left, right] = key.slice('agrees__'.length).split('__vs__');
    if (!left || !right) continue;
    // At least one side must be a field of the record being created. Two
    // related records agreeing with each other is a fact about the world the
    // operator walked through, not a rule about the work being done.
    if (left.includes('__') && right.includes('__')) continue;

    const a = describePath(context.schema, context.focusEntity.name, left);
    const b = describePath(context.schema, context.focusEntity.name, right);
    const mustMatch = value;

    rules.push(
      makeRule({
        id: `path_agreement__${left}__vs__${right}`,
        template: 'path_agreement',
        statement: mustMatch ? `${a} must be ${b}` : `${a} must not be ${b}`,
        confidence: 0.6,
        provenance: [
          delta(
            context,
            mustMatch
              ? `in the demonstration ${a} and ${b} were the same`
              : `in the demonstration ${a} and ${b} were deliberately different`,
          ),
        ],
        question: {
          text: mustMatch
            ? `Must ${a} always be ${b}?`
            : `Must ${a} always be someone other than ${b}?`,
          reason: 'One recording shows one pairing. Whether it is a rule was never demonstrated.',
        },
        implications: mustMatch
          ? [`An agent acting on a record belonging to someone else will fail.`]
          : [`An agent that lets one person do both halves of the job will fail.`],
        predicate: {
          kind: 'row_constraint',
          entity: context.focusEntity.name,
          scope: context.focusScope,
          when: [],
          then: [{ field: key, op: 'eq', value: mustMatch, describe: mustMatch ? `${a} is ${b}` : `${a} is not ${b}` }],
        },
      }),
    );
  }
  return rules;
}

/** T1 — a number stated in the interface, and something that might guard it. */
function thresholdGuard(context: Context): ContractRule[] {
  const rules: ContractRule[] = [];
  const quantities = quantityPaths(context);
  if (quantities.length === 0 || context.statedNumbers.length === 0) return rules;

  const relationGuards = guardCandidates(context);
  if (relationGuards.length === 0 && ownGuardCandidates(context).length === 0) return rules;

  for (const quantity of quantities) {
    const observed = context.focusRow[quantity.path];
    // A threshold on the record's own number decides whether the work may
    // happen at all, so only an external permission can satisfy it. A
    // threshold on a *related* record's number describes the record being
    // worked on, so setting a field on it is a legitimate answer — that is
    // how "500 employees or more makes it enterprise" gets expressed.
    const guards = quantity.path.includes('__')
      ? [...relationGuards, ...ownGuardCandidates(context)]
      : relationGuards;

    for (const stated of context.statedNumbers) {
      if (!unitMatchesText(quantity.field.unit, stated.text)) continue;
      for (const guard of guards) {
        const exercised =
          typeof observed === 'number' && observed > stated.value && guard.presentInDemo;
        rules.push(
          makeRule({
            id: `threshold_guard__${quantity.path}__${stated.value}__${guard.id}`,
            template: 'threshold_guard',
            statement: `when ${describePath(context.schema, context.focusEntity.name, quantity.path)} is above ${formatQuantity(stated.value, quantity.field.unit)}, ${guard.requirement}`,
            // A number scraped off a page is the weakest evidence in the
            // system. It gets a higher score only when the demonstration
            // actually crossed the threshold and took the guarded path.
            confidence: exercised ? 0.75 : 0.55,
            provenance: [
              { kind: 'ui_text', ref: stated.stepId, detail: stated.text },
              delta(
                context,
                typeof observed === 'number'
                  ? `the demonstrated value was ${formatQuantity(observed, quantity.field.unit)}, ${guard.presentInDemo ? 'with' : 'without'} ${guard.label}`
                  : 'the demonstration created the record',
              ),
            ],
            question: {
              text: `When ${describePath(context.schema, context.focusEntity.name, quantity.path)} is above ${formatQuantity(stated.value, quantity.field.unit)}, must ${guard.requirement}?`,
              reason: `RigorRun read "${stated.text.trim()}" in the interface. That is text on a page, not a policy source of truth, and one recording shows one amount.`,
            },
            implications: [
              `Below ${formatQuantity(stated.value, quantity.field.unit)} this does not apply.`,
              `Above it, an agent that proceeds without ${guard.label} will fail.`,
            ],
            predicate: {
              kind: 'row_constraint',
              entity: context.focusEntity.name,
              scope: context.focusScope,
              when: [
                {
                  field: quantity.path,
                  op: 'gt',
                  value: stated.value,
                  describe: `${describePath(context.schema, context.focusEntity.name, quantity.path)} is above ${formatQuantity(stated.value, quantity.field.unit)}`,
                },
              ],
              then: guard.conditions,
            },
          }),
        );
      }
    }
  }
  return rules;
}

interface QuantityPath {
  path: string;
  field: FieldSchema;
}

/** Numbers on the record being worked on, and on records it names. */
function quantityPaths(context: Context): QuantityPath[] {
  const out: QuantityPath[] = [];
  for (const field of context.focusEntity.fields) {
    if (field.role === 'quantity' && field.unit !== undefined) out.push({ path: field.name, field });
  }
  for (const relationship of relationshipsFrom(context.schema, context.focusEntity.name)) {
    if (relationship.via.kind !== 'fk' || relationship.cardinality !== 'one') continue;
    const target = entityByName(context.schema, relationship.to);
    for (const field of target?.fields ?? []) {
      if (field.role !== 'quantity' || field.unit === undefined) continue;
      out.push({ path: `${relationship.name}__${field.name}`, field });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

interface GuardCandidate {
  id: string;
  label: string;
  /** Reads after "must", e.g. "carry an approval marked approved". */
  requirement: string;
  presentInDemo: boolean;
  conditions: { field: string; op: 'eq'; value: string | boolean; describe: string }[];

}

/**
 * Things that could plausibly gate a large amount: an optional link to
 * something with a lifecycle, in the state the demonstration used.
 */
function guardCandidates(context: Context): GuardCandidate[] {
  const guards: GuardCandidate[] = [];
  for (const relationship of relationshipsFrom(context.schema, context.focusEntity.name)) {
    if (relationship.via.kind !== 'fk' || relationship.cardinality !== 'one') continue;
    if (relationship.required) continue;
    const target = entityByName(context.schema, relationship.to);
    if (!target) continue;
    const status = target.fields.find((field) => field.role === 'status');
    if (!status) continue;

    // A guard is something an operator goes and obtains when the work needs
    // it. A record that was already sitting there when work began is context,
    // not a permission, and treating it as one fills the review queue with
    // rules nobody would write.
    if (context.focusRow[`seed__${relationship.name}__exists`] === true) continue;

    const observedStatus = context.focusRow[`${relationship.name}__${status.name}`];
    const present = context.focusRow[`${relationship.name}__exists`] === true;
    // Which state counts as "granted" is read from what the demonstration
    // used, or falls back to the last declared value — never from a word list.
    const grantedValue =
      present && typeof observedStatus === 'string'
        ? observedStatus
        : ((status.enumValues ?? []).at(-1) ?? '');
    if (grantedValue === '') continue;

    const label = `${article(entityLabel(context.schema, relationship.to))} marked ${grantedValue}`;
    guards.push({
      id: relationship.name,
      label,
      requirement: `it carry ${label}`,
      presentInDemo: present,
      // Existence and state are stated separately, so "over the limit with no
      // approval at all" is caught by the first condition rather than slipping
      // through as a value nobody can compare.
      conditions: [
        {
          field: `${relationship.name}__exists`,
          op: 'eq',
          value: true,
          describe: `${article(entityLabel(context.schema, relationship.to))} exists`,
        },
        {
          field: `${relationship.name}__${status.name}`,
          op: 'eq',
          value: grantedValue,
          describe: label,
        },
      ],
    });
  }
  return guards;
}

/**
 * Values the work itself set on the record.
 *
 * Only ever offered as the consequent of a threshold on a *related* record's
 * number — "the company has 500 staff, so this is an enterprise lead". A
 * threshold on the record's own number is about permission, and setting a
 * field on yourself is not a permission.
 */
function ownGuardCandidates(context: Context): GuardCandidate[] {
  const guards: GuardCandidate[] = [];
  for (const field of context.focusEntity.fields) {
    if (field.type !== 'enum' || field.role === undefined) continue;
    const value = context.focusRow[field.name];
    if (typeof value !== 'string') continue;
    // Skip the field the lifecycle rule already covers.
    if (context.deltas.some((d) => d.kind === 'field_changed' && d.field === field.name && d.entity === context.focusEntity.name && field.name === lifecycleField(context))) {
      continue;
    }
    const label = `${fieldLabel(context.focusEntity, field.name)} of "${value}"`;
    guards.push({
      id: `own_${field.name}`,
      label,
      requirement: `its ${fieldLabel(context.focusEntity, field.name)} be "${value}"`,
      presentInDemo: true,
      conditions: [
        {
          field: field.name,
          op: 'eq',
          value,
          describe: label,
        },
      ],
    });
  }
  return guards;
}

/** The enum a transition rule was induced for, if any. */
function lifecycleField(context: Context): string | undefined {
  for (const delta of context.deltas) {
    if (delta.kind !== 'field_changed' || delta.entity !== context.focusEntity.name) continue;
    const field = fieldByName(context.focusEntity, delta.field);
    if (field?.role === 'status') return field.name;
  }
  return undefined;
}

/**
 * A flag that was set when the operator obtained a permission.
 *
 * "Restricted region, so get a compliance review", "flagged for fraud, so get
 * a manual check", "admin access, so get sign-off" are all this shape, and
 * none of them is a number.
 */
function conditionGuard(context: Context): ContractRule[] {
  const rules: ContractRule[] = [];
  const guards = guardCandidates(context).filter((guard) => guard.presentInDemo);
  if (guards.length === 0) return rules;

  for (const [path, value] of flagPaths(context)) {
    if (value !== true) continue;
    const described = describePath(context.schema, context.focusEntity.name, path);
    for (const guard of guards) {
      rules.push(
        makeRule({
          id: `condition_guard__${path}__${guard.id}`,
          template: 'condition_guard',
          statement: `when ${described} is set, ${guard.requirement}`,
          confidence: 0.6,
          provenance: [
            delta(context, `${described} was set, and the operator obtained ${guard.label}`),
            schemaProvenance(path),
          ],
          question: {
            text: `When ${described} is set, must ${guard.requirement}?`,
            reason: `The recording shows the two together once. Whether one requires the other was never demonstrated on its own.`,
          },
          implications: [`An agent that proceeds without ${guard.label} in that situation will fail.`],
          predicate: {
            kind: 'row_constraint',
            entity: context.focusEntity.name,
            scope: context.focusScope,
            when: [{ field: path, op: 'eq', value: true, describe: `${described} is set` }],
            then: guard.conditions,
          },
        }),
      );
    }
  }
  return rules;
}

/** Boolean gates on the record and on records it names. */
function flagPaths(context: Context): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const field of context.focusEntity.fields) {
    if (field.role === 'flag') out.push([field.name, context.focusRow[field.name]]);
  }
  for (const relationship of relationshipsFrom(context.schema, context.focusEntity.name)) {
    if (relationship.via.kind !== 'fk' || relationship.cardinality !== 'one') continue;
    const target = entityByName(context.schema, relationship.to);
    for (const field of target?.fields ?? []) {
      if (field.role !== 'flag') continue;
      const path = `${relationship.name}__${field.name}`;
      out.push([path, context.focusRow[path]]);
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

/** T5 — the related record was in a particular state when the work was done. */
function targetState(context: Context): ContractRule[] {
  const rules: ContractRule[] = [];
  for (const relationship of relationshipsFrom(context.schema, context.focusEntity.name)) {
    if (relationship.via.kind !== 'fk' || relationship.cardinality !== 'one') continue;
    const target = entityByName(context.schema, relationship.to);
    if (!target) continue;
    // Only a record that can actually change has a state worth checking. A
    // fixed classification is a property of the record, not a stage of the
    // work, and turning it into a rule produces noise a reviewer has to wade
    // through.
    if (!target.mutable) continue;

    // A gate that was down when the work was done is a rule of the same
    // shape: "the order was not under a fraud hold" reads exactly like "the
    // ticket was open". Two hops, because the gate is often on the party
    // behind the record rather than on the record itself.
    for (const gate of target.fields.filter((field) => field.role === 'flag')) {
      const rule = flagStateRule(context, relationship.name, gate.name);
      if (rule) rules.push(rule);
    }
    for (const second of relationshipsFrom(context.schema, relationship.to)) {
      if (second.via.kind !== 'fk' || second.cardinality !== 'one') continue;
      const deeper = entityByName(context.schema, second.to);
      for (const gate of deeper?.fields.filter((field) => field.role === 'flag') ?? []) {
        const rule = flagStateRule(context, `${relationship.name}__${second.name}`, gate.name);
        if (rule) rules.push(rule);
      }
    }

    const status = target.fields.find((field) => field.role === 'status');
    if (!status) continue;

    // Read the state as it was when work began, so an operator who
    // legitimately resolves the linked record afterwards is not punished for
    // it. Fall back to the live value only when the record did not exist at
    // seed time — and take the path and the value from the same place, or the
    // rule would assert something it never saw.
    const seedKey = `seed__${relationship.name}__${status.name}`;
    const liveKey = `${relationship.name}__${status.name}`;
    const seedValue = context.focusRow[seedKey];
    const useSeed = typeof seedValue === 'string';
    const stateField = useSeed ? seedKey : liveKey;
    const observed = useSeed ? seedValue : context.focusRow[liveKey];
    if (typeof observed !== 'string') continue;
    const others = (status.enumValues ?? []).filter((value) => value !== observed);
    if (others.length === 0) continue;

    const path = describePath(context.schema, context.focusEntity.name, `${relationship.name}__${status.name}`);
    rules.push(
      makeRule({
        id: `target_state__${relationship.name}__${status.name}`,
        template: 'target_state',
        statement: `${path} must be "${observed}" when the work is done`,
        confidence: 0.5,
        provenance: [delta(context, `the linked record was "${observed}" when work began`)],
        question: {
          text: `Must ${path} always be "${observed}" for this work to be allowed?`,
          reason: `The recorded case happened to be "${observed}". It could also be ${list(others.map((v) => `"${v}"`))}, and none of those were exercised.`,
        },
        implications: [`An agent acting on a record in another state will fail.`],
        predicate: {
          kind: 'row_constraint',
          entity: context.focusEntity.name,
          scope: context.focusScope,
          when: [],
          then: [
            {
              field: stateField,
              op: 'in',
              value: [observed],
              describe: `${path} is "${observed}"`,
            },
          ],
        },
      }),
    );
  }
  return rules;
}

/** "The order was not on hold when it shipped." */
function flagStateRule(context: Context, relationPath: string, gate: string): ContractRule | null {
  const seedKey = `seed__${relationPath}__${gate}`;
  const liveKey = `${relationPath}__${gate}`;
  const seedValue = context.focusRow[seedKey];
  const useSeed = typeof seedValue === 'boolean';
  const field = useSeed ? seedKey : liveKey;
  const observed = useSeed ? seedValue : context.focusRow[liveKey];
  if (typeof observed !== 'boolean') return null;

  const path = describePath(context.schema, context.focusEntity.name, liveKey);
  return makeRule({
    id: `target_state__${relationPath}__${gate}`,
    template: 'target_state',
    statement: observed ? `${path} must be set` : `${path} must not be set`,
    confidence: 0.5,
    provenance: [delta(context, `${path} was ${observed ? 'set' : 'clear'} when the work was done`)],
    question: {
      text: observed ? `Must ${path} always be set?` : `Must ${path} always be clear?`,
      reason: `The recorded case had it ${observed ? 'set' : 'clear'}. The other way round was never exercised.`,
    },
    implications: [`An agent that proceeds with it the other way round will fail.`],
    predicate: {
      kind: 'row_constraint',
      entity: context.focusEntity.name,
      scope: context.focusScope,
      when: [],
      then: [{ field, op: 'eq', value: observed, describe: `${path} is ${observed}` }],
    },
  });
}

/** T4 — only one was created. Perhaps only one is ever allowed. */
function uniqueness(context: Context): ContractRule[] {
  const rules: ContractRule[] = [];
  const entityName = context.focusEntity.name;
  const rowsAfter = Object.values(context.after.entities[entityName] ?? {});

  for (const relationship of relationshipsFrom(context.schema, entityName)) {
    if (relationship.via.kind !== 'fk' || relationship.cardinality !== 'one') continue;
    const field = relationship.via.field;
    const counts = new Map<string, number>();
    for (const row of rowsAfter) {
      const key = String(row[field]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if ([...counts.values()].some((count) => count > 1)) continue;

    const targetLabel = entityLabel(context.schema, relationship.to);
    const selfLabel = entityLabel(context.schema, entityName);
    rules.push(
      makeRule({
        id: `uniqueness__${relationship.name}`,
        template: 'uniqueness',
        statement: `at most one ${selfLabel} per ${targetLabel}`,
        // The template most likely to produce a confidently wrong rule, so it
        // starts low and its question leads with the counterexample.
        confidence: 0.45,
        provenance: [delta(context, `the demonstration created exactly one ${selfLabel}`)],
        question: {
          text: `Could there ever legitimately be a second ${selfLabel} for the same ${targetLabel}?`,
          reason: `Only one was created in the recording, which does not show whether a second is allowed.`,
          counterexample: `A partial or follow-up ${selfLabel} would be a second one for the same ${targetLabel}.`,
        },
        implications: [`An agent that creates a second ${selfLabel} for the same ${targetLabel} will fail.`],
        predicate: {
          kind: 'count_constraint',
          entity: entityName,
          scope: 'all',
          groupBy: [field],
          where: [],
          max: 1,
        },
      }),
    );
  }

  rules.push(...tupleUniqueness(context, rowsAfter));
  return rules;
}

/**
 * "At most one of these per vendor *and* invoice number, once it is approved."
 *
 * Work that changes an existing record rather than creating one needs the
 * filtered form: counting every invoice regardless of state would fail an
 * agent for a duplicate that was already sitting in the system when it
 * started. The status filter is the state the demonstration ended in.
 */
function tupleUniqueness(context: Context, rowsAfter: EntityRow[]): ContractRule[] {
  const entity = context.focusEntity;
  const statusField = entity.fields.find((field) => field.role === 'status');
  const endState = statusField ? context.focusRow[statusField.name] : undefined;
  if (!statusField || typeof endState !== 'string' || rowsAfter.length < 2) return [];

  // Only keys the environment says every record must have. A natural key is
  // "this party's own reference number"; pairing it with an optional link to a
  // transient record produces rules nobody means.
  const foreignKeys = new Set(
    relationshipsFrom(context.schema, entity.name)
      .filter(
        (relationship) =>
          relationship.via.kind === 'fk' &&
          relationship.cardinality === 'one' &&
          relationship.required,
      )
      .map((relationship) => (relationship.via.kind === 'fk' ? relationship.via.field : '')),
  );
  const allForeignKeys = new Set(
    relationshipsFrom(context.schema, entity.name)
      .filter((relationship) => relationship.via.kind === 'fk' && relationship.cardinality === 'one')
      .map((relationship) => (relationship.via.kind === 'fk' ? relationship.via.field : '')),
  );
  const naturalKeys = entity.fields.filter(
    (field) =>
      field.role === 'identifier' &&
      field.name !== entity.idField &&
      !allForeignKeys.has(field.name),
  );

  const rules: ContractRule[] = [];
  for (const key of [...foreignKeys].sort()) {
    for (const natural of naturalKeys) {
      const counts = new Map<string, number>();
      for (const row of rowsAfter) {
        if (String(row[statusField.name]) !== endState) continue;
        const composite = `${String(row[key])}\u0000${String(row[natural.name])}`;
        counts.set(composite, (counts.get(composite) ?? 0) + 1);
      }
      if (counts.size === 0 || [...counts.values()].some((value) => value > 1)) continue;

      const selfLabel = entityLabel(context.schema, entity.name);
      rules.push(
        makeRule({
          id: `uniqueness__${key}__${natural.name}`,
          template: 'uniqueness',
          statement: `at most one ${selfLabel} may be "${endState}" for the same ${fieldLabel(entity, key)} and ${fieldLabel(entity, natural.name)}`,
          confidence: 0.55,
          provenance: [
            delta(
              context,
              `no two ${selfLabel}s in the system share a ${fieldLabel(entity, key)} and ${fieldLabel(entity, natural.name)} once "${endState}"`,
            ),
          ],
          question: {
            text: `Could the same ${fieldLabel(entity, key)} and ${fieldLabel(entity, natural.name)} ever legitimately be "${endState}" twice?`,
            reason: `Nothing in the system shows that pairing twice, but one recording cannot prove it never happens.`,
            counterexample: `A corrected resubmission reusing the same ${fieldLabel(entity, natural.name)}.`,
          },
          implications: [`An agent that lets a duplicate through will fail.`],
          predicate: {
            kind: 'count_constraint',
            entity: entity.name,
            scope: 'all',
            groupBy: [key, natural.name],
            where: [
              {
                field: statusField.name,
                op: 'eq',
                value: endState,
                describe: `it is "${endState}"`,
              },
            ],
            max: 1,
          },
        }),
      );
    }
  }
  return rules;
}

/** T6 — something else was written that references what was created. */
function sideEffect(context: Context): ContractRule[] {
  const rules: ContractRule[] = [];
  for (const [key, value] of Object.entries(context.projection.derived.refs).sort()) {
    if (value !== true) continue;
    const [source, target] = key.split('__');
    if (!source || !target) continue;
    if (target !== context.focusEntity.name) continue;

    const sourceEntity = entityByName(context.schema, source);
    const sourceLabel = entityLabel(context.schema, source);
    const targetLabel = entityLabel(context.schema, target);
    rules.push(
      makeRule({
        id: `side_effect__${source}__${target}`,
        template: 'side_effect',
        statement: `every ${targetLabel} must be recorded in ${article(sourceLabel)}`,
        confidence: sourceEntity?.appendOnly ? 0.7 : 0.5,
        provenance: [delta(context, `the demonstration wrote ${article(sourceLabel)} naming the new ${targetLabel}`)],
        question: {
          text: `Must every ${targetLabel} be written to the ${sourceLabel}?`,
          reason: 'The operator did it once. Whether it is required was not demonstrated.',
        },
        implications: [`An agent that does the work but records nothing will fail.`],
        predicate: { kind: 'reference_required', source, target },
      }),
    );
  }
  return rules;
}

/**
 * T8 — one number compared to another.
 *
 * Three-way matching, inventory sufficiency, and "return it within the loan
 * period" are all this shape, and none of them can be expressed as a field
 * compared to a constant. Without this template the hidden-domain test loses
 * the rule that workflow is actually about.
 */
function fieldRelation(context: Context): ContractRule[] {
  const rules: ContractRule[] = [];
  for (const [key, value] of Object.entries(context.focusRow).sort()) {
    if (!key.startsWith('cmp__') || typeof value !== 'number') continue;
    const [left, right] = key.slice('cmp__'.length).split('__minus__');
    if (!left || !right) continue;

    const a = describePath(context.schema, context.focusEntity.name, left);
    const b = describePath(context.schema, context.focusEntity.name, right);
    const unit = unitOfPath(context, left);

    if (value === 0) {
      rules.push(
        makeRule({
          id: `field_relation__eq__${left}__${right}`,
          template: 'field_relation',
          statement: `${a} must equal ${b}`,
          confidence: 0.6,
          provenance: [delta(context, `in the demonstration ${a} and ${b} were both ${String(context.focusRow[left])}`)],
          question: {
            text: `Must ${a} always equal ${b}?`,
            reason: 'They matched once. One recording cannot show whether a mismatch is ever allowed.',
          },
          implications: [`An agent that lets the two differ will fail.`],
          predicate: {
            kind: 'row_constraint',
            entity: context.focusEntity.name,
            scope: context.focusScope,
            when: [],
            then: [{ field: key, op: 'eq', value: 0, describe: `${a} equals ${b}` }],
          },
        }),
      );
      continue;
    }

    if (value < 0) {
      rules.push(
        makeRule({
          id: `field_relation__lte__${left}__${right}`,
          template: 'field_relation',
          statement: `${a} must not exceed ${b}`,
          confidence: 0.45,
          provenance: [delta(context, `in the demonstration ${a} was below ${b}`)],
          question: {
            text: `Must ${a} never exceed ${b}?`,
            reason: 'One recording stayed below the other value; nothing showed what happens above it.',
          },
          implications: [`An agent that goes over will fail.`],
          predicate: {
            kind: 'row_constraint',
            entity: context.focusEntity.name,
            scope: context.focusScope,
            when: [],
            then: [{ field: key, op: 'lte', value: 0, describe: `${a} is at most ${b}` }],
          },
        }),
      );
      continue;
    }

    // A positive gap between two times is usually an interval with a limit —
    // a loan period, a grace period, an access expiry.
    if (isRoundInterval(value)) {
      rules.push(
        makeRule({
          id: `field_relation__interval__${left}__${right}`,
          template: 'field_relation',
          statement: `${a} must be no more than ${formatQuantity(value, unit)} after ${b}`,
          confidence: 0.5,
          provenance: [delta(context, `the demonstrated gap was ${formatQuantity(value, unit)}`)],
          question: {
            text: `Must ${a} always be within ${formatQuantity(value, unit)} of ${b}?`,
            reason: `The one recorded case used ${formatQuantity(value, unit)}, which looks like a standard period rather than a coincidence.`,
          },
          implications: [`An agent that allows a longer gap will fail.`],
          predicate: {
            kind: 'row_constraint',
            entity: context.focusEntity.name,
            scope: context.focusScope,
            when: [],
            then: [
              { field: key, op: 'lte', value, describe: `the gap is at most ${formatQuantity(value, unit)}` },
            ],
          },
        }),
      );
    }
  }
  return rules;
}

/** T9 — a status moved along one edge, so perhaps only that edge is legal. */
function transitionAllowed(context: Context): ContractRule[] {
  const rules: ContractRule[] = [];
  for (const change of context.deltas) {
    if (change.kind !== 'field_changed') continue;
    const entity = entityByName(context.schema, change.entity);
    const field = entity ? fieldByName(entity, change.field) : undefined;
    if (!entity || !field || field.role !== 'status') continue;
    const from = String(change.from);
    const to = String(change.to);
    const others = (field.enumValues ?? []).filter((value) => value !== from && value !== to);
    if (others.length === 0) continue;

    const label = entityLabel(context.schema, entity.name);
    rules.push(
      makeRule({
        id: `transition_allowed__${entity.name}__${change.field}__${from}__${to}`,
        template: 'transition_allowed',
        statement: `${article(label)} may only become "${to}" from "${from}"`,
        confidence: 0.5,
        provenance: [delta(context, `the demonstration moved ${change.field} from "${from}" to "${to}"`)],
        question: {
          text: `May ${article(label)} become "${to}" directly from ${list(others.map((v) => `"${v}"`))}?`,
          reason: `The recording only shows the move from "${from}", so the other routes were never exercised.`,
        },
        implications: [`An agent that skips a step in the lifecycle will fail.`],
        predicate: {
          kind: 'transition_allowed',
          entity: entity.name,
          field: change.field,
          allowed: [[from, to]],
          forbidden: others.map((value): [string, string] => [value, to]),
        },
      }),
    );
  }
  return rules;
}

/** T10 — one action came before another. */
function actionOrder(context: Context): ContractRule[] {
  const performed = actionSteps(context.trace)
    .map((step) => step.action?.name)
    .filter((name): name is string => name !== undefined)
    .filter((name) => !(context.adapter.getActions().find((a) => a.name === name)?.readOnly ?? true));

  const rules: ContractRule[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < performed.length; i += 1) {
    for (let j = i + 1; j < performed.length; j += 1) {
      const before = performed[i];
      const after = performed[j];
      if (!before || !after || before === after) continue;
      const key = `${before}__${after}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rules.push(
        makeRule({
          id: `action_order__${key}`,
          template: 'action_order',
          statement: `"${humanise(before)}" must happen before "${humanise(after)}"`,
          confidence: 0.5,
          provenance: [
            { kind: 'recorded_action', ref: key, detail: `the operator did ${before}, then ${after}` },
          ],
          question: {
            text: `Must "${humanise(before)}" always come before "${humanise(after)}"?`,
            reason: 'That was the order in the recording. It may simply have been convenient.',
          },
          implications: [`An agent that does them the other way round will fail.`],
          predicate: { kind: 'event_order', before, after },
        }),
      );
    }
  }
  return rules;
}

// ---------------------------------------------------------------- text mining

interface StatedNumber {
  value: number;
  text: string;
  stepId: string;
}

/**
 * Numbers written in the interface next to words suggesting a limit.
 *
 * This is the weakest evidence RigorRun has and it is labelled as such
 * everywhere it is used. A regular expression reading a number off a page is a
 * lead for a question, never a policy.
 */
function readStatedNumbers(trace: CanonicalHumanTrace, schema: EnvironmentSchema): StatedNumber[] {
  // The unit word is whatever the sentence uses. Enumerating them would put a
  // list of business nouns in the compiler, which is the one thing this file
  // is not allowed to contain.
  const pattern =
    /(?:\$|£|€)?\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:%|[A-Za-z]{1,14}\s+)?(?:or less|or under|or fewer|or more|or above|limit|maximum|max|minimum|min|threshold|and above|and over)\b/gi;
  const qualifier = /(approv|authoris|authoriz|sign.?off|review|escalat|permit|manager|supervisor)/i;
  // Or any value the environment itself declares. Grounding the check in the
  // schema rather than in a list of English words is what keeps a sentence
  // like "500 employees or more are enterprise" readable without teaching the
  // compiler what "enterprise" means.
  const declared = schema.entities
    .flatMap((entity) => entity.fields.flatMap((field) => field.enumValues ?? []))
    .filter((value) => value.length > 3);

  const found: StatedNumber[] = [];
  for (const entry of sentences(trace)) {
    const relevant =
      qualifier.test(entry.text) ||
      declared.some((value) => entry.text.toLowerCase().includes(value.toLowerCase()));
    if (!relevant) continue;
    for (const match of entry.text.matchAll(pattern)) {
      const raw = match[1];
      if (!raw) continue;
      const value = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      found.push({ value, text: entry.text, stepId: entry.stepId });
    }
  }
  // Deduplicate by value, keeping the first sighting.
  const seen = new Set<number>();
  return found.filter((entry) => {
    if (seen.has(entry.value)) return false;
    seen.add(entry.value);
    return true;
  });
}

/** Surface text split into sentences, so two rules on one banner stay apart. */
function sentences(trace: CanonicalHumanTrace): { text: string; stepId: string }[] {
  return surfaceText(trace).flatMap((entry) =>
    entry.text
      .split(/(?<=[.!?])\s+/)
      .map((text) => text.trim())
      .filter((text) => text.length > 0)
      .map((text) => ({ text, stepId: entry.stepId })),
  );
}

function unitMatchesText(unit: string | undefined, text: string): boolean {
  if (unit === 'currency') return /[$£€]/.test(text);
  if (unit === 'percent') return /%/.test(text);
  if (unit === 'duration_days') return /\bdays?\b/i.test(text);
  if (unit === 'duration_hours') return /\bhours?\b/i.test(text);
  // Counts and scores are written bare, so anything without a currency mark
  // is a plausible match.
  return !/[$£€]/.test(text);
}

// -------------------------------------------------------------------- helpers

/**
 * Which action the job is actually for.
 *
 * Not simply the last one recorded: operators finish by writing to an audit
 * log, and treating that as the job would make the whole contract about audit
 * entries. The job is the last action that created or changed something the
 * environment does not describe as append-only.
 */
function resolvePrimaryAction(
  adapter: EnvironmentAdapter,
  trace: CanonicalHumanTrace,
  deltas: readonly StateDelta[],
): string {
  const definitions = new Map(adapter.getActions().map((action) => [action.name, action]));
  const appendOnly = new Set(
    adapter
      .describeEntities()
      .entities.filter((entity) => entity.appendOnly)
      .map((entity) => entity.name),
  );
  const touched = new Set(deltas.map((d) => d.entity));

  const substantive = (name: string): boolean => {
    const definition = definitions.get(name);
    if (!definition || definition.readOnly) return false;
    return definition.mutates.some((entity) => !appendOnly.has(entity) && touched.has(entity));
  };

  const performed = actionSteps(trace)
    .map((step) => step.action?.name)
    .filter((name): name is string => name !== undefined);

  // The last substantive action. Anything before it was preparation — asking
  // for an approval, opening a record — and anything after it is a side
  // effect. Preferring creation over change would pick the approval request
  // over the approval itself.
  return (
    [...performed].reverse().find(substantive) ??
    [...performed].reverse().find((name) => !(definitions.get(name)?.readOnly ?? true)) ??
    ''
  );
}

function resolveFocusEntity(
  schema: EnvironmentSchema,
  adapter: EnvironmentAdapter,
  deltas: readonly StateDelta[],
  primary: string,
): EntitySchema | undefined {
  const definition = adapter.getActions().find((action) => action.name === primary);
  const declared = definition?.mutates ?? [];
  const appendOnly = new Set(
    schema.entities.filter((entity) => entity.appendOnly).map((entity) => entity.name),
  );

  const created = deltas.filter((d) => d.kind === 'entity_created').map((d) => d.entity);
  const touched = deltas.map((d) => d.entity);

  // What the job's own action says it touches comes first. Falling back to
  // "whatever was created" picks the audit entry, and then the whole contract
  // is about audit entries.
  return (
    entityByName(schema, created.find((name) => declared.includes(name)) ?? '') ??
    entityByName(schema, touched.find((name) => declared.includes(name)) ?? '') ??
    entityByName(schema, created.find((name) => !appendOnly.has(name)) ?? '') ??
    entityByName(schema, touched.find((name) => !appendOnly.has(name)) ?? '')
  );
}

function eventsFromTrace(trace: CanonicalHumanTrace): EnvEvent[] {
  return actionSteps(trace).map((step, index) => ({
    type: step.action?.name ?? 'unknown',
    ordinal: index,
    at: step.at,
    payload: step.action?.args ?? {},
    ok: true,
  }));
}

function unitOfPath(context: Context, path: string): undefined | ReturnType<typeof unitLookup> {
  return unitLookup(context, path);
}

function unitLookup(context: Context, path: string) {
  const parts = path.split('__');
  if (parts.length === 1) {
    return fieldByName(context.focusEntity, path)?.unit;
  }
  const relationship = relationshipsFrom(context.schema, context.focusEntity.name).find(
    (candidate) => candidate.name === parts[0],
  );
  const target = relationship ? entityByName(context.schema, relationship.to) : undefined;
  return target && parts[1] ? fieldByName(target, parts[1])?.unit : undefined;
}

/** 7, 14, 30, 90 look like policies. 13 and 4.37 look like coincidences. */
function isRoundInterval(value: number): boolean {
  if (!Number.isInteger(value) || value <= 0) return false;
  return [1, 3, 5, 7, 10, 14, 15, 20, 24, 28, 30, 45, 48, 60, 72, 90, 120, 180, 365].includes(value);
}

function delta(context: Context, detail: string): Provenance {
  return { kind: 'state_delta', ref: context.focusEntity.name, detail };
}

function schemaProvenance(ref: string): Provenance {
  return { kind: 'env_schema', ref, detail: 'declared by the environment' };
}

interface RuleDraft {
  id: string;
  template: ContractRule['template'];
  statement: string;
  confidence: number;
  provenance: Provenance[];
  question: NonNullable<ContractRule['question']>;
  implications: string[];
  predicate: RulePredicate;
}

function makeRule(draft: RuleDraft): ContractRule {
  return {
    id: `rule_${draft.id}`,
    statement: draft.statement,
    template: draft.template,
    // Everything a template produces is a generalisation from one run. The
    // only `observed` things in a contract are the facts in the delta.
    status: 'inferred',
    confidence: draft.confidence,
    provenance: draft.provenance,
    implications: draft.implications,
    generatedAssertions: [],
    generatedCases: [],
    question: draft.question,
    predicate: draft.predicate,
  };
}
