/**
 * Somebody else's system, as an environment RigorRun can grade against.
 *
 * This started as the MCP adapter and turned out never to have been one. It
 * uses exactly two things from a connection — what operations exist, and how to
 * call one — so an OpenAPI document, a custom adapter and an MCP server all
 * arrive here as the same object. There is one adapter and several ways to
 * reach a system, rather than an adapter per protocol, which is what keeps the
 * compiler, the generator and the verifier from ever learning where a system
 * came from.
 *
 * The three interesting methods are the ones that cannot be implemented
 * honestly, and what is done about each.
 *
 * `seed()` installs a whole world. No real system offers that, so this does
 * nothing at all — and says so by declaring `seed: 'none'`, which is what stops
 * the runner from believing a case started somewhere it did not. The world
 * instead comes from `reset()`, which is a weaker guarantee and a sufficient
 * one: if resetting always produces the same starting position, cases are still
 * isolated and still reproducible. They simply cannot be *arbitrary*.
 *
 * `getState()` asks for every row a system holds. Nothing offers that either.
 * What this returns is whatever the nominated reads came back with — only the
 * verifier's, once one is nominated — genuinely partial, declared as
 * `designated-reads`, and labelled PARTIAL on every verdict built from it. A
 * record no read returns is absent, and absent reads as nonexistent: RigorRun
 * cannot tell a record nobody nominated a read for from one that is not there,
 * so what the reads cover is what a verdict can speak about.
 *
 * `restore()` expects time travel. It resets. That is sound *only* because
 * seeding is impossible here: the one world anybody could want back is the one
 * reset produces, so restoring to it is not an approximation of anything. If
 * seeding ever became possible, this would have to be reconsidered rather than
 * left to quietly mean the wrong thing.
 */
import {
  StateReadError,
  type ActionDefinition,
  type CanonicalState,
  type CaseConfig,
  type CaseConfigVariable,
  type EnvEvent,
  type EnvironmentAdapter,
  type EnvironmentCapabilities,
  type EnvironmentSchema,
  type PresentationHints,
  type StateSnapshot,
} from '@rigorrun/environment';
import type { SystemConnection } from './types.ts';
import type { SystemEnvironmentConfig } from './environmentConfig.ts';
import { hasPayload, normalizeCallResult } from './result.ts';
import { isVerifierTool, readsForVerdict } from './verified.ts';
import { IdentityConflictError, stateFromPayloads } from './rows.ts';

export class SystemEnvironment implements EnvironmentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  private events: EnvEvent[] = [];
  private clock = 0;

  constructor(
    private readonly connection: SystemConnection,
    private readonly schema: EnvironmentSchema,
    private readonly config: SystemEnvironmentConfig,
  ) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
  }

  capabilities(): EnvironmentCapabilities {
    return {
      // The schema was worked out from what came back, not declared.
      discovery: 'tools-only',
      // Two ways to end up with nothing to read: nobody nominated a read, or
      // this connector cannot answer one — a browser, unless it has been given
      // a verifier. Either way the verdict says OBSERVATIONAL and says why.
      stateRead:
        this.config.verifierReads.length > 0 && this.connection.canReadState !== false
          ? 'designated-reads'
          : 'none',
      // A real system does not let you install a world.
      seed: 'none',
      // Independent only when every nominated read goes through a connection
      // the agent never touches. The label follows what was nominated: once a
      // verifier read is nominated the world is read through it alone (see
      // readsForVerdict), but a project that also nominates the system's own
      // reads has asked for them, and is labelled for what it asked for.
      stateReadIndependence:
        this.config.verifierReads.length > 0 &&
        this.config.verifierReads.every((read) => isVerifierTool(read.tool))
          ? 'independent'
          : 'self-reported',
      reset: this.config.reset.kind === 'tool' ? 'tool' : 'none',
      // Every call goes through this adapter, so the log is ours rather than
      // the system's own audit trail. Weaker evidence, honestly labelled.
      events: 'proxy-log',
      safety: this.config.safety,
    };
  }

  describeEntities(): EnvironmentSchema {
    return this.schema;
  }

  getActions(): ActionDefinition[] {
    const readOnly = new Set(this.config.readOnlyTools);
    return this.connection.discovery.tools
      // A verifier's tools are how the result is checked, never something to do.
      .filter((tool) => !isVerifierTool(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        params: tool.params.map((param) => {
          // Which record an argument names is worth knowing: it is what lets
          // RigorRun check the request is even coherent before any rule runs,
          // and what lets it build a case out of a different record.
          //
          // The match is between the server's own argument name and the
          // server's own identifier field — both sides come from the same
          // system, so this is not RigorRun bringing a vocabulary, it is
          // RigorRun noticing that a system is consistent with itself.
          // Only a record named by that one field: a report row named by
          // several dimensions has no single value an argument could carry.
          const entity = this.schema.entities.find(
            (candidate) =>
              candidate.idField === param.name &&
              candidate.keyFields === undefined &&
              candidate.identity === undefined,
          );
          return entity ? { ...param, entityRef: entity.name } : param;
        }),
        // Which records a tool touches is not discoverable from a schema. Left
        // empty rather than guessed; the compiler reads the state delta.
        mutates: [] as readonly string[],
        // A person's decision, never the server's hint. A tool nobody has
        // vouched for counts as writing, so it is gated accordingly.
        readOnly: readOnly.has(tool.name),
        // Whether this system refuses policy violations is a claim that gets
        // tested by trying one, not taken on trust. `none` is the assumption
        // that produces a benchmark worth running.
        enforcement: 'none' as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  describeCaseConfig(): CaseConfigVariable[] {
    // Nothing about a third-party system is under RigorRun's control, so there
    // are no environment variables to vary. Cases differ by what is asked.
    return [];
  }

  describePresentation(): PresentationHints {
    const [first] = this.schema.entities;
    return {
      label: this.name,
      tagline: this.description,
      accent: '#4b5563',
      mark: this.name.slice(0, 1).toUpperCase() || 'M',
      navEntities: this.schema.entities.map((entity) => entity.name),
      focusEntity: first?.name ?? 'Record',
    };
  }

  async reset(): Promise<void> {
    const strategy = this.config.reset;
    this.events = [];
    this.clock = 0;
    if (strategy.kind !== 'tool') return;
    const result = await this.connection.call(strategy.tool, strategy.args ?? {}, this.config.toolCallMs);
    if (!result.ok) {
      throw new Error(
        `Reset failed: ${strategy.tool} returned ${result.error?.message ?? 'an error'}. ` +
          'Cases cannot be isolated until this works.',
      );
    }
  }

  /** Deliberately nothing. See the note at the top of this file. */
  seed(_state: CanonicalState, _config?: CaseConfig): void {
    return undefined;
  }

  /**
   * The world, as far as the reads a verdict uses can see it.
   *
   * Once a verifier read is nominated, those are the verifier's alone, and the
   * system's own reads are not called (requalification P10; see readsForVerdict).
   *
   * A read that fails, or answers in prose, leaves the world unknown and throws
   * StateReadError; an unknown world is never handed back as an empty one.
   *
   * Rows that no used read returns are absent, and the verifier treats absent
   * as nonexistent: a `state_exists` check on them fails, and a record present
   * at the start but absent now reads as deleted. A read that answers empty and
   * a record type no read covers look the same from here, which is why what the
   * reads cover is a decision for the person nominating them.
   */
  async getState(): Promise<CanonicalState> {
    const payloads: unknown[] = [];
    const answeredBy: string[] = [];
    for (const read of readsForVerdict(this.config.verifierReads).used) {
      const normalized = normalizeCallResult(
        await this.connection.call(read.tool, read.args ?? {}, this.config.toolCallMs),
      );
      // A read that fails leaves the world unknown, and unknown is not empty:
      // said so, rather than handed back as a world in which everything has
      // vanished.
      if (normalized.kind === 'error') {
        throw new StateReadError(read.tool, normalized.error?.message ?? 'the call failed');
      }
      // Prose where records were nominated is not an empty world either. The
      // read answered and said nothing RigorRun can compare, so the world is
      // unknown for this case and the verdict abstains. Treating it as empty
      // would make every record look deleted and fail a correct agent.
      if (normalized.kind === 'text') {
        throw new StateReadError(read.tool, 'it answered with text rather than records');
      }
      if (hasPayload(normalized)) {
        payloads.push(normalized.payload);
        answeredBy.push(read.tool);
      }
    }
    try {
      return stateFromPayloads(payloads, this.schema);
    } catch (error) {
      // Two different records under one identity: keeping either would invent
      // a world, so the world is unknown for this case.
      if (error instanceof IdentityConflictError) {
        throw new StateReadError(answeredBy[error.payloadIndex] ?? 'a nominated read', error.message);
      }
      throw error;
    }
  }

  getEvents(): EnvEvent[] {
    return [...this.events];
  }

  async executeAction(name: string, args: Record<string, unknown>) {
    if (isVerifierTool(name)) {
      return {
        ok: false,
        error: {
          code: 'NOT_AN_ACTION',
          message: `${name} is how RigorRun checks the result; it is not something an agent can call.`,
        },
      };
    }
    const result = await this.connection.call(name, args, this.config.toolCallMs);
    this.clock += 1;
    this.events.push({
      type: name,
      ordinal: this.events.length,
      at: this.clock,
      payload: args,
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error?.message ?? 'the call failed' }),
    });
    // The agent is handed the system's own answer, unrewritten: what it sees
    // is the server, not RigorRun's reading of the server. Only state reads
    // go through the normaliser.
    return result.ok
      ? { ok: true, data: result.structured ?? result.content }
      : {
          ok: false,
          error: {
            code: result.error?.code ?? 'CALL_FAILED',
            message: result.error?.message ?? 'the call failed',
          },
        };
  }

  async snapshot(): Promise<StateSnapshot> {
    return {
      state: await this.getState(),
      events: this.getEvents(),
      config: {},
      clock: this.clock,
    };
  }

  /** Resets. Sound only because seeding is impossible; see the file header. */
  async restore(_snapshot: StateSnapshot): Promise<void> {
    await this.reset();
  }
}
