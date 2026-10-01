/**
 * Packs: systems RigorRun ships its own client for.
 *
 * Every other environment is either RigorRun's own (an in-process fake) or is
 * reached through a protocol the system publishes, and both shapes assume the
 * world can be put back between cases. A hosted API offers no such thing, and
 * the honest answer the connector model has for that is to clamp repeats to one
 * and abstain on any read that cannot follow a case's own records.
 *
 * A pack replaces putting back with making new. Before each case, and before
 * each attempt at it, the pack creates fresh records from the case's recipe and
 * reports the identifiers they were given. The case's text and checks are bound
 * to those identifiers, and every read is scoped to what this case created, so
 * nothing an earlier case did is visible and nothing needs undoing.
 *
 * The work splits three ways:
 *
 *  - `PackDefinition` is the pack as shipped: its schema, how to open a
 *    session, and optionally its own suite and command line.
 *  - `PackSession` is one open connection to one system, shared by every case
 *    of a run. It owns the client and the credential, and does the creating
 *    and the reading.
 *  - `PackEnvironment` is the adapter the runner sees, built fresh per case. It
 *    holds this case's scope and bindings and nothing else, and it never closes
 *    the session: whoever opened the session closes it.
 *
 * Nothing in this file knows what business a pack is for. A pack's nouns live
 * in the pack's own package, which is where the domain gate expects them.
 */
import type { Benchmark, EnvironmentContract } from '@rigorrun/core';
import type {
  ActionResult,
  EnvironmentAdapter,
  MaterializedCase,
  PresentationHints,
  Reality,
} from './adapter.ts';
import { mayMutateAtAll, type EnvironmentCapabilities, type SafetyMode } from './capabilities.ts';
import {
  validateSchema,
  type ActionDefinition,
  type CaseConfig,
  type CaseConfigVariable,
  type EnvironmentSchema,
} from './schema.ts';
import type { CanonicalState, EnvEvent, StateSnapshot } from './state.ts';

// ------------------------------------------------------------------- contract

/**
 * Binding name to the identifier the named record was actually given.
 *
 * Strings only. A binding is substituted into text and into check paths, and
 * a number arriving as a number would compare differently in each.
 */
export type PackBindings = Readonly<Record<string, string>>;

/**
 * Which case, and which attempt at it, records are being made for.
 *
 * A pack writes this onto everything it creates, so a person looking at the
 * system afterwards can tell which run made what, and so two attempts can never
 * be mistaken for one another.
 */
export interface PackCaseContext {
  runId: string;
  caseId: string;
  agentId: string;
  /** Zero for the first attempt. Every attempt gets records of its own. */
  attempt: number;
}

/**
 * What one case's reads cover.
 *
 * `description` is a sentence shown on every verdict built from these reads,
 * because "the system" means less here than it does for an in-process fake and
 * a reader is owed the difference. `data` is the pack's own note of what to
 * read — identifiers, a time window — and nothing outside the pack looks in it.
 */
export interface PackScope {
  description: string;
  data: unknown;
}

/** What creating one case's records produced. */
export interface PackMaterialization {
  bindings: PackBindings;
  scope: PackScope;
}

/**
 * One open connection to one system.
 *
 * Shared by every case of a run, so it must hold nothing about any one case:
 * that belongs to the `PackEnvironment` built for the case.
 */
export interface PackSession {
  /** The system's name as a person would say it; the heading over what it shows. */
  readonly system: string;
  readonly safety: SafetyMode;
  /** True when the other end is the pack's local twin rather than the real system. */
  readonly simulated: boolean;

  /**
   * Creates one case's records from its recipe, and names them.
   *
   * Called once per case and once per attempt. The recipe is the pack's own
   * format and is validated here; a recipe that does not parse, or a system
   * that refuses to create something, is a throw, never a partial world.
   * Every name a case refers to must come back bound.
   */
  materialize(recipe: unknown, ctx: PackCaseContext): Promise<PackMaterialization>;

  /**
   * Everything the scope covers, read completely.
   *
   * A list the pack could only read one page of is named in `windowed` rather
   * than passed off as the whole of it. A read that fails throws
   * `StateReadError`: an unknown world is never handed back as an empty one.
   * `null` is the scope before anything was materialized, and is answered with
   * a world that holds nothing.
   */
  read(scope: PackScope | null): Promise<CanonicalState>;

  /**
   * The system's own account of how the case ended, one sentence per line,
   * for showing beside what the agent said it did. Never scored.
   */
  reality?(seed: CanonicalState, final: CanonicalState, bindings: PackBindings): string[];

  /** The operations offered to an agent RigorRun drives. Empty is allowed. */
  actions(): ActionDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<ActionResult>;

  close(): Promise<void>;
}

/** Whether a pack talks to its own local twin or to the real system. */
export type PackMode = 'twin' | 'live';

/**
 * How a project reaches a pack's system, as the project stores it.
 *
 * Credential *names* only. The value is fetched through `secret()` when the
 * session opens, so a project file never carries one.
 */
export interface PackConnectionConfig {
  mode: PackMode;
  /** Where the system answers. Absent means the pack's own default for the mode. */
  baseUrl?: string | undefined;
  /** The secret holding the credential. Absent means the pack's own default name. */
  keySecret?: string | undefined;
  /** Settings only this pack understands. The pack validates them. */
  options?: unknown;
}

export interface PackOpenOptions extends PackConnectionConfig {
  /** A credential from this machine's store, or `undefined` when it is not there. */
  secret(name: string): string | undefined;
}

/** A suite a pack writes itself, rather than one compiled from a demonstration. */
export interface PackSuite {
  contract: EnvironmentContract;
  benchmark: Benchmark;
}

export interface PackDefinition {
  /** Stable id a project names the pack by. */
  id: string;
  name: string;
  description: string;
  schema: EnvironmentSchema;
  presentation?: PresentationHints;

  /** Opens a session. Checks the credential before anything is created. */
  open(options: PackOpenOptions): Promise<PackSession>;

  /**
   * What opening this connection would do, in one line, for the confirmation
   * shown before somebody trusts a project: the address that will be called,
   * and with which credential.
   */
  describeAction(config: PackConnectionConfig): string;

  /** The pack's own suite, built from answers the pack asked for. */
  suite?(params: unknown): PackSuite;

  /** The pack's own commands. Resolves to the process exit code. */
  cli?(argv: string[]): Promise<number>;
}

// ------------------------------------------------------------------- registry

const packs = new Map<string, PackDefinition>();

/**
 * Makes a pack available by id.
 *
 * The schema is checked here, as `defineEnvironment` checks one: a
 * mis-annotated role corrupts thresholds, boundaries and the projection all at
 * once, and silently, so it must not be possible to register one.
 */
export function registerPack(pack: PackDefinition): void {
  const problems = validateSchema(pack.schema);
  if (problems.length > 0) {
    const detail = problems.map((p) => `  ${p.path}: ${p.message}`).join('\n');
    throw new Error(`Pack "${pack.id}" has an invalid schema:\n${detail}`);
  }
  packs.set(pack.id, pack);
}

export function getPack(id: string): PackDefinition {
  const found = packs.get(id);
  if (!found) {
    const known = [...packs.keys()].sort().join(', ') || 'none registered';
    throw new Error(`Unknown pack "${id}". Registered packs: ${known}.`);
  }
  return found;
}

export function hasPack(id: string): boolean {
  return packs.has(id);
}

export function listPacks(): PackDefinition[] {
  return [...packs.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Test helper. Never called by product code. */
export function clearPacks(): void {
  packs.clear();
}

// ---------------------------------------------------------------- the adapter

/**
 * A pack session, as the runner sees it for one case.
 *
 * Build one per case, over the session the run shares. Everything that belongs
 * to the case — its scope, its bindings, the calls made through it — lives
 * here, so a case can never inherit another's.
 */
export class PackEnvironment implements EnvironmentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  private scope: PackScope | null = null;
  private bindings: PackBindings = {};
  private events: EnvEvent[] = [];
  private clock = 0;

  constructor(
    private readonly pack: PackDefinition,
    private readonly session: PackSession,
  ) {
    this.id = pack.id;
    this.name = pack.name;
    this.description = pack.description;
  }

  capabilities(): EnvironmentCapabilities {
    return {
      // The pack ships its schema; nothing had to be induced.
      discovery: 'declared-schema',
      // Only what this case created, and what hangs off it. Partial by design,
      // and said so on every verdict through the scope's description.
      stateRead: 'designated-reads',
      // The pack reads with RigorRun's own client and credential. An agent
      // under test never sits between those reads and the system.
      stateReadIndependence: 'independent',
      seed: 'materialized',
      reset: 'namespace',
      // Calls made through `executeAction` are logged here. An agent that
      // reaches the system on its own leaves no entries, and is judged on
      // state alone.
      events: 'proxy-log',
      safety: this.session.safety,
      simulated: this.session.simulated,
    };
  }

  describeEntities(): EnvironmentSchema {
    return this.pack.schema;
  }

  getActions(): ActionDefinition[] {
    return this.session.actions();
  }

  describeCaseConfig(): CaseConfigVariable[] {
    // A case varies by what it creates and what it asks, not by a switch the
    // environment holds.
    return [];
  }

  describePresentation(): PresentationHints {
    if (this.pack.presentation) return this.pack.presentation;
    const [first] = this.pack.schema.entities;
    return {
      label: this.pack.name,
      tagline: this.pack.description,
      accent: '#4b5563',
      mark: this.pack.name.slice(0, 1).toUpperCase() || 'P',
      navEntities: this.pack.schema.entities.map((entity) => entity.name),
      focusEntity: first?.name ?? 'Record',
    };
  }

  /**
   * Forgets the previous case's scope. Nothing in the system is touched: what
   * the last case created stays there, outside the next case's view.
   */
  reset(): void {
    this.scope = null;
    this.bindings = {};
    this.events = [];
    this.clock = 0;
  }

  /**
   * Refuses. A pack cannot install a world, and pretending to — accepting the
   * state and doing nothing — would let a caller believe a case started where
   * it did not. `materialize()` is what takes this method's place.
   */
  seed(_state: CanonicalState, _config?: CaseConfig): void {
    throw new Error(
      `${this.name} cannot install a starting world. Its cases create their own records, ` +
        'through materialize(), which runs in place of seed().',
    );
  }

  async materialize(seed: { recipe?: unknown }, ctx: PackCaseContext): Promise<MaterializedCase> {
    // Creating records is a write RigorRun makes on its own behalf, before any
    // agent is present to answer for it.
    if (!mayMutateAtAll(this.capabilities())) {
      throw new Error(
        `${this.session.system} is marked production, and every case creates records in it. ` +
          'Point the project at a test or scratch account.',
      );
    }
    if (seed.recipe === undefined) {
      throw new Error(
        `Case ${ctx.caseId} carries no recipe, so there is nothing to create for it.`,
      );
    }
    const made = await this.session.materialize(seed.recipe, ctx);
    this.scope = made.scope;
    this.bindings = made.bindings;
    return { bindings: made.bindings, readScope: made.scope.description };
  }

  getState(): Promise<CanonicalState> {
    return this.session.read(this.scope);
  }

  getEvents(): EnvEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  async executeAction(name: string, args: Record<string, unknown>): Promise<ActionResult> {
    const result = await this.session.execute(name, args);
    this.clock += 1;
    this.events.push({
      type: name,
      ordinal: this.events.length,
      at: this.clock,
      payload: args,
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error?.message ?? 'the call failed' }),
    });
    return result;
  }

  async snapshot(): Promise<StateSnapshot> {
    return {
      state: await this.getState(),
      events: this.getEvents(),
      config: {},
      clock: this.clock,
    };
  }

  /**
   * Refuses. Nothing can be taken back out of the system, and forgetting the
   * scope instead would answer every later read with an empty world that looks
   * like a restored one.
   */
  restore(_snapshot: StateSnapshot): void {
    throw new Error(
      `${this.name} cannot go back to an earlier state. Each case creates fresh records ` +
        'instead, so there is never anything to restore.',
    );
  }

  describeReality(seed: CanonicalState, final: CanonicalState): Reality | undefined {
    const lines = this.session.reality?.(seed, final, this.bindings);
    return lines === undefined ? undefined : { system: this.session.system, lines };
  }
}
