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
import { McpEnvironment, stateFromPayloads, type McpEnvironmentConfig } from '@rigorrun/env-mcp';
import type { ActionLogEntry } from '@rigorrun/core';
import type { CanonicalState, EnvironmentSchema } from '@rigorrun/environment';
import type { Project } from './project.ts';
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

export interface LiveProject {
  connection: McpConnection;
  induced: InducedSchema | undefined;
  demonstration: Demonstration | undefined;
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
  async configFor(project: Project): Promise<McpConfig> {
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
          `Set them with \`rigorrun secret set <name>\`.`,
      );
    }

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

  async connect(project: Project): Promise<McpConnection> {
    const existing = this.live.get(project.id);
    if (existing) return existing.connection;
    const connection = await McpConnection.open(await this.configFor(project));
    this.live.set(project.id, { connection, induced: undefined, demonstration: undefined });
    return connection;
  }

  connectionFor(projectId: string): McpConnection | undefined {
    return this.live.get(projectId)?.connection;
  }

  async disconnect(projectId: string): Promise<void> {
    const live = this.live.get(projectId);
    if (!live) return;
    this.live.delete(projectId);
    await live.connection.close();
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
  environment(project: Project, schema: EnvironmentSchema): McpEnvironment {
    const connection = this.connectionFor(project.id);
    if (!connection) throw new Error(`${project.name} is not connected.`);
    return new McpEnvironment(connection, schema, environmentConfig(project));
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

    await this.environment(project, { entities: [], relationships: [] }).reset();
    const beforePayloads = await this.readPayloads(project);
    live.demonstration = {
      startedAt: Date.now(),
      beforePayloads,
      entries: [],
      observations: beforePayloads.map((payload) => ({ tool: 'before', payload })),
    };
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

  /** One thing the person did, executed for real and written down. */
  async demonstrate(
    project: Project,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const live = this.live.get(project.id);
    if (!live?.demonstration) throw new Error('Nothing is being recorded right now.');

    const result = await live.connection.call(tool, args);
    if (result.structured !== undefined) {
      live.demonstration.observations.push({ tool, payload: result.structured });
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

export function environmentConfig(project: Project): McpEnvironmentConfig {
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
