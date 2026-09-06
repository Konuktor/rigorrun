/**
 * The verification record: what a server was observed to do, and what it said
 * it would do.
 *
 * This is the artefact `rigorrun verify` produces, and it is the only thing
 * that leaves the machine. Everything else — the container, the exercise plan,
 * the state surfaces — exists to fill it in honestly.
 *
 * Three rules are built into the shape rather than left to the code:
 *
 *   1. Every observation names the surface that produced it. A finding whose
 *      surface was the server's own read tools is a weaker finding than one
 *      read out of the container's filesystem, and a reader must be able to
 *      tell which they are looking at without asking us.
 *
 *   2. `untested` is required and may be empty, never absent. A record that
 *      omits what it could not reach is not a cleaner record, it is a false
 *      one, and making the field optional is how that happens by accident.
 *
 *   3. `harness.caveats` is required and non-empty. The container boundary is
 *      not a security guarantee and the record says so in the machine-readable
 *      part, not only in prose somebody may not read.
 *
 * Hashed, not signed. `recordHash` is computed over the record with the field
 * blanked, exactly as `RunResult.resultHash` is, so a signature later is an
 * added field rather than a reshaped document.
 */
import { z } from 'zod';
import { FAILURE_SEVERITIES } from './assertion.ts';
import { ISOLATION_LEVELS, VERIFICATION_STRENGTHS } from './run.ts';
import { RECORD_SCHEMA_VERSION } from './versions.ts';

/** The wire identifier a consumer greps for. */
export const VERIFICATION_RECORD_SCHEMA = 'rigorrun.record/1';

/**
 * How a reference was turned into bytes.
 *
 * `npm` resolves through the registry and pins the sha512 the registry
 * published for that exact version. `dir` is a local directory, used for
 * fixtures and for a server that is not published anywhere; its digest is over
 * a canonical manifest of the files, and is prefixed differently so that a
 * fixture record can never be mistaken for a registry one.
 */
export const TARGET_SCHEMES = ['npm', 'dir'] as const;
export const TargetSchemeSchema = z.enum(TARGET_SCHEMES);
export type TargetScheme = z.infer<typeof TargetSchemeSchema>;

export const TargetSchema = z.object({
  /** Exactly what the operator typed, kept verbatim. */
  ref: z.string().min(1),
  scheme: TargetSchemeSchema,
  /** The version actually used. Never a tag, never a range. */
  resolvedVersion: z.string(),
  /** `sha512-<base64>` from the registry, or `dirhash:sha256:<hex>`. */
  digest: z.string().min(1),
  /**
   * The whole installed dependency closure, hashed.
   *
   * `digest` covers the package. This covers everything that got installed
   * with it, which is what changes when a transitive dependency moves and the
   * package version does not.
   */
  treeDigest: z.string().default(''),
  tarballUrl: z.string().default(''),
  fetchedAt: z.string(),
});
export type Target = z.infer<typeof TargetSchema>;

/** What reset was measured to do, rather than what the config claimed. */
export const IsolationProofSchema = z.object({
  resets: z.number().int().nonnegative(),
  /** The state digest after each independent reset. Recomputable by a reader. */
  initialDigests: z.array(z.string()),
  /** Paths that came back with different contents each time. */
  unstablePaths: z.array(z.string()).default([]),
});
export type IsolationProof = z.infer<typeof IsolationProofSchema>;

export const HarnessSchema = z.object({
  version: z.string(),
  /** e.g. `docker 28.5.2`. Which engine actually ran this. */
  runtime: z.string(),
  /** Whether that engine's daemon runs as root, because it changes the boundary. */
  rootless: z.boolean(),
  /** The base image, pinned by digest. A tag is not a baseline. */
  baseImage: z.string(),
  imageId: z.string().default(''),
  isolation: z.enum(ISOLATION_LEVELS).default('NONE'),
  isolationProof: IsolationProofSchema,
  /** False for every run this harness performs. Opt-in egress is recorded here. */
  networkEgress: z.boolean(),
  /** Whether the read-only posture held: the container layer stayed empty. */
  readonlyVerified: z.boolean(),
  /** Whether the target's own install scripts ever ran, and where. */
  installScripts: z.enum(['skipped', 'ran-in-sandbox']),
  limits: z.object({
    pids: z.number().int().positive(),
    memoryMb: z.number().int().positive(),
    cpus: z.number().positive(),
  }),
  /** The literal argv, so a reader can check the posture rather than trust it. */
  runArgv: z.array(z.string()).default([]),
  seed: z.string(),
  /** What this run does not prove. Required, and required non-empty. */
  caveats: z.array(z.string()).min(1),
});
export type Harness = z.infer<typeof HarnessSchema>;

/**
 * What the server says about a tool.
 *
 * Exactly the four annotations MCP defines, not widened. These are claims, and
 * the whole point of the record is that they sit beside what was observed
 * rather than being folded into it.
 */
export const DeclaredSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});
export type Declared = z.infer<typeof DeclaredSchema>;

/**
 * Where an observation came from, and the strongest claim it can support.
 *
 * The server's own read tools are the weakest of these on purpose: the server
 * that might be lying about `readOnlyHint` is the same server answering the
 * read. A reading from that surface may corroborate a contradiction. It may
 * never establish one.
 */
export const STATE_SURFACES = [
  'container_fs',
  'server_reads',
  'process_table',
  'container_diff',
] as const;
export const StateSurfaceSchema = z.enum(STATE_SURFACES);
export type StateSurfaceId = z.infer<typeof StateSurfaceSchema>;

export const ObservedSchema = z.object({
  /** Undetermined is a third answer, and is never collapsed into `false`. */
  mutatesState: z.enum(['yes', 'no', 'undetermined']),
  surfacesTouched: z.array(StateSurfaceSchema).default([]),
  /** Paths created, modified or removed inside the container. */
  wrote: z.array(z.string()).default([]),
  sideEffects: z.array(z.string()).default([]),
  idempotent: z.enum(['yes', 'no', 'not-probed']),
  errorBehavior: z.array(z.string()).default([]),
});
export type Observed = z.infer<typeof ObservedSchema>;

export const CONFORMANCE_VERDICTS = ['CONFORMS', 'CONTRADICTED', 'UNDETERMINED'] as const;
export const ConformanceVerdictSchema = z.enum(CONFORMANCE_VERDICTS);
export type ConformanceVerdict = z.infer<typeof ConformanceVerdictSchema>;

export const ConformanceSchema = z.object({
  /** The claim being checked, as the server phrased it: `readOnlyHint: true`. */
  claim: z.string(),
  verdict: ConformanceVerdictSchema,
  severity: z.enum(FAILURE_SEVERITIES),
  /**
   * Whether contradicting this claim changes what an agent is allowed to do
   * without asking. `readOnlyHint` and `destructiveHint` drive automatic
   * permissioning in at least one major client, so a tool that declares itself
   * read-only and writes is a permission bypass rather than a documentation
   * defect, and the record says which it is.
   */
  permissionRelevant: z.boolean().default(false),
  /** One sentence a person can read without the rest of the record. */
  because: z.string(),
  /** The surface that produced the observation behind this verdict. */
  surface: StateSurfaceSchema.optional(),
  /** The case that proves it. Every fact points at a run. */
  evidenceRef: z.string().default(''),
});
export type Conformance = z.infer<typeof ConformanceSchema>;

export const ToolRecordSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  declared: DeclaredSchema,
  observed: ObservedSchema,
  conformance: z.array(ConformanceSchema).default([]),
  verification: z.enum(VERIFICATION_STRENGTHS),
});
export type ToolRecord = z.infer<typeof ToolRecordSchema>;

/** Why a tool was not exercised. Never inferred, always stated. */
export const UNTESTED_REASONS = [
  'NEEDS_FIXTURE',
  'NEEDS_CREDENTIAL',
  'UNSAFE_TO_EXERCISE',
  'UNDETERMINED',
] as const;
export const UntestedReasonSchema = z.enum(UNTESTED_REASONS);
export type UntestedReason = z.infer<typeof UntestedReasonSchema>;

export const UntestedSchema = z.object({
  tool: z.string(),
  reason: UntestedReasonSchema,
  detail: z.string(),
});
export type Untested = z.infer<typeof UntestedSchema>;

export const CaseRecordSchema = z.object({
  id: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  /** How each argument was chosen, so a reader can reproduce the plan. */
  derivation: z.array(z.string()).default([]),
  ok: z.boolean(),
  isError: z.boolean().default(false),
  errorText: z.string().default(''),
  beforeDigest: z.string().default(''),
  afterDigest: z.string().default(''),
  changedPaths: z.array(z.string()).default([]),
  durationMs: z.number().nonnegative().default(0),
  stderrExcerpt: z.string().default(''),
});
export type CaseRecord = z.infer<typeof CaseRecordSchema>;

export const VerificationRecordSchema = z.object({
  schema: z.literal(VERIFICATION_RECORD_SCHEMA),
  schemaVersion: z.literal(RECORD_SCHEMA_VERSION),
  recordId: z.string(),
  target: TargetSchema,
  harness: HarnessSchema,
  server: z.object({
    name: z.string().default(''),
    version: z.string().default(''),
    protocolVersion: z.string().default(''),
  }),
  tools: z.array(ToolRecordSchema).default([]),
  /** Required. Present and empty means "everything was tested", and is a claim. */
  untested: z.array(UntestedSchema),
  cases: z.array(CaseRecordSchema).default([]),
  summary: z.object({
    toolsDiscovered: z.number().int().nonnegative(),
    toolsExercised: z.number().int().nonnegative(),
    conforms: z.number().int().nonnegative(),
    contradicted: z.number().int().nonnegative(),
    undetermined: z.number().int().nonnegative(),
    untested: z.number().int().nonnegative(),
  }),
  startedAt: z.string(),
  finishedAt: z.string(),
  /** Over the record with this field set to ''. Recomputable from the file. */
  recordHash: z.string().default(''),
});
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;

/**
 * The sentence every record carries.
 *
 * Docker's daemon runs as root on most installations, so a process that
 * escapes a container is on the host as root. We reduce blast radius; we do not
 * claim to prevent escape, and a record that quietly omitted this would be
 * making exactly the kind of unverified claim this product exists to catch.
 */
export const ROOTFUL_DAEMON_CAVEAT =
  'The container runtime daemon runs as root. RigorRun reduces blast radius but does ' +
  'not claim to prevent a container escape; an escape reaches the host.';

export const SERVER_READS_CAVEAT =
  'Where a state reading came only from the server’s own tools, it is corroboration ' +
  'and not proof: the server that may be misdeclaring a tool is the one answering the read.';
