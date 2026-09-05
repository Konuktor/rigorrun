/**
 * A bundle somebody can send us when it goes wrong.
 *
 * The situation this exists for: a stranger tried RigorRun, it did not work,
 * and neither of us can see what the other sees. Without something like this
 * the exchange is a week of "what does it say?" — and the alternative people
 * reach for is pasting a terminal, which is how credentials end up in an issue
 * tracker.
 *
 * So the rule here is inverted from everywhere else in the codebase. Instead of
 * collecting what is useful and removing what is sensitive, this collects an
 * explicit list and nothing else. A field that is not named below cannot appear
 * in the output, whatever gets added to a project later — because the bundle is
 * built by naming fields, never by copying an object and deleting from it.
 *
 * Never included, and there is no flag: credentials, tool arguments, tool
 * results, record or field names, project names, goals, commands, URLs,
 * hostnames, file paths, traces, contracts, benchmarks, run results.
 *
 * What that costs: we cannot tell from a bundle *what* somebody was testing.
 * That is the correct trade. Knowing that a connection failed at the handshake,
 * on a stdio connector, on Node 20, after two retries, is enough to start.
 */
import { readFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import type { ActivationSummary } from './activation.ts';
import { ActivationLog } from './activation.ts';
import type { Project } from './project.ts';
import type { ProjectStore } from './store.ts';
import { readWorkspaceMeta } from './workspaceVersion.ts';

export const FEEDBACK_FORMAT = 1;

/** One project, described without describing anybody's business. */
export interface ProjectShape {
  /** An opaque id. Meaningless outside this machine, and stable across a bundle. */
  id: string;
  /** `mcp:stdio`, `mcp:http`, or `none`. Never the command or the URL. */
  connector: string;
  safety: Project['safety'];
  /** Whether credentials are configured. Never how many, never which. */
  usesCredentials: boolean;
  counts: {
    toolsDiscovered: number;
    toolsMarkedReadOnly: number;
    verifierReads: number;
    schemaQuestions: number;
    schemaQuestionsAnswered: number;
    contractRules: number;
    benchmarkCases: number;
    notTestable: number;
    agents: number;
    agentsAnswering: number;
    runs: number;
  };
  /** Which of the six steps this project has reached. */
  stagesReached: string[];
  hasReset: boolean;
  /** From the last run, if there was one. Labels, never numbers about content. */
  lastRun: { verification: string; isolation: string; passed: boolean } | null;
}

export interface FeedbackBundle {
  format: number;
  generatedAt: string;
  rigorrun: { version: string };
  machine: {
    os: string;
    osRelease: string;
    arch: string;
    node: string;
  };
  workspace: { format: number | null; ageDays: number | null };
  activation: ActivationSummary;
  projects: ProjectShape[];
  /**
   * Errors, as classes.
   *
   * The activation log records what kind of thing failed and how often. A
   * message would carry a hostname or a path, so there are no messages.
   */
  problems: Record<string, number>;
  /** Said in the bundle itself, so whoever receives it knows the rules too. */
  omitted: string[];
}

const OMITTED = [
  'credentials and secret values',
  'tool arguments and tool results',
  'record, field and tool names',
  'project names and goals',
  'commands, URLs, hostnames and file paths',
  'recordings, contracts, benchmarks and run results',
];

export async function buildFeedbackBundle(input: {
  store: ProjectStore;
  version: string;
  now?: () => Date;
}): Promise<FeedbackBundle> {
  const now = input.now ?? (() => new Date());
  const activation = new ActivationLog(input.store.path, now);
  const summary = await activation.summary();
  const meta = await readWorkspaceMeta(input.store.path);
  const secretsConfigured = Object.keys(await input.store.secrets().catch(() => ({}))).length > 0;

  const projects: ProjectShape[] = [];
  for (const project of await input.store.list().catch(() => [])) {
    projects.push(await shapeOf(input.store, project, secretsConfigured));
  }

  return {
    format: FEEDBACK_FORMAT,
    generatedAt: now().toISOString(),
    rigorrun: { version: input.version },
    machine: {
      os: platform(),
      osRelease: release(),
      arch: arch(),
      node: process.versions.node,
    },
    workspace: {
      format: meta?.version ?? null,
      ageDays: meta ? Math.round((now().getTime() - Date.parse(meta.createdAt)) / 86_400_000) : null,
    },
    activation: summary,
    projects,
    problems: summary.attempts,
    omitted: OMITTED,
  };
}

async function shapeOf(
  store: ProjectStore,
  project: Project,
  secretsConfigured: boolean,
): Promise<ProjectShape> {
  const discovery = await store
    .readArtefact<{ tools: unknown[] }>(project.id, 'discovery')
    .catch(() => undefined);
  const induced = await store
    .readArtefact<{ questions: unknown[] }>(project.id, 'induced')
    .catch(() => undefined);
  const contract = await store
    .readArtefact<{ rules: unknown[] }>(project.id, 'contract')
    .catch(() => undefined);
  const benchmark = await store
    .readArtefact<{ cases: unknown[]; notTestable: unknown[] }>(project.id, 'benchmark')
    .catch(() => undefined);

  const stages: string[] = [];
  if (project.connector) stages.push('environment_configured');
  if (project.verifierReads.length > 0) stages.push('reads_nominated');
  if (project.timings.workflowRecordedAt) stages.push('workflow_recorded');
  if (contract) stages.push('contract_compiled');
  if (project.timings.benchmarkGeneratedAt) stages.push('benchmark_built');
  if (project.agents.some((agent) => agent.lastProbeOk)) stages.push('agent_answering');
  if (project.runs.length > 0) stages.push('ran');

  const last = project.runs[project.runs.length - 1];

  return {
    id: project.id,
    connector: project.connector ? `mcp:${project.connector.transport}` : 'none',
    safety: project.safety,
    usesCredentials: secretsConfigured && (project.connector?.secretNames.length ?? 0) > 0,
    counts: {
      toolsDiscovered: discovery?.tools.length ?? 0,
      toolsMarkedReadOnly: project.readOnlyTools.length,
      verifierReads: project.verifierReads.length,
      schemaQuestions: induced?.questions.length ?? 0,
      schemaQuestionsAnswered: project.schemaAnswers.length,
      contractRules: contract?.rules.length ?? 0,
      benchmarkCases: benchmark?.cases.length ?? 0,
      notTestable: benchmark?.notTestable.length ?? 0,
      agents: project.agents.length,
      agentsAnswering: project.agents.filter((agent) => agent.lastProbeOk).length,
      runs: project.runs.length,
    },
    stagesReached: stages,
    hasReset: project.reset.kind === 'tool',
    lastRun: last
      ? {
          verification: last.verification,
          isolation: last.isolation,
          passed: last.thresholdsPassed,
        }
      : null,
  };
}

/**
 * A last line of defence, run over the finished bundle before it is written.
 *
 * The construction above should make this impossible. It runs anyway, because
 * "should be impossible" is what everybody says about the thing that leaks, and
 * the cost of being wrong here is somebody's credential in our inbox.
 */
export function scanForLeaks(bundle: FeedbackBundle, forbidden: readonly string[]): string[] {
  const text = JSON.stringify(bundle);
  const found: string[] = [];
  for (const value of forbidden) {
    if (value.length >= 4 && text.includes(value)) found.push(value.slice(0, 4) + '…');
  }
  // Shapes rather than known values, for anything we were never told about.
  const patterns: [string, RegExp][] = [
    ['an API-key-shaped string', /\b(sk|gsk|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}/],
    ['a JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
    ['a filesystem path', /(^|["\s])(\/(home|Users|root|var|etc)\/)/],
    ['a URL', /\bhttps?:\/\/[^"\s]+/],
  ];
  for (const [what, pattern] of patterns) {
    if (pattern.test(text)) found.push(what);
  }
  return found;
}

/** Reads a file the caller already knows about, for the CLI to attach. */
export async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}
