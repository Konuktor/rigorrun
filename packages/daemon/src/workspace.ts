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
  LocalOAuthProvider,
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
  VerifiedConnection,
  detectMismatch,
  hasPayload,
  normalizeCallResult,
  stateFromPayloads,
  type AnnotationMismatch,
  type SystemConnection,
  type SystemEnvironmentConfig,
} from '@rigorrun/connector';
import { OpenApiConnection } from '@rigorrun/env-openapi';
import { BrowserConnection } from '@rigorrun/env-browser';
import type { ActionLogEntry } from '@rigorrun/core';
import type { CanonicalState, EnvironmentSchema } from '@rigorrun/environment';
import { basename, join } from 'node:path';
import {
  describeConnectorAction,
  secretNamesOf,
  type Project,
  type DirectConnector,
} from './project.ts';
import { forgetChild, noteChild } from './orphans.ts';
import { openInBrowser } from './openUrl.ts';
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
    for (const name of secretNamesOf(connector)) {
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

    if (connector.kind === 'browser') {
      const secrets = await this.secretsFor(project);
      // A verifier is opened first and handed over, so the browser owns closing
      // it — one connection to close, whatever is behind it.
      const verifier =
        connector.verifier === null
          ? undefined
          : await this.openConnector(connector.verifier, secrets);
      return BrowserConnection.open({
        startUrl: connector.startUrl,
        browser: connector.browser,
        headless: connector.headless,
        ...(verifier ? { verifier } : {}),
        evidenceDir: join(this.store.path, 'projects', project.id, 'evidence'),
      });
    }
    const secrets = await this.secretsFor(project);
    const primary = await this.openConnector(connector, secrets);
    if (!connector.verifier) return primary;
    // A second connection to the same system, for the verdict only. Opened
    // after the first, and if it cannot be opened the first is closed: a
    // project that asked for independent reads does not quietly fall back to
    // reading through the agent's own connection.
    try {
      return new VerifiedConnection(primary, await this.openConnector(connector.verifier, secrets));
    } catch (error) {
      await primary.close().catch(() => undefined);
      throw error;
    }
  }

  /** One connector, already narrowed, with its credentials already fetched. */
  private async openConnector(
    connector: DirectConnector,
    secrets: Record<string, string>,
  ): Promise<SystemConnection> {
    if (connector.kind === 'openapi') {
      // The names become values here and nowhere earlier. `secretsFor` has
      // already refused a connector whose credentials are missing — including
      // these, because `secretNamesOf` derives them — so this is narrowing
      // rather than checking. It still says something true if it ever fires.
      const oauth = connector.oauth;
      const clientId = oauth ? secrets[oauth.clientIdSecret] : undefined;
      const clientSecret = oauth ? secrets[oauth.clientSecretSecret] : undefined;
      if (oauth && (clientId === undefined || clientSecret === undefined)) {
        throw new Error(
          `This API signs in with a client id and secret, and ${
            clientId === undefined ? oauth.clientIdSecret : oauth.clientSecretSecret
          } is not in this machine's credential store. Set it with \`rigorrun secrets set\`.`,
        );
      }
      return OpenApiConnection.open({
        spec: connector.spec,
        baseUrl: connector.baseUrl,
        ...(oauth && clientId !== undefined && clientSecret !== undefined
          ? {
              oauth: {
                tokenUrl: oauth.tokenUrl,
                clientId,
                clientSecret,
                ...(oauth.scope ? { scope: oauth.scope } : {}),
              },
            }
          : {}),
        // The project stores a header name against a *secret* name; the value
        // is substituted here and nowhere earlier.
        headers: Object.fromEntries(
          Object.entries(connector.headers)
            .map(([header, secret]) => [header, secrets[secret]])
            .filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      });
    }
    const config: McpConfig =
      connector.transport === 'stdio'
        ? { transport: 'stdio', command: connector.command, args: connector.args, env: secrets }
        : {
            transport: 'http',
            url: connector.url,
            ...(Object.keys(secrets).length > 0 ? { headers: secrets } : {}),
            // Tokens go where credentials go, keyed by the server's own URL so
            // one machine can hold several. Nothing about the sign-in is
            // written to the project.
            ...(connector.auth === 'oauth'
              ? {
                  auth: new LocalOAuthProvider({
                    serverKey: connector.url,
                    store: this.store.credentials,
                    open: openInBrowser,
                    // Printed as well as opened. A headless box, an SSH
                    // session or a container has no browser to open, and the
                    // person still needs the address.
                    onAuthorizationUrl: (url) =>
                      process.stderr.write(`Sign in to ${connector.url}:\n  ${url}\n`),
                  }),
                }
              : {}),
          };
    if (config.transport === 'stdio') assertSafeCommand(config);
    return McpConnection.open(config);
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
    const beforeAnswers = await this.readAnswers(project);
    live.demonstration = {
      startedAt: Date.now(),
      beforePayloads: beforeAnswers.map((answer) => answer.payload),
      entries: [],
      observations: beforeAnswers.map((answer) => ({
        tool: 'before',
        payload: answer.payload,
        reading: { read: answer.read, moment: 'before' as const },
      })),
    };
    await this.saveDemonstration(project);
  }

  /** Calls every nominated read and keeps the answers exactly as they came. */
  private async readPayloads(project: Project): Promise<unknown[]> {
    return (await this.readAnswers(project)).map((answer) => answer.payload);
  }

  /**
   * The nominated reads' answers, each labelled with the read that gave it.
   *
   * The label is what lets induction compare two readings of the same read,
   * taken before and after the job: a field that changed between them for the
   * same record describes that record, and must never be what names it.
   */
  private async readAnswers(project: Project): Promise<{ read: string; payload: unknown }[]> {
    const live = this.live.get(project.id);
    if (!live) throw new Error(`${project.name} is not connected.`);
    // A connector that cannot read the system back reads nothing, whatever its
    // operations return. A browser's `read_page` answers with a page, and a
    // page is structured enough to be mistaken for records — which would mean
    // inducing entities out of a *rendering* of the state and then grading an
    // agent against the system's own account of what it did. Empty is the
    // honest answer, and everything downstream already says OBSERVATIONAL.
    if (live.connection.canReadState === false) return [];
    const answers: { read: string; payload: unknown }[] = [];
    for (const [index, read] of project.verifierReads.entries()) {
      // The one reading of a result, shared with the setup probe and the
      // runner: a server that answers with JSON inside a text block is read
      // here exactly as it was read when the probe said it could be.
      const normalized = normalizeCallResult(
        await live.connection.call(read.tool, read.args, project.budgets.toolCallMs),
      );
      if (hasPayload(normalized)) {
        answers.push({ read: `${index}:${read.tool}:${JSON.stringify(read.args ?? {})}`, payload: normalized.payload });
      }
    }
    return answers;
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

    // What the system looked like before this call, so what the call did can
    // be seen rather than assumed. Read for every tool the operator has not
    // vouched for as read-only — those are the calls that might be the job,
    // and a call of a tool that can write but wrote nothing (a SELECT through
    // `execute`) must not be mistaken for it — and for tools the *system*
    // claims are read-only, so the claim can be checked.
    const claimsReadOnly =
      live.connection.discovery.tools.find((entry) => entry.name === tool)?.hints.readOnly === true;
    const vouchedReadOnly = project.readOnlyTools.includes(tool);
    const watch = claimsReadOnly || !vouchedReadOnly;
    const before = watch ? await this.readPayloads(project) : undefined;

    const result = await live.connection.call(tool, args, project.budgets.toolCallMs);
    const normalized = normalizeCallResult(result);
    if (hasPayload(normalized)) {
      live.demonstration.observations.push({ tool, payload: normalized.payload });
    }

    let changed: boolean | undefined;
    if (before !== undefined) {
      const after = await this.readPayloads(project);
      const differs = JSON.stringify(after) !== JSON.stringify(before);
      // Whether a call changed anything is only knowable when the reads showed
      // something. Two empty answers — a system that answers in prose, a
      // browser that cannot read itself back — are "could not tell", and
      // recording them as "changed nothing" would drop the job itself.
      if (before.length > 0 || after.length > 0) changed = differs;
      if (claimsReadOnly) {
        const mismatch = detectMismatch(tool, { readOnly: true }, differs);
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
    }

    // Reads are watched but not written into the trace. The contract is
    // induced from what *changed*, and a read that changed nothing would
    // become a step the agent is expected to reproduce. A call that could
    // have written is recorded with whether it did.
    if (!vouchedReadOnly) {
      live.demonstration.entries.push({
        at: Date.now() - live.demonstration.startedAt,
        action: tool,
        args,
        ok: result.ok,
        ...(changed === undefined ? {} : { changed }),
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

    const afterAnswers = await this.readAnswers(project);
    const afterPayloads = afterAnswers.map((answer) => answer.payload);
    const observations = [
      ...live.demonstration.observations,
      ...afterAnswers.map((answer) => ({
        tool: 'after',
        payload: answer.payload,
        reading: { read: answer.read, moment: 'after' as const },
      })),
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
    toolCallMs: project.budgets.toolCallMs,
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