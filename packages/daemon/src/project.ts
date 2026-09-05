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

/**
 * Names of the credentials a connector needs.
 *
 * The *names* live in the project and the values live in the secret store.
 * That way a project file can be read, copied or attached to a support request
 * without carrying a credential, and RigorRun can still say exactly what is
 * missing when it is.
 */
const secretNames = z.array(z.string()).default([]);

export const McpConnectorSchema = z.object({
  kind: z.literal('mcp'),
  transport: z.enum(['stdio', 'http']),
  /** For stdio. The binary, never a shell string. */
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  /** For http. */
  url: z.string().default(''),
  secretNames,
});

export const OpenApiConnectorSchema = z.object({
  kind: z.literal('openapi'),
  /** The document itself, kept whole so a run does not depend on a URL. */
  spec: z.string().max(8_000_000).default(''),
  /** Where it was fetched from, for reconnecting and for saying so. */
  specUrl: z.string().default(''),
  /** Where the API actually is. Whatever `servers` claims is a suggestion. */
  baseUrl: z.string().default(''),
  /** Header name to secret name, so a token is never in the project. */
  headers: z.record(z.string(), z.string()).default({}),
  secretNames,
});

/**
 * How this project reaches the system under test.
 *
 * A tagged union rather than one object with every field on it. The flat shape
 * meant an OpenAPI connector still carried `command` and `args`, which is the
 * same latent hole an agent config had: a field that should not exist on this
 * kind of thing, present and parseable, one forgotten branch away from being
 * used. Narrowing on `kind` makes that unrepresentable rather than merely
 * unlikely.
 */
export const ConnectorSchema = z.discriminatedUnion('kind', [
  McpConnectorSchema,
  OpenApiConnectorSchema,
]);
export type Connector = z.infer<typeof ConnectorSchema>;
export type McpConnector = z.infer<typeof McpConnectorSchema>;
export type OpenApiConnector = z.infer<typeof OpenApiConnectorSchema>;

/** One line naming what a project connects to, for a list or a diagnostic. */
export function describeConnector(connector: Connector | null): string {
  if (!connector) return 'not connected';
  return connector.kind === 'mcp' ? `MCP · ${connector.transport}` : 'OpenAPI';
}

/**
 * What opening this connector would actually do, in one line.
 *
 * Shown before somebody trusts an imported project, so it has to be the whole
 * truth: the command that will run, or the address that will be opened with
 * their credentials attached. Anything vaguer is a confirmation dialogue
 * nobody can act on.
 */
export function describeConnectorAction(connector: Connector): string {
  if (connector.kind === 'openapi') {
    return `send requests to ${connector.baseUrl || 'an address in the document'}`;
  }
  return connector.transport === 'stdio'
    ? `run \`${[connector.command, ...connector.args].join(' ').trim()}\``
    : `open ${connector.url}`;
}

export const VerifierReadSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
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
  /**
   * Where this project's connector came from, and whether anybody has looked.
   *
   * A connector says what command to run or what URL to open with your
   * credentials. When you typed it, you already decided. When it arrived in a
   * file somebody sent you, you have not — so an imported project will not
   * connect until it is confirmed, and the confirmation screen shows the
   * command in full.
   *
   * Defaulted rather than migrated: a project that predates this field was
   * typed by whoever owns the machine it is on, which is exactly what `typed`
   * means.
   */
  connectorTrust: z
    .object({
      origin: z.enum(['typed', 'imported']).default('typed'),
      confirmedAt: z.string().nullable().default(null),
    })
    .default({ origin: 'typed', confirmedAt: null }),
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
      what: 'Connect the system your agent works in.',
      why: 'Without it there is nothing to look at afterwards, so no result could be trusted.',
    });
    return steps;
  }
  if (project.verifierReads.length === 0) {
    steps.push({
      id: 'nominate_reads',
      what: 'Say which of your tools RigorRun can use to check what happened.',
      why: 'It calls them after your agent finishes, to look at your system rather than believe the agent.',
    });
  }
  if (project.timings.workflowRecordedAt === null) {
    steps.push({
      id: 'teach_a_job',
      what: 'Do the job once, so RigorRun can watch.',
      why: 'The rules come from something that really happened rather than from something somebody wrote down.',
    });
  }
  if (project.timings.benchmarkGeneratedAt === null) {
    steps.push({
      id: 'generate',
      what: 'Check what RigorRun worked out, then build the tests.',
      why: 'Nothing it only guessed can fail your agent until you have said yes to it.',
    });
  }
  if (project.agents.length === 0) {
    steps.push({
      id: 'connect_agent',
      what: 'Connect the agent you want to test.',
      why: 'Your tests are ready and nothing is missing except something to run them against.',
    });
  }
  return steps;
}
