/**
 * A project: the thing a person actually has.
 *
 * Everything RigorRun could do before this existed, it could do to a file you
 * passed it. That is a fine shape for a pipeline and a hopeless shape for a
 * product, because the work of connecting a system and teaching it a job is
 * worth keeping and a `--workflow` flag keeps nothing. A project is where that
 * work lives between sessions.
 *
 * The split that runs through this file is which half of it may leave the
 * machine. Credentials, raw traces and state snapshots are the customer's
 * business; a project's name, the shape of its contract and a sanitised result
 * are the parts that could be shared if somebody chose to. Keeping them in
 * separate files rather than separate fields is deliberate — a field can be
 * forgotten in a serialiser, a file has to be opened on purpose.
 */
import { z } from 'zod';

export const PROJECT_SCHEMA_VERSION = 1;

/** How this project reaches the system under test. */
export const ConnectorSchema = z.object({
  kind: z.literal('mcp'),
  transport: z.enum(['stdio', 'http']),
  /** For stdio. The binary, never a shell string. */
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  /** For http. */
  url: z.string().default(''),
  /**
   * Names of the environment variables and headers this connector needs.
   *
   * The *names* live here and the values live in the secret store. That way a
   * project file can be read, copied or supported without carrying a
   * credential, and RigorRun can still say exactly what is missing when it is.
   */
  secretNames: z.array(z.string()).default([]),
});
export type Connector = z.infer<typeof ConnectorSchema>;

export const VerifierReadSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  entity: z.string(),
});

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['http', 'process']),
  /** For http agents. */
  endpoint: z.string().default(''),
  /** For process agents. Only ever written here by a person. */
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  /** When the last successful handshake happened, and what it said. */
  lastProbeAt: z.string().nullable().default(null),
  lastProbeOk: z.boolean().default(false),
  lastProbeProblem: z.string().default(''),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const RunSummarySchema = z.object({
  runId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  finishedAt: z.string(),
  taskSuccessRate: z.number(),
  policyComplianceRate: z.number(),
  unsafeActions: z.number(),
  criticalFailures: z.number(),
  thresholdsPassed: z.boolean(),
  verification: z.string(),
  isolation: z.string(),
  caseCount: z.number(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

/**
 * The clock that matters.
 *
 * Time to first real verdict, measured from the moment somebody made a project
 * to the moment they got a pass or fail from their own agent against their own
 * system. Recorded here rather than computed later because the only honest
 * version of this number is the one taken while it was happening.
 */
export const TimingsSchema = z.object({
  createdAt: z.string(),
  environmentConnectedAt: z.string().nullable().default(null),
  workflowRecordedAt: z.string().nullable().default(null),
  benchmarkGeneratedAt: z.string().nullable().default(null),
  agentConnectedAt: z.string().nullable().default(null),
  firstVerdictAt: z.string().nullable().default(null),
});
export type Timings = z.infer<typeof TimingsSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  /** What the person is trying to prove an agent can do. */
  goal: z.string().default(''),
  connector: ConnectorSchema.nullable().default(null),
  /** production / staging / local / ephemeral. Decides what may be written. */
  safety: z.enum(['production', 'staging', 'local', 'ephemeral']).default('staging'),
  /** Tools a person has confirmed only read. Never the server's own opinion. */
  readOnlyTools: z.array(z.string()).default([]),
  verifierReads: z.array(VerifierReadSchema).default([]),
  reset: z
    .object({ kind: z.enum(['tool', 'none']), tool: z.string().default('') })
    .default({ kind: 'none', tool: '' }),
  /** Answers to the schema questions, so a review survives a restart. */
  schemaAnswers: z.array(z.object({ questionId: z.string(), value: z.string() })).default([]),
  agents: z.array(AgentConfigSchema).default([]),
  runs: z.array(RunSummarySchema).default([]),
  timings: TimingsSchema,
  /** The run a later run is compared against, once somebody sets one. */
  baselineRunId: z.string().nullable().default(null),
});
export type Project = z.infer<typeof ProjectSchema>;

export function parseProject(input: unknown): Project {
  return ProjectSchema.parse(input);
}

export function newProject(input: { id: string; name: string; goal?: string; now: string }): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    goal: input.goal ?? '',
    timings: { createdAt: input.now },
  });
}

/** Milliseconds from creating a project to its first pass or fail, if it has one. */
export function timeToFirstVerdictMs(project: Project): number | null {
  const { createdAt, firstVerdictAt } = project.timings;
  if (!firstVerdictAt) return null;
  return Date.parse(firstVerdictAt) - Date.parse(createdAt);
}

/**
 * What still has to happen before this project can produce a verdict.
 *
 * The list a person is shown when they open a project, and the thing that
 * stops the product ever being a screen with a disabled button and no
 * explanation. Ordered, because they genuinely do depend on each other.
 */
export interface NextStep {
  id: string;
  what: string;
  why: string;
}

export function nextSteps(project: Project): NextStep[] {
  const steps: NextStep[] = [];
  if (!project.connector) {
    steps.push({
      id: 'connect_environment',
      what: 'Connect the system your agent will work in.',
      why: 'Without it there is nothing to read back, so nothing can be verified.',
    });
    return steps;
  }
  if (project.verifierReads.length === 0) {
    steps.push({
      id: 'nominate_reads',
      what: 'Say which operations read the records you care about.',
      why: 'These are the calls RigorRun makes after your agent finishes, to find out what actually happened.',
    });
  }
  if (project.timings.workflowRecordedAt === null) {
    steps.push({
      id: 'teach_a_job',
      what: 'Do the job once, so RigorRun can watch.',
      why: 'The contract is derived from a real execution rather than written by hand.',
    });
  }
  if (project.timings.benchmarkGeneratedAt === null) {
    steps.push({
      id: 'generate',
      what: 'Review what RigorRun learned, then generate the suite.',
      why: 'Nothing RigorRun merely inferred can fail an agent until you have confirmed it.',
    });
  }
  if (project.agents.length === 0) {
    steps.push({
      id: 'connect_agent',
      what: 'Connect the agent you want to test.',
      why: 'Your benchmark is ready; it needs something to run against.',
    });
  }
  return steps;
}
