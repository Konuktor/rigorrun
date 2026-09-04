/**
 * The base every in-process environment is built on.
 *
 * `defineEnvironment` takes a schema, a list of actions and some fixtures, and
 * returns a complete adapter. Writing a new environment is then a schema plus
 * one handler per mutating action — around 150 lines — with no RigorRun
 * internals to learn.
 *
 * The base class enforces **referential integrity and nothing else**. Required
 * parameters must be present, types must match, and an `entityRef` argument
 * must name a row that exists. Whether the action is *allowed* by business
 * policy is never checked here: an environment that refuses the violation
 * under test makes every agent pass, and the benchmark measures nothing.
 */
import type {
  ActionDefinition,
  ActionParam,
  CaseConfig,
  CaseConfigVariable,
  EnvironmentSchema,
} from './schema.ts';
import { validateSchema } from './schema.ts';
import type {
  ActionResult,
  EnvironmentAdapter,
  EnvironmentFixture,
  PresentationHints,
} from './adapter.ts';
import type { EnvironmentRegistration } from './registry.ts';
import {
  cloneState,
  emptyState,
  rowById,
  type CanonicalState,
  type EntityRow,
  type EnvEvent,
  type StateSnapshot,
} from './state.ts';

export interface ActionContext {
  state: CanonicalState;
  config: CaseConfig;
  /** Logical clock. Two runs of the same case produce identical timestamps. */
  now(): number;
  /** Deterministic identifier, e.g. `nextId('REF')` → `REF-9001`, `REF-9002`. */
  nextId(prefix: string): string;
  emit(type: string, payload: Record<string, unknown>): void;
  row(entityName: string, id: unknown): EntityRow | undefined;
  insert(entityName: string, row: EntityRow): EntityRow;
  update(entityName: string, id: unknown, patch: EntityRow): EntityRow | undefined;
}

export interface ActionSpec extends ActionDefinition {
  handle(args: Record<string, unknown>, context: ActionContext): ActionResult;
}

export interface EnvironmentDefinition {
  id: string;
  name: string;
  description: string;
  schema: EnvironmentSchema;
  actions: ActionSpec[];
  caseConfig?: CaseConfigVariable[];
  presentation: PresentationHints;
  fixtures: EnvironmentFixture[];
}

const ID_BASE = 9000;

export class InMemoryEnvironment implements EnvironmentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  private readonly definition: EnvironmentDefinition;
  private state: CanonicalState;
  private events: EnvEvent[] = [];
  private config: CaseConfig = {};
  private clock = 0;
  private counters = new Map<string, number>();

  constructor(definition: EnvironmentDefinition) {
    this.definition = definition;
    this.id = definition.id;
    this.name = definition.name;
    this.description = definition.description;
    this.state = emptyState(definition.schema);
  }

  describeEntities(): EnvironmentSchema {
    return this.definition.schema;
  }

  getActions(): ActionDefinition[] {
    return this.definition.actions.map(({ handle: _handle, ...rest }) => rest);
  }

  describeCaseConfig(): CaseConfigVariable[] {
    return this.definition.caseConfig ?? [];
  }

  describePresentation(): PresentationHints {
    return this.definition.presentation;
  }

  reset(): void {
    this.state = emptyState(this.definition.schema);
    this.events = [];
    this.config = defaultConfig(this.describeCaseConfig());
    this.clock = 0;
    this.counters = new Map();
  }

  seed(state: CanonicalState, config: CaseConfig = {}): void {
    this.reset();
    this.state = cloneState(state);
    // Make sure every declared table exists even when the fixture omits it.
    for (const entity of this.definition.schema.entities) {
      this.state.entities[entity.name] ??= {};
    }
    this.config = { ...this.config, ...config };
  }

  getState(): CanonicalState {
    return cloneState(this.state);
  }

  getEvents(): EnvEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  snapshot(): StateSnapshot {
    return {
      state: cloneState(this.state),
      events: this.events.map((event) => ({ ...event })),
      config: { ...this.config },
      clock: this.clock,
    };
  }

  restore(snapshot: StateSnapshot): void {
    this.state = cloneState(snapshot.state);
    this.events = snapshot.events.map((event) => ({ ...event }));
    this.config = { ...snapshot.config };
    this.clock = snapshot.clock;
    // Counters are derived from the clock so a restore cannot reissue an id
    // that a discarded branch already handed out.
    this.counters = new Map();
  }

  executeAction(name: string, args: Record<string, unknown> = {}): ActionResult {
    const spec = this.definition.actions.find((action) => action.name === name);
    if (!spec) {
      return fail('UNKNOWN_ACTION', `No action named "${name}" in environment ${this.id}.`);
    }

    const invalid = this.validateArgs(spec.params, args);
    if (invalid) return invalid;

    const context = this.makeContext();
    let result: ActionResult;
    try {
      result = spec.handle(args, context);
    } catch (error) {
      result = fail('ACTION_FAILED', (error as Error).message);
    }

    if (!result.ok && this.events.length > 0) {
      const last = this.events[this.events.length - 1];
      if (last && last.type === name) last.ok = false;
    }
    return result;
  }

  /**
   * Referential integrity only.
   *
   * Missing required parameters, wrong types and dangling entity references
   * are refused because they are nonsense, not because they are against the
   * rules. Everything that is merely *against the rules* is allowed through so
   * the verifier has something to catch.
   */
  private validateArgs(
    params: readonly ActionParam[],
    args: Record<string, unknown>,
  ): ActionResult | null {
    for (const param of params) {
      const value = args[param.name];
      if (value === undefined || value === null) {
        if (param.required) {
          return fail('MISSING_PARAM', `Parameter "${param.name}" is required.`);
        }
        continue;
      }

      if (param.type === 'number' && typeof value !== 'number') {
        return fail('BAD_PARAM_TYPE', `Parameter "${param.name}" must be a number.`);
      }
      if (param.type === 'boolean' && typeof value !== 'boolean') {
        return fail('BAD_PARAM_TYPE', `Parameter "${param.name}" must be a boolean.`);
      }
      if ((param.type === 'string' || param.type === 'timestamp') && typeof value !== 'string') {
        return fail('BAD_PARAM_TYPE', `Parameter "${param.name}" must be a string.`);
      }
      if (param.type === 'enum' && !(param.enumValues ?? []).includes(String(value))) {
        return fail(
          'BAD_PARAM_VALUE',
          `Parameter "${param.name}" must be one of ${(param.enumValues ?? []).join(', ')}.`,
        );
      }
      if (param.entityRef !== undefined && rowById(this.state, param.entityRef, value) === undefined) {
        return fail('NOT_FOUND', `No ${param.entityRef} with id "${String(value)}".`);
      }
    }
    return null;
  }

  private makeContext(): ActionContext {
    // Arrow properties throughout, so `this` stays the environment and the
    // context object cannot accidentally capture itself.
    return {
      state: this.state,
      config: this.config,
      now: () => (this.clock += 1),
      nextId: (prefix: string) => {
        const next = (this.counters.get(prefix) ?? ID_BASE) + 1;
        this.counters.set(prefix, next);
        return `${prefix}-${next}`;
      },
      emit: (type, payload) => {
        this.events.push({
          type,
          ordinal: this.events.length,
          at: (this.clock += 1),
          payload,
          ok: true,
        });
      },
      row: (entityName, id) => rowById(this.state, entityName, id),
      insert: (entityName, row) => {
        const entity = this.definition.schema.entities.find((e) => e.name === entityName);
        if (!entity) throw new Error(`Unknown entity "${entityName}".`);
        const id = row[entity.idField];
        if (id === undefined || id === null) {
          throw new Error(`Cannot insert into ${entityName} without "${entity.idField}".`);
        }
        const table = (this.state.entities[entityName] ??= {});
        table[String(id)] = { ...row };
        return table[String(id)] as EntityRow;
      },
      update: (entityName, id, patch) => {
        const existing = rowById(this.state, entityName, id);
        if (!existing) return undefined;
        const merged = { ...existing, ...patch };
        const table = (this.state.entities[entityName] ??= {});
        table[String(id)] = merged;
        return merged;
      },
    };
  }
}

function defaultConfig(variables: readonly CaseConfigVariable[]): CaseConfig {
  const config: CaseConfig = {};
  for (const variable of variables) config[variable.name] = variable.default;
  return config;
}

function fail(code: string, message: string): ActionResult {
  return { ok: false, error: { code, message } };
}

/**
 * Turns a definition into a registration the runner can resolve by id.
 *
 * The schema is validated eagerly: a mis-annotated role corrupts thresholds,
 * boundaries and the projection all at once, and it does so silently, so it
 * must not be possible to ship one.
 */
export function defineEnvironment(definition: EnvironmentDefinition): EnvironmentRegistration {
  const problems = validateSchema(definition.schema);
  if (problems.length > 0) {
    const detail = problems.map((p) => `  ${p.path}: ${p.message}`).join('\n');
    throw new Error(`Environment "${definition.id}" has an invalid schema:\n${detail}`);
  }
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    create: () => new InMemoryEnvironment(definition),
    fixtures: definition.fixtures,
  };
}
