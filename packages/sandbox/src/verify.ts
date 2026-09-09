/**
 * The whole loop: a reference in, a verification record out.
 *
 *   resolve → pin digest → stage → build → run → discover → exercise → judge
 *
 * Nothing here decides what is true. Resolution decides what bytes ran, the
 * container decides what the target could reach, the surfaces decide what was
 * observable, and `@rigorrun/conformance` decides what the observations mean.
 * This file's only job is to keep those apart and to make sure that anything
 * it could not establish arrives in the record as undetermined rather than as
 * a convenient `false`.
 *
 * One ordering choice worth stating: tools that declare themselves read-only
 * are exercised first. A tool claiming to be read-only and writing is the
 * finding this product exists to produce, and it should not be reached only
 * after a genuinely-writing tool has already muddied the state.
 */
import { rm } from 'node:fs/promises';
import {
  ROOTFUL_DAEMON_CAVEAT,
  SERVER_READS_CAVEAT,
  RECORD_SCHEMA_VERSION,
  VERIFICATION_RECORD_SCHEMA,
  VerificationRecordSchema,
  hashValue,
  prefixedId,
  type CaseRecord,
  type StateSurfaceId,
  type ToolRecord,
  type Untested,
  type VerificationRecord,
  RIGORRUN_VERSION,
} from '@rigorrun/core';
import { judge, planTool, type ObservedBehavior } from '@rigorrun/conformance';
import { McpConnection, type DiscoveredTool } from '@rigorrun/mcp';
import {
  BASE_IMAGE_TAG,
  stageDirectory,
  stageNpmPackage,
  type StagedTarget,
} from './stage.ts';
import { buildImage, imageDigest, inspectRuntime, pullImage, removeImage } from './docker.ts';
import { ContainerSession, DEFAULT_LIMITS, type ContainerLimits } from './session.ts';
import { parseReference } from './reference.ts';
import { fetchVerifiedTarball, resolvePackage } from './registry.ts';
import {
  destroyedAnything,
  diffReadings,
  isEmpty,
  parseStatedump,
  touchedPaths,
  type SurfaceReading,
} from './surfaces.ts';

export class VerifyError extends Error {}

export interface VerifyOptions {
  limits?: ContainerLimits;
  /** Tools the operator says need a credential. Never inferred. */
  needsCredential?: readonly string[];
  seed?: string;
  /** How many independent resets to compare when proving isolation. */
  resetProofs?: number;
  onProgress?: (phase: string, detail: string) => void;
}

const HARNESS_VERSION = RIGORRUN_VERSION;

function reading(surface: StateSurfaceId, dump: string): SurfaceReading {
  return { surface, entries: parseStatedump(dump), readable: dump.length > 0 };
}

/** Starts a container and speaks MCP into it over its stdio. */
async function openInContainer(
  session: ContainerSession,
  timeoutMs: number,
): Promise<McpConnection> {
  return McpConnection.open(
    {
      transport: 'stdio',
      command: 'docker',
      args: session.argv,
      // The docker *client* needs to know which daemon to talk to. The
      // container itself gets no environment at all — there is no -e flag in
      // the argv, and that is deliberate.
      env: dockerEndpointEnv(),
    },
    { timeoutMs },
  );
}

function dockerEndpointEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY']) {
    const value = process.env[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/**
 * Whether reset actually resets, measured rather than declared.
 *
 * Starting a container twice from the same image should produce the same
 * initial state. If it does not, that is not a reason to stop — it is a reason
 * to label the run honestly, which is what `PARTIAL` is for.
 */
async function proveIsolation(
  image: string,
  limits: ContainerLimits,
  rounds: number,
  entry: string,
): Promise<{ digests: string[]; stable: boolean; pathsStable: boolean; unstable: string[] }> {
  const digests: string[] = [];
  const pathSets: string[][] = [];

  for (let i = 0; i < rounds; i += 1) {
    const session = new ContainerSession({ image, limits, command: [entry] });
    let connection: McpConnection | undefined;
    try {
      connection = await openInContainer(session, 60_000);
      const dump = await session.statedump();
      const parsed = parseStatedump(dump);
      digests.push(await hashValue([...parsed.entries()].sort()));
      pathSets.push([...parsed.keys()].sort());
    } finally {
      await connection?.close();
      await session.remove();
    }
  }

  const stable = digests.every((d) => d === digests[0]);
  const first = pathSets[0] ?? [];
  const pathsStable = pathSets.every(
    (set) => set.length === first.length && set.every((p, i) => p === first[i]),
  );
  return { digests, stable, pathsStable, unstable: stable ? [] : first.slice(0, 0) };
}

export async function verifyServer(
  reference: string,
  options: VerifyOptions = {},
): Promise<VerificationRecord> {
  const startedAt = new Date().toISOString();
  const progress = options.onProgress ?? (() => undefined);
  const limits = options.limits ?? DEFAULT_LIMITS;
  const seed = options.seed ?? 'rigorrun-v2';
  const ref = parseReference(reference);

  const runtime = await inspectRuntime();
  if (!runtime.available) {
    throw new VerifyError(
      'RigorRun needs a container runtime to verify a server, and could not reach one.\n' +
        `  ${runtime.detail}\n` +
        'Install Docker or Podman and start it, then run `rigorrun doctor` to check. This is a ' +
        'configuration problem, not a finding about the server.',
    );
  }

  // ---- resolve and pin -------------------------------------------------
  progress('resolve', ref.raw);
  let staged: StagedTarget;
  let digest: string;
  let resolvedVersion: string;
  let tarballUrl = '';

  if (ref.scheme === 'npm') {
    const pkg = await resolvePackage(ref.name, ref.version);
    resolvedVersion = pkg.version;
    digest = pkg.integrity;
    tarballUrl = pkg.tarballUrl;
    progress('fetch', `${pkg.name}@${pkg.version}`);
    // Fetched and hashed before anything unpacks it, so the bytes that were
    // measured are the bytes that run.
    await fetchVerifiedTarball(pkg);
    progress('stage', 'installing with lifecycle scripts disabled');
    staged = await stageNpmPackage(pkg.name, pkg.version);
  } else {
    progress('stage', ref.name);
    staged = await stageDirectory(ref.name);
    resolvedVersion = 'local';
    // Over the target's own bytes, not its dependency closure: two servers
    // sharing dependencies must not share an identity. Visibly a different
    // kind of digest from an npm SRI, so a record made from a directory can
    // never be read as one made from a published artifact.
    digest = `dirhash:${staged.contentDigest}`;
  }

  const imageTag = `rigorrun-target:${prefixedId('t').replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
  const cases: CaseRecord[] = [];
  const toolRecords: ToolRecord[] = [];
  const untested: Untested[] = [];
  let readonlyVerified: boolean;
  let serverInfo: { name: string; version: string; protocolVersion: string };

  try {
    progress('image', BASE_IMAGE_TAG);
    await pullImage(BASE_IMAGE_TAG).catch(() => undefined);
    const baseDigest = (await imageDigest(BASE_IMAGE_TAG)) || BASE_IMAGE_TAG;
    await buildImage(staged.dir, imageTag);

    // ---- prove reset before trusting any case --------------------------
    progress('isolation', 'measuring whether reset actually resets');
    const proof = await proveIsolation(imageTag, limits, options.resetProofs ?? 2, staged.entryModule);

    // ---- discover ------------------------------------------------------
    progress('launch', 'starting the server');
    const session = new ContainerSession({ image: imageTag, limits, command: [staged.entryModule] });
    let connection: McpConnection | undefined;
    let tools: DiscoveredTool[] = [];

    try {
      connection = await openInContainer(session, 120_000);
      tools = [...connection.discovery.tools];
      serverInfo = {
        name: connection.discovery.serverName,
        version: connection.discovery.serverVersion,
        protocolVersion: connection.discovery.protocolVersion,
      };
      progress('discover', `${tools.length} tool(s)`);

      const layer = await session.layerChanges();
      readonlyVerified = layer.length === 0;
    } finally {
      await connection?.close();
      await session.remove();
    }

    // Read-only declarations first: the finding worth having should not be
    // reached only after something else has already written.
    const ordered = [...tools].sort((a, b) => {
      const rank = (t: DiscoveredTool) => (t.hints.readOnly === true ? 0 : 1);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

    // ---- exercise, one container per tool ------------------------------
    for (const tool of ordered) {
      const plan = planTool({
        name: tool.name,
        inputSchema: tool.inputSchema ?? {},
        hints: tool.hints,
        seed,
        ...(options.needsCredential ? { needsCredential: options.needsCredential } : {}),
      });

      if (plan.class !== 'SAFE_AUTOMATIC') {
        untested.push({ tool: tool.name, reason: plan.class, detail: plan.reason });
        toolRecords.push({
          name: tool.name,
          description: tool.description,
          declared: declaredOf(tool),
          observed: {
            mutatesState: 'undetermined',
            surfacesTouched: [],
            wrote: [],
            sideEffects: [],
            idempotent: 'not-probed',
            errorBehavior: [],
          },
          // Deliberately empty. A tool RigorRun chose not to call has not been
          // found undetermined about anything -- it is in `untested`, with the
          // reason, and that is the honest place for it. Emitting a verdict per
          // annotation here would make declining to touch a destructive tool
          // look like three inconclusive findings.
          conformance: [],
          verification: 'OBSERVATIONAL',
        });
        continue;
      }

      progress('exercise', tool.name);
      const observation = await exerciseTool(tool, plan.args, plan.derivation, {
        image: imageTag,
        limits,
        entry: staged.entryModule,
        cases,
      });

      // The call was refused and nothing changed. That is a tool needing a
      // record to point at, not a tool contradicting its own declaration --
      // and saying otherwise would accuse a server of lying because we could
      // not think of a valid argument. Inside a container we own, trying is
      // free, so this is discovered by attempting rather than guessed from the
      // schema.
      if (observation.refusedWithoutEffect) {
        untested.push({
          tool: tool.name,
          reason: 'NEEDS_FIXTURE',
          detail:
            observation.errorBehavior[0] ??
            'the tool refused generated arguments and changed nothing',
        });
        toolRecords.push({
          name: tool.name,
          description: tool.description,
          declared: declaredOf(tool),
          observed: {
            mutatesState: 'undetermined',
            surfacesTouched: [],
            wrote: [],
            sideEffects: [],
            idempotent: 'not-probed',
            errorBehavior: observation.errorBehavior,
          },
          conformance: [],
          verification: 'OBSERVATIONAL',
        });
        continue;
      }

      toolRecords.push({
        name: tool.name,
        description: tool.description,
        declared: declaredOf(tool),
        observed: {
          mutatesState: observation.behavior.mutatesState,
          surfacesTouched: observation.behavior.surfaces as StateSurfaceId[],
          wrote: observation.wrote,
          sideEffects: observation.sideEffects,
          idempotent: observation.behavior.idempotent,
          errorBehavior: observation.errorBehavior,
        },
        conformance: judge(tool.hints, observation.behavior),
        // The strongest honest label: the filesystem enumeration is complete
        // over durable state but blind to memory, so it is PARTIAL.
        verification: observation.behavior.surfaces.includes('container_fs')
          ? 'PARTIAL'
          : 'OBSERVATIONAL',
      });
    }

    const conformance = toolRecords.flatMap((t) => t.conformance);
    const record: VerificationRecord = VerificationRecordSchema.parse({
      schema: VERIFICATION_RECORD_SCHEMA,
      schemaVersion: RECORD_SCHEMA_VERSION,
      recordId: prefixedId('rec'),
      target: {
        ref: ref.raw,
        scheme: ref.scheme,
        resolvedVersion,
        digest,
        treeDigest: staged.treeDigest,
        tarballUrl,
        fetchedAt: startedAt,
      },
      harness: {
        version: HARNESS_VERSION,
        runtime: `docker ${runtime.version}`,
        rootless: runtime.rootless,
        baseImage: baseDigest,
        imageId: imageTag,
        isolation: proof.stable ? 'RESET' : proof.pathsStable ? 'PARTIAL' : 'NONE',
        isolationProof: {
          resets: proof.digests.length,
          initialDigests: proof.digests,
          unstablePaths: proof.unstable,
        },
        networkEgress: false,
        readonlyVerified,
        installScripts: 'skipped',
        limits: { pids: limits.pids, memoryMb: limits.memoryMb, cpus: limits.cpus },
        runArgv: new ContainerSession({ image: imageTag, limits }).argv,
        seed,
        caveats: [
          ...(runtime.rootless ? [] : [ROOTFUL_DAEMON_CAVEAT]),
          SERVER_READS_CAVEAT,
          'State is read from the container’s writable mounts, which is complete over durable ' +
            'storage and blind to state a process holds only in memory.',
        ],
      },
      server: serverInfo,
      tools: toolRecords,
      untested,
      cases,
      summary: {
        toolsDiscovered: tools.length,
        toolsExercised: toolRecords.filter((t) => t.conformance.length > 0).length,
        conforms: conformance.filter((c) => c.verdict === 'CONFORMS').length,
        contradicted: conformance.filter((c) => c.verdict === 'CONTRADICTED').length,
        undetermined: conformance.filter((c) => c.verdict === 'UNDETERMINED').length,
        untested: untested.length,
      },
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    return { ...record, recordHash: await hashValue({ ...record, recordHash: '' }) };
  } finally {
    await removeImage(imageTag).catch(() => undefined);
    await staged.cleanup().catch(() => undefined);
    await rm(staged.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function declaredOf(tool: DiscoveredTool) {
  const { readOnly, destructive, idempotent, openWorld } = tool.hints;
  return {
    ...(readOnly !== undefined ? { readOnlyHint: readOnly } : {}),
    ...(destructive !== undefined ? { destructiveHint: destructive } : {}),
    ...(idempotent !== undefined ? { idempotentHint: idempotent } : {}),
    ...(openWorld !== undefined ? { openWorldHint: openWorld } : {}),
  };
}

interface ExerciseContext {
  image: string;
  limits: ContainerLimits;
  entry: string;
  cases: CaseRecord[];
}

/**
 * One tool, in its own container, called twice.
 *
 * Twice because idempotence is only answerable by repetition, and a fresh
 * container per tool because otherwise the second tool inherits the first
 * one's mess and every delta after the first means less than it appears to.
 */
async function exerciseTool(
  tool: DiscoveredTool,
  args: Record<string, unknown>,
  derivation: string[],
  ctx: ExerciseContext,
): Promise<{
  behavior: ObservedBehavior;
  wrote: string[];
  sideEffects: string[];
  errorBehavior: string[];
  /** The call was refused and nothing observable happened. */
  refusedWithoutEffect: boolean;
}> {
  const session = new ContainerSession({
    image: ctx.image,
    limits: ctx.limits,
    command: [ctx.entry],
  });
  let connection: McpConnection | undefined;
  const errorBehavior: string[] = [];

  try {
    connection = await openInContainer(session, 120_000);

    const before = reading('container_fs', await session.statedump());
    const firstId = `case:${ctx.cases.length + 1}`;
    const first = await connection.call(tool.name, args, 60_000);
    const afterFirst = reading('container_fs', await session.statedump());
    const delta = diffReadings(before, afterFirst);

    if (!first.ok) errorBehavior.push(first.error?.message ?? 'the call returned an error');

    ctx.cases.push({
      id: firstId,
      tool: tool.name,
      args,
      derivation,
      ok: first.ok,
      isError: !first.ok,
      errorText: first.error?.message ?? '',
      beforeDigest: await hashValue([...before.entries.entries()].sort()),
      afterDigest: await hashValue([...afterFirst.entries.entries()].sort()),
      changedPaths: touchedPaths(delta),
      durationMs: first.durationMs,
      stderrExcerpt: '',
    });

    // Second identical call. Only meaningful if the first one worked.
    let idempotent: ObservedBehavior['idempotent'] = 'not-probed';
    if (first.ok) {
      const second = await connection.call(tool.name, args, 60_000);
      const afterSecond = reading('container_fs', await session.statedump());
      const secondDelta = diffReadings(afterFirst, afterSecond);
      idempotent = isEmpty(secondDelta) ? 'yes' : 'no';

      ctx.cases.push({
        id: `case:${ctx.cases.length + 1}`,
        tool: tool.name,
        args,
        derivation: ['repeat of the previous case, to test idempotence'],
        ok: second.ok,
        isError: !second.ok,
        errorText: second.error?.message ?? '',
        beforeDigest: await hashValue([...afterFirst.entries.entries()].sort()),
        afterDigest: await hashValue([...afterSecond.entries.entries()].sort()),
        changedPaths: touchedPaths(secondDelta),
        durationMs: second.durationMs,
        stderrExcerpt: '',
      });
    }

    const readable = before.readable && afterFirst.readable;
    const surfaces: StateSurfaceId[] = readable ? ['container_fs'] : [];

    return {
      behavior: {
        // Unreadable is undetermined. It is never quietly turned into "no".
        mutatesState: !readable ? 'undetermined' : isEmpty(delta) ? 'no' : 'yes',
        destroyed: !readable ? 'undetermined' : destroyedAnything(delta) ? 'yes' : 'no',
        idempotent,
        surfaces,
        evidenceRef: firstId,
      },
      wrote: touchedPaths(delta),
      sideEffects: [],
      errorBehavior,
      refusedWithoutEffect: !first.ok && isEmpty(delta),
    };
  } finally {
    await connection?.close();
    await session.remove();
  }
}
