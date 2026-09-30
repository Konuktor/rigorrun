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
import { BUDGET_MARGIN_MS, DEFAULT_CASE_TIMEOUT_MS, DEFAULT_TOOL_CALL_TIMEOUT_MS } from '@rigorrun/core';

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

const McpConnectorBaseSchema = z.object({
  kind: z.literal('mcp'),
  transport: z.enum(['stdio', 'http']),
  /** For stdio. The binary, never a shell string. */
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  /** For http. */
  url: z.string().default(''),
  /**
   * How an HTTP server is authenticated to.
   *
   * `header` is a static value from the credential store — what most servers
   * behind a gateway want, and what a person can paste. `oauth` is the flow the
   * specification describes: a 401 names an authorization server, somebody
   * approves in a browser, and the tokens live with the other credentials.
   * Ignored for stdio, which authenticates by environment.
   */
  auth: z.enum(['header', 'oauth']).default('header'),
  secretNames,
});

const OpenApiConnectorBaseSchema = z.object({
  kind: z.literal('openapi'),
  /** The document itself, kept whole so a run does not depend on a URL. */
  spec: z.string().max(8_000_000).default(''),
  /** Where it was fetched from, for reconnecting and for saying so. */
  specUrl: z.string().default(''),
  /** Where the API actually is. Whatever `servers` claims is a suggestion. */
  baseUrl: z.string().default(''),
  /** Header name to secret name, so a token is never in the project. */
  headers: z.record(z.string(), z.string()).default({}),
  /**
   * A client id and secret to exchange for a token, when the API wants one.
   *
   * Secret *names*, like everything else here. The token URL is read out of
   * the document's `securitySchemes` rather than typed, because the document
   * already declares it and a field copied from a PDF is a field to get wrong.
   *
   * Only `client_credentials`. The other OAuth flows all end in a browser, and
   * an API whose only flow is a browser is one RigorRun should say it cannot
   * sign in to rather than half-attempt.
   */
  oauth: z
    .object({
      tokenUrl: z.string(),
      clientIdSecret: z.string(),
      clientSecretSecret: z.string(),
      scope: z.string().default(''),
    })
    .nullable()
    .default(null),
  secretNames,
});

/**
 * A second connection to the same system, used only for the verdict.
 *
 * The same shapes a project connects with, minus a verifier of its own. On a
 * browser it is the only way a verdict reaches records; on an MCP server or an
 * OpenAPI document it is what makes a verdict independent of the connection
 * the agent used (audit R-2). Its tools are nominated as `verifier:<tool>`.
 */
const VerifierConnectorSchema = z.discriminatedUnion('kind', [McpConnectorBaseSchema, OpenApiConnectorBaseSchema]);

// Optional rather than defaulted on these two, so a project written before a
// verifier existed — or written by hand — needs no new field to be valid.
export const McpConnectorSchema = McpConnectorBaseSchema.extend({
  verifier: VerifierConnectorSchema.nullable().optional(),
});
export const OpenApiConnectorSchema = OpenApiConnectorBaseSchema.extend({
  verifier: VerifierConnectorSchema.nullable().optional(),
});

/** A connector that opens one connection: what a verifier may be. */
export type DirectConnector =
  | z.infer<typeof McpConnectorBaseSchema>
  | z.infer<typeof OpenApiConnectorBaseSchema>;

export const BrowserConnectorSchema = z.object({
  kind: z.literal('browser'),
  /** Where the job starts. Every navigation is checked against its origin. */
  startUrl: z.string(),
  browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  headless: z.boolean().default(true),
  /**
   * Something that can be read for records, or nothing.
   *
   * Deliberately not a browser: a page saying "Refund issued" is a claim by the
   * same system that would have to be wrong for the refund not to exist, so a
   * page cannot verify itself. Without one of these, every verdict from this
   * project says OBSERVATIONAL — RigorRun watched what the agent did and did
   * not check what changed.
   */
  verifier: VerifierConnectorSchema.nullable().default(null),
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
  BrowserConnectorSchema,
]);
export type Connector = z.infer<typeof ConnectorSchema>;
/**
 * A connector as somebody writes one down, before defaults are filled in.
 *
 * What `connectEnvironment` takes, so that adding a field with a sensible
 * default does not become a change every caller has to make.
 */
export type ConnectorInput = z.input<typeof ConnectorSchema>;
export type McpConnector = z.infer<typeof McpConnectorSchema>;
export type OpenApiConnector = z.infer<typeof OpenApiConnectorSchema>;

/**
 * Every credential name this connector needs.
 *
 * Derived rather than typed twice. A client id named in one place and expected
 * to be repeated in a list is a person setting up a project correctly and
 * being told their credential is missing when it is sitting right there.
 */
export function secretNamesOf(connector: Connector | DirectConnector): string[] {
  const names = [...connector.secretNames];
  if (connector.kind === 'openapi' && connector.oauth) {
    names.push(connector.oauth.clientIdSecret, connector.oauth.clientSecretSecret);
  }
  if ('verifier' in connector && connector.verifier) {
    names.push(...secretNamesOf(connector.verifier));
  }
  return [...new Set(names.filter((name) => name.length > 0))];
}

/** One line naming what a project connects to, for a list or a diagnostic. */
export function describeConnector(connector: Connector | null): string {
  if (!connector) return 'not connected';
  const verified = connector.kind !== 'browser' && connector.verifier ? ' · independently verified' : '';
  if (connector.kind === 'mcp') {
    return (
      (connector.transport === 'http' && connector.auth === 'oauth'
        ? 'MCP · http · signed in'
        : `MCP · ${connector.transport}`) + verified
    );
  }
  if (connector.kind === 'openapi') return `OpenAPI${verified}`;
  return connector.verifier ? 'Browser · verified' : 'Browser · observed only';
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
  const own = describeOneConnectorAction(connector);
  // Opening a project with a verifier runs two things. The confirmation for an
  // imported project has to name both, or it is not the whole truth.
  if (connector.kind !== 'browser' && connector.verifier) {
    return `${own}, and ${describeOneConnectorAction(connector.verifier)} to check the result`;
  }
  return own;
}

function describeOneConnectorAction(connector: Connector | DirectConnector): string {
  if (connector.kind === 'browser') {
    return `open a browser at ${connector.startUrl}`;
  }
  if (connector.kind === 'openapi') {
    return `send requests to ${connector.baseUrl || 'an address in the document'}`;
  }
  if (connector.transport === 'stdio') {
    return `run \`${[connector.command, ...connector.args].join(' ').trim()}\``;
  }
  // Somebody confirming an imported project should know it will send them to
  // sign in, not merely that an address gets opened.
  return connector.auth === 'oauth'
    ? `open ${connector.url}, and sign in to it in a browser if it asks`
    : `open ${connector.url}`;
}

export const VerifierReadSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});

/** What is known about an agent whether it is a URL or a command. */
const agentCommon = {
  id: z.string(),
  name: z.string(),
  /** When the last successful handshake happened, and what it said. */
  lastProbeAt: z.string().nullable().default(null),
  lastProbeOk: z.boolean().default(false),
  lastProbeProblem: z.string().default(''),
};

export const HttpAgentSchema = z.object({
  ...agentCommon,
  kind: z.literal('http'),
  endpoint: z.string(),
});

export const ProcessAgentSchema = z.object({
  ...agentCommon,
  kind: z.literal('process'),
  /** The executable. Written here only by a person, at this machine. */
  command: z.string(),
  args: z.array(z.string()).default([]),
  cwd: z.string().default(''),
  /**
   * When somebody looked at that command and said yes.
   *
   * Null on an imported project, always, whatever the file claimed — see
   * `connectorTrust`. A command that arrived in a file is not a command
   * anybody on this machine has agreed to run.
   */
  confirmedByOperatorAt: z.string().nullable().default(null),
});

/**
 * An agent, as a tagged union.
 *
 * This was one flat object with `endpoint`, `command` and `args` on every
 * agent, and the hole that left is worth spelling out: a `project.json` written
 * by somebody else could set `command` on an agent marked `kind: 'http'`, and
 * `parseProject` would carry it through intact. Nothing read it — but "nothing
 * reads it" is a property of today's code, and the field was one forgotten
 * branch away from being the way a command arrives from a file.
 *
 * Narrowing on `kind` makes it unrepresentable: an HTTP agent has no `command`
 * to set, so a hostile file has nowhere to put one.
 */
export const ExternalAgentSchema = z.object({
  ...agentCommon,
  kind: z.literal('external'),
  /**
   * The name of the credential holding this agent's key.
   *
   * The name, not the key. An external agent is the one kind whose
   * configuration would otherwise carry something worth stealing, and a project
   * file that cannot be copied safely would undo the arrangement the rest of
   * this file is built on.
   */
  keyName: z.string(),
});

/**
 * An agent RigorRun only sends work to, and never watches — see `blackBoxAgent.ts`.
 *
 * The one kind that may live off this machine, which is why the fields that
 * decide where a case's work goes are explicit: the exact hosts, the headers by
 * secret name (never by value), and when a person here agreed to send it.
 */
export const BlackBoxAgentSchema = z.object({
  ...agentCommon,
  kind: z.literal('blackbox'),
  endpoint: z.string(),
  /** Header name → the name of the secret holding its value. */
  headers: z.record(z.string(), z.string()).default({}),
  /** A JSON body with `{{placeholders}}`; null sends the rigorrun/task/1 envelope. */
  bodyTemplate: z.string().nullable().default(null),
  completion: z.enum(['response', 'poll', 'settle']).default('response'),
  /** Where the agent's final message is in its answer, as a dotted path. */
  claimPath: z.string().default('output'),
  /** Hosts outside loopback it may be reached on. Exact names; https only. */
  allowedHosts: z.array(z.string()).default([]),
  /**
   * When somebody on this machine agreed that each case's work may be sent to
   * those hosts. Null on an imported project, always, like every other
   * decision about where things go that arrived in a file.
   */
  remoteConfirmedAt: z.string().nullable().default(null),
  settleQuietMs: z.number().int().positive().default(5000),
});

export const AgentConfigSchema = z.discriminatedUnion('kind', [
  HttpAgentSchema,
  ProcessAgentSchema,
  ExternalAgentSchema,
  BlackBoxAgentSchema,
]);
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type HttpAgentConfig = z.infer<typeof HttpAgentSchema>;
export type ProcessAgentConfigured = z.infer<typeof ProcessAgentSchema>;

/** How to reach this agent, in one line. */
export function describeAgent(agent: AgentConfig): string {
  if (agent.kind === 'http') return agent.endpoint;
  // Not reached: RigorRun does not reach this one, which is the whole point of
  // it. The id is what distinguishes two of them on the same project.
  if (agent.kind === 'external') return `driven by you (${agent.id})`;
  if (agent.kind === 'blackbox') return `${agent.endpoint} (black box)`;
  return `${agent.command} ${agent.args.join(' ')}`.trim();
}

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

/**
 * How long things may take, for this project. See the budget hierarchy in
 * `@rigorrun/core`. Defaulted so a project written before budgets existed
 * parses with the defaults.
 */
export const BudgetsSchema = z.object({
  /** How long one tool call may wait for its answer. */
  toolCallMs: z.number().int().positive().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  /** How long one case may take, end to end. */
  caseMs: z.number().int().positive().default(DEFAULT_CASE_TIMEOUT_MS),
});
export type Budgets = z.infer<typeof BudgetsSchema>;

/**
 * Why a budget cannot work, or null.
 *
 * A case that cannot outlast one call that never answers cannot observe what
 * an agent does about a lost response — the audit's retry case died this way —
 * so the configuration is refused rather than accepted and silently useless.
 */
export function budgetProblem(budgets: Budgets): string | null {
  if (budgets.caseMs < budgets.toolCallMs + BUDGET_MARGIN_MS) {
    return (
      `A case budget of ${budgets.caseMs} ms cannot outlast one tool call that times out at ` +
      `${budgets.toolCallMs} ms and leave the agent time to respond to it. Give each case at least ` +
      `${budgets.toolCallMs + BUDGET_MARGIN_MS} ms, or shorten the tool-call timeout.`
    );
  }
  return null;
}

export const SafetySchema = z.enum(['production', 'staging', 'local', 'ephemeral']);

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  /** What the person is trying to prove an agent can do. */
  goal: z.string().default(''),
  connector: ConnectorSchema.nullable().default(null),
  /**
   * production / staging / local / ephemeral. Decides what may be written.
   *
   * The default only fills in projects saved before the field existed; every
   * way of connecting a system now requires the person to choose.
   */
  safety: SafetySchema.default('staging'),
  /** Tools a person has confirmed only read. Never the server's own opinion. */
  readOnlyTools: z.array(z.string()).default([]),
  verifierReads: z.array(VerifierReadSchema).default([]),
  budgets: BudgetsSchema.default({
    toolCallMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
    caseMs: DEFAULT_CASE_TIMEOUT_MS,
  }),
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
    budgets: { toolCallMs: DEFAULT_TOOL_CALL_TIMEOUT_MS, caseMs: DEFAULT_CASE_TIMEOUT_MS },
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
