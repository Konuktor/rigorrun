/**
 * The live half of a project: connections, and a demonstration in progress.
 *
 * A project on disk is inert. Working on one means holding an open connection
 * to somebody's system and, while a person is showing RigorRun the job, a
 * running record of what they touched. Both are process-local by definition —
 * a stdio connection is a child process, and a half-finished demonstration is
 * not something to persist and resume — so they live here rather than in the
 * store, and they end when the runner does.
 *
 * Everything in this file is deliberately reachable from both the CLI and the
 * HTTP API, because the alternative is two implementations of the same flow
 * that drift, and the one people use is always the one with the bug.
 */
import {
  McpConnection,
  applySchemaAnswers,
  assertSafeCommand,
  induceSchema,
  type InducedSchema,
  type McpConfig,
  type PayloadObservation,
  type SchemaAnswer,
} from '@rigorrun/mcp';
import {
  SystemEnvironment,
  detectMismatch,
  stateFromPayloads,
  type AnnotationMismatch,
  type SystemConnection,
  type SystemEnvironmentConfig,
} from '@rigorrun/connector';
import { OpenApiConnection } from '@rigorrun/env-openapi';
import type { ActionLogEntry } from '@rigorrun/core';
import type { CanonicalState, EnvironmentSchema } from '@rigorrun/environment';
import { basename } from 'node:path';
import { describeConnectorAction, type Project } from './project.ts';
import { forgetChild, noteChild } from './orphans.ts';
import type { ProjectStore } from './store.ts';

/**
 * A demonstration somebody is in the middle of giving.
 *
 * The before-state is kept as raw payloads rather than a `CanonicalState`,
 * because at the moment it is captured there is no schema to map it onto —
 * working out what the records are is what this recording is *for*. The state
 * is built at the end, once induction has produced something to map onto, from
 * exactly the same bytes.
 */
export interface Demonstration {
  startedAt: number;
  beforePayloads: unknown[];
  entries: ActionLogEntry[];
  observations: PayloadObservation[];
}

/** A recording as it survives a reload. The same fields, on disk. */
interface SavedDemonstration {
  startedAt: number;
  beforePayloads: unknown[];
  entries: ActionLogEntry[];
  observations: PayloadObservation[];
}

export interface LiveProject {
  connection: SystemConnection;
  induced: InducedSchema | undefined;
  demonstration: Demonstration | undefined;
  /** Claims this system made that its own behaviour contradicted. */
  mismatches: AnnotationMismatch[];
}

export class Workspace {
  private readonly live = new Map<string, LiveProject>();

  constructor(private readonly store: ProjectStore) {}

  /**
   * Turns a project's saved connector into a config, with the credentials
   * fetched from the secret store at the last possible moment.
   *
   * Late binding on purpose: a connector can be read, logged and shown without
   * a secret ever being in the object, and the only code holding one is the
   * code about to open a socket with it.
   */
  /** The credentials a connector needs, fetched at the last possible moment. */
  private async secretsFor(project: Project): Promise<Record<string, string>> {
    const connector = project.connector;
    if (!connector) throw new Error(`${project.name} has no system connected yet.`);

    const secrets: Record<string, string> = {};
    const missing: string[] = [];
    for (const name of connector.secretNames) {
      const value = await this.store.secret(name);
      if (value === undefined) missing.push(name);
      else secrets[name] = value;
    }
    if (missing.length > 0) {
      throw new Error(
        `This project needs ${missing.join(', ')}, which this machine does not have. ` +
          `Set them with \`rigorrun secrets set <name>\`.`,
      );
    }
    return secrets;
  }

  async configFor(project: Project): Promise<McpConfig> {
    const connector = project.connector;
    if (connector?.kind !== 'mcp') {
      throw new Error(`${project.name} is not connected over MCP.`);
    }
    const secrets = await this.secretsFor(project);

    if (connector.transport === 'stdio') {
      const config: McpConfig = {
        transport: 'stdio',
        command: connector.command,
        args: connector.args,
        env: secrets,
      };
      assertSafeCommand(config);
      return config;
    }
    return {
      transport: 'http',
      url: connector.url,
      ...(Object.keys(secrets).length > 0 ? { headers: secrets } : {}),
    };
  }

  /**
   * Opens whichever kind of connector this project has.
   *
   * The only place in the daemon that knows there is more than one kind. Every
   * caller downstream is handed a `SystemConnection` and never asks what is
   * behind it, which is what stops a second connector becoming a second engine.
   */
  private async openConnection(project: Project): Promise<SystemConnection> {
    const connector = project.connector;
    if (!connector) throw new Error(`${project.name} has no system connected yet.`);

    if (connector.kind === 'openapi') {
      const secrets = await this.secretsFor(project);
      return OpenApiConnection.open({
        spec: connector.spec,
        baseUrl: connector.baseUrl,
        // The project stores a header name against a *secret* name; the value
        // is substituted here and nowhere earlier.
        headers: Object.fromEntries(
          Object.entries(connector.headers)
            .map(([header, secret]) => [header, secrets[secret]])
            .filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      });
    }
    return McpConnection.open(await this.configFor(project));
  }

  async connect(project: Project): Promise<SystemConnection> {
    const existing = this.live.get(project.id);
    if (existing) return existing.connection;
    assertConnectorTrusted(project);
    const connection = await this.openConnection(project);
    this.live.set(project.id, {
      connection,
      induced: undefined,
      demonstration: undefined,
      mismatches: [],
    });
    // Written down so that if this runner is killed outright, the next one can
    // find the server it left running and end it. See `orphans.ts`.
    if (connection.childPid !== null && project.connector?.kind === 'mcp') {
      // The *arguments*, not the whole command line. A launcher resolves:
      // `node_modules/.bin/tsx` shows up in /proc as
      // `node .../tsx/dist/cli.mjs`, so matching on the executable never
      // matches. The arguments survive verbatim, and they are the part that
      // says which server this is.
      await noteChild(
        this.store.path,
        connection.childPid,
        project.connector.args.join(' ').trim() || basename(project.connector.command),
      ).catch(() => undefined);
    }
    return connection;
  }

  /** What this system claimed about itself that turned out not to hold. */
  mismatchesFor(projectId: string): AnnotationMismatch[] {
    return [...(this.live.get(projectId)?.mismatches ?? [])];
  }

  connectionFor(projectId: string): SystemConnection | undefined {
    return this.live.get(projectId)?.connection;
  }

  async disconnect(projectId: string): Promise<void> {
    const live = this.live.get(projectId);
    if (!live) return;
    this.live.delete(projectId);
    const pid = live.connection.childPid;
    await live.connection.close();
    // Closed properly, so it is no longer something for a later runner to
    // worry about. Leaving stale entries here would mean a future startup
    // checking pids that have long since been recycled.
    if (pid !== null) await forgetChild(this.store.path, pid).catch(() => undefined);
  }

  async close(): Promise<void> {
    for (const id of [...this.live.keys()]) await this.disconnect(id);
  }

  /**
   * The environment adapter for a project, given a schema.
   *
   * Built fresh each time. The runner requires a new adapter per case, and a
   * shared one would let a case inherit the previous one's recorded events.
   */
  environment(project: Project, schema: EnvironmentSchema): SystemEnvironment {
    const connection = this.connectionFor(project.id);
    if (!connection) throw new Error(`${project.name} is not connected.`);
    return new SystemEnvironment(connection, schema, environmentConfig(project));
  }

  /**
   * Lets writes through, because a run is about to happen.
   *
   * Called once when a benchmark starts. Everything before this — connecting,
   * probing, sampling — is RigorRun asking questions of somebody's system, and
   * a question should not change anything.
   */
  allowWrites(projectId: string): void {
    this.live.get(projectId)?.connection.allowWrites?.();
  }

  // ------------------------------------------------------------ demonstrating

  /**
   * Begins watching. Resets first, so the job starts where cases will start.
   *
   * Without the reset a demonstration would begin from whatever the last person
   * left behind, and the state delta — which is the entire evidence for what
   * the job does — would include their changes as well.
   */
  async startDemonstration(project: Project): Promise<void> {
    const live = this.live.get(project.id);
    if (!live) throw new Error(`${project.name} is not connected.`);
    if (project.verifierReads.length === 0) {
      throw new Error(
        'Nominate at least one read before recording. Without one there is no way to see what ' +
          'the job changed, and the contract is derived from exactly that.',
      );
    }

    // The person is about to do the job. Whatever the connector was refusing
    // during setup, they are asking for now.
    live.connection.allowWrites?.();

    await this.environment(project, { entities: [], relationships: [] }).reset();
    const beforePayloads = await this.readPayloads(project);
    live.demonstration = {
      startedAt: Date.now(),
      beforePayloads,
      entries: [],
      observations: beforePayloads.map((payload) => ({ tool: 'before', payload })),
    };
    await this.saveDemonstration(project);
  }

  /** Calls every nominated read and keeps the answers exactly as they came. */
  private async readPayloads(project: Project): Promise<unknown[]> {
    const live = this.live.get(project.id);
    if (!live) throw new Error(`${project.name} is not connected.`);
    const payloads: unknown[] = [];
    for (const read of project.verifierReads) {
      const result = await live.connection.call(read.tool, read.args);
      if (result.ok && result.structured !== undefined) payloads.push(result.structured);
    }
    return payloads;
  }

  /**
   * Restores a recording that was in progress when the page was reloaded.
   *
   * A demonstration is the most expensive thing in the product to redo — it is
   * the part where a person is doing real work in a real system — and it was
   * the one thing held only in a browser tab. It is now written to disk after
   * every step, so a refresh, or a runner restart, costs nothing.
   */
  async resumeDemonstration(project: Project): Promise<boolean> {
    const live = this.live.get(project.id);
    live?.connection.allowWrites?.();
    if (!live || live.demonstration) return live !== undefined && live.demonstration !== undefined;
    const saved = await this.store.readArtefact<SavedDemonstration>(project.id, 'demonstration');
    if (!saved) return false;
    live.demonstration = {
      startedAt: saved.startedAt,
      beforePayloads: saved.beforePayloads,
      entries: saved.entries,
      observations: saved.observations,
    };
    return true;
  }

  private async saveDemonstration(project: Project): Promise<void> {
    const demonstration = this.live.get(project.id)?.demonstration;
    if (!demonstration) return;
    await this.store.writeArtefact(project.id, 'demonstration', demonstration);
  }

  /** One thing the person did, executed for real and written down. */
  async demonstrate(
    project: Project,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const live = this.live.get(project.id);
    if (!live?.demonstration) throw new Error('Nothing is being recorded right now.');

    // What the system looked like before this call, so a claim can be checked
    // against what actually happened. Only read for tools the *system* says are
    // read-only: everything else is expected to change things, so comparing
    // would cost a round trip to learn nothing.
    const claimsReadOnly =
      live.connection.discovery.tools.find((entry) => entry.name === tool)?.hints.readOnly === true;
    const before = claimsReadOnly ? await this.readPayloads(project) : undefined;

    const result = await live.connection.call(tool, args);
    if (result.structured !== undefined) {
      live.demonstration.observations.push({ tool, payload: result.structured });
    }

    if (before !== undefined) {
      const after = await this.readPayloads(project);
      const mismatch = detectMismatch(
        tool,
        { readOnly: true },
        JSON.stringify(after) !== JSON.stringify(before),
      );
      // Recorded rather than acted on. RigorRun already treats every
      // unconfirmed tool as writing, so this changes nothing about what it
      // does — it changes what the person is told, which is the part that
      // matters. A system that claims a tool only reads and then changes state
      // is either wrong about its own implementation or misdescribing itself,
      // and both are worth knowing before trusting a verdict from it.
      if (mismatch && !live.mismatches.some((entry) => entry.tool === mismatch.tool)) {
        live.mismatches.push(mismatch);
      }
    }

    // Reads are watched but not written into the trace. The contract is
    // induced from what *changed*, and a read that changed nothing would
    // become a step the agent is expected to reproduce.
    if (!project.readOnlyTools.includes(tool)) {
      live.demonstration.entries.push({
        at: Date.now() - live.demonstration.startedAt,
        action: tool,
        args,
        ok: result.ok,
      });
    }

    // Written after every step rather than at the end. The end is exactly the
    // moment a person is least likely to reach if something goes wrong.
    await this.saveDemonstration(project);

    return result.ok
      ? { ok: true, data: result.structured ?? result.content }
      : { ok: false, error: result.error?.message ?? 'the call failed' };
  }

  demonstrationOf(projectId: string): Demonstration | undefined {
    return this.live.get(projectId)?.demonstration;
  }

  /** Ends the recording and works out what the records are. */
  async finishDemonstration(
    project: Project,
  ): Promise<{
    before: CanonicalState;
    after: CanonicalState;
    induced: InducedSchema;
    entries: ActionLogEntry[];
    schema: EnvironmentSchema;
  }> {
    const live = this.live.get(project.id);
    if (!live?.demonstration) throw new Error('Nothing is being recorded right now.');

    const afterPayloads = await this.readPayloads(project);
    const observations = [
      ...live.demonstration.observations,
      ...afterPayloads.map((payload) => ({ tool: 'after', payload })),
    ];

    // Induction comes first, then both states are built from the payloads that
    // were already captured. Reading the world twice and inducing from the
    // second read would lose whatever the job destroyed.
    const induced = induceSchema(observations);
    live.induced = induced;
    const schema = this.schemaFor(project, induced);

    const finished = {
      before: stateFromPayloads(live.demonstration.beforePayloads, schema),
      after: stateFromPayloads(afterPayloads, schema),
      induced,
      entries: live.demonstration.entries,
      schema,
    };
    live.demonstration = undefined;
    // Finished, so the resumable copy is not merely stale but wrong: resuming
    // it would append to a recording that has already been compiled.
    await this.store.deleteArtefact(project.id, 'demonstration');
    return finished;
  }

  inducedFor(projectId: string): InducedSchema | undefined {
    return this.live.get(projectId)?.induced;
  }

  setInduced(projectId: string, induced: InducedSchema): void {
    const live = this.live.get(projectId);
    if (live) live.induced = induced;
  }

  /** The confirmed schema: what was induced, plus what a person corrected. */
  schemaFor(project: Project, induced: InducedSchema): EnvironmentSchema {
    return applySchemaAnswers(induced, project.schemaAnswers as SchemaAnswer[]).schema;
  }
}

export function environmentConfig(project: Project): SystemEnvironmentConfig {
  return {
    id: project.id,
    name: project.name,
    description: project.goal || `${project.name}, reached over MCP.`,
    verifierReads: project.verifierReads.map((read) => ({ tool: read.tool, args: read.args })),
    reset:
      project.reset.kind === 'tool' && project.reset.tool
        ? { kind: 'tool', tool: project.reset.tool }
        : { kind: 'none' },
    safety: project.safety,
    readOnlyTools: project.readOnlyTools,
  };
}

/**
 * Refuses to open a connector nobody on this machine has looked at.
 *
 * A connector is a command to run, or a URL to open with your credentials. When
 * you typed it, you decided. When it arrived inside a file somebody sent you,
 * you have not — and `rigorrun import-project` is exactly the shape of thing
 * that gets forwarded in a chat and run without reading.
 *
 * So an imported project is inert until somebody has seen the command in full
 * and said yes. Not a warning: opening it *is* the harmful act, so the refusal
 * has to come first.
 */
export function assertConnectorTrusted(project: Project): void {
  const trust = project.connectorTrust;
  if (trust.origin !== 'imported' || trust.confirmedAt !== null) return;
  const connector = project.connector;
  const what = connector ? describeConnectorAction(connector) : 'reach a system';
  throw new Error(
    `"${project.name}" was imported, so its connector came from a file rather than from you. ` +
      `Opening it would ${what} on this machine. Read that line and confirm it — in the ` +
      `interface, or with \`rigorrun trust ${project.id}\` — and RigorRun will open it from then on.`,
  );
}