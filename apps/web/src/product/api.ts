/**
 * Talking to the runner on this machine.
 *
 * Same origin, so the session cookie travels on its own and there is no token
 * for this code to hold, log or accidentally put in a URL. Every call goes
 * through `request`, which exists so that a failure has exactly one shape: the
 * runner answers errors as `{ error }` with a 4xx, and this turns that into a
 * thrown `Error` carrying the sentence the runner wrote. Screens then have one
 * thing to render rather than a status code to interpret.
 */
export interface NextStep {
  id: string;
  what: string;
  why: string;
}

/**
 * A project directory that is there and will not open.
 *
 * Shown rather than filtered out: a project that vanishes from this list looks
 * exactly like a project that was never saved, and the two need very different
 * responses from the person looking at the screen.
 */
export interface BrokenProjectView {
  id: string;
  reason: 'unreadable' | 'not-json' | 'invalid' | 'too-new';
  detail: string;
}

export interface ProjectView {
  id: string;
  name: string;
  goal: string;
  safety: 'production' | 'staging' | 'local' | 'ephemeral';
  connector:
    | {
        kind: 'mcp';
        transport: 'stdio' | 'http';
        command: string;
        args: string[];
        url: string;
        /** How an HTTP server is authenticated to. Ignored for stdio. */
        auth: 'header' | 'oauth';
        secretNames: string[];
      }
    | {
        kind: 'openapi';
        /** Empty in a summary — the document lives on the runner. */
        spec: string;
        /** How big it is, so the form can say so without carrying it. */
        specBytes?: number;
        specUrl: string;
        baseUrl: string;
        /** Header name to secret name. Never a value. */
        headers: Record<string, string>;
        /** Secret names for a client id and secret, or nothing. Never values. */
        oauth: {
          tokenUrl: string;
          clientIdSecret: string;
          clientSecretSecret: string;
          scope: string;
        } | null;
        secretNames: string[];
      }
    | {
        kind: 'browser';
        startUrl: string;
        browser: 'chromium' | 'firefox' | 'webkit';
        headless: boolean;
        /** Never another browser: a page cannot verify itself. */
        verifier: { kind: 'mcp' | 'openapi' } | null;
        secretNames: string[];
      }
    | null;
  readOnlyTools: string[];
  verifierReads: { tool: string; args: Record<string, unknown> }[];
  reset: { kind: 'tool' | 'none'; tool: string };
  schemaAnswers: { questionId: string; value: string }[];
  agents: ({
    id: string;
    name: string;
    lastProbeOk: boolean;
    lastProbeProblem: string;
    lastProbeAt: string | null;
  } & (
    | { kind: 'http'; endpoint: string }
    | { kind: 'process'; command: string; args: string[] }
    // An agent RigorRun cannot start. It holds a key and comes to ask for work.
    | { kind: 'external'; keyName: string }
  ))[];
  runs: {
    runId: string;
    agentName: string;
    finishedAt: string;
    taskSuccessRate: number;
    policyComplianceRate: number;
    unsafeActions: number;
    thresholdsPassed: boolean;
    verification: string;
    isolation: string;
    caseCount: number;
  }[];
  baselineRunId: string | null;
  timings: Record<string, string | null>;
  nextSteps: NextStep[];
  timeToFirstVerdictMs: number | null;
}

export interface ToolView {
  name: string;
  description: string;
  params: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'enum' | 'timestamp';
    required: boolean;
    enumValues?: string[];
    description?: string;
  }[];
  unsupported: { name: string; reason: string }[];
  hints: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean };
  risk: { level: 'read' | 'write' | 'destructive' | 'unknown'; source: string; rationale: string };
  hasOutputSchema: boolean;
}

export interface DiscoveryView {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  discoveredAt: string;
  latencyMs: number;
  tools: ToolView[];
}

export interface DriftView {
  unchanged: boolean;
  drifts: { kind: string; tool: string; detail: string; serious: boolean }[];
  serious: { kind: string; tool: string; detail: string; serious: boolean }[];
}

export interface ActivationView {
  reached: string | null;
  reachedIndex: number;
  stages: { stage: string; code: string; at: string }[];
  humanMsToFirstVerdict: number | null;
  attempts: Record<string, number>;
}

/**
 * A claim this system made about itself that its own behaviour contradicted.
 *
 * Never acted on — RigorRun already treats every unconfirmed tool as writing,
 * so nothing about the run changes. It changes what the person is told, which
 * is what matters: a system that says a tool only reads and then changes state
 * is either wrong about itself or describing itself conveniently.
 */
export interface AnnotationMismatchView {
  tool: string;
  claimed: string;
  observed: string;
}

export interface SchemaQuestionView {
  id: string;
  kind: string;
  entity: string;
  field?: string;
  text: string;
  evidence: string;
  proposed: string;
  options: string[];
  confidence: 'strong' | 'moderate' | 'weak';
}

export interface RuleView {
  id: string;
  statement: string;
  status: string;
  template: string;
  question?: { text: string } | null;
}

export interface CaseView {
  id: string;
  name: string;
  category: string;
}

export interface RunView {
  runId: string;
  finishedAt: string;
  verification: string;
  isolation: string;
  limits: { id: string; limit: string; remedy: string }[];
  notTestable: { rule: string; reason: string }[];
  verdict: { winnerAgentId: string | null; summary: string; rationale: string[] };
  scores: {
    agentId: string;
    agentName: string;
    taskSuccessRate: number;
    policyComplianceRate: number;
    unsafeActions: number;
    thresholdsPassed: boolean;
  }[];
  caseResults: CaseResultView[];
}

/** A case, and the evidence for what it says. */
export interface CaseResultView {
  caseId: string;
  caseName: string;
  category: string;
  taskSuccess: boolean;
  policyCompliant: boolean;
  unsafeActions: number;
  durationMs: number;
  steps: { tool: string; args: Record<string, unknown>; ok: boolean; error: string }[];
  stepsOmitted: number;
  finalState: Record<string, unknown>;
  checks: {
    description: string;
    status: 'PASS' | 'FAIL' | 'ERROR' | 'INAPPLICABLE';
    message: string;
    verificationSource: 'STATE' | 'EVENT' | 'OUTPUT' | 'HUMAN' | 'MODEL' | 'DECLARED';
    evaluator: string;
    unsafe: boolean;
    blocking: boolean;
    expected?: unknown;
    observed?: unknown;
  }[];
  agentReport: string;
  error: string;
}

/**
 * What the suite is worth, measured before an agent is measured with it.
 *
 * A benchmark that cannot tell a good agent from a bad one produces a confident
 * verdict about nothing.
 */
export interface QualityView {
  cases: number;
  /** Fraction of injected defects the suite caught. */
  mutantKillRate: number;
  /** The same, counting only defects the rules never mention. */
  independentKillRate: number;
  mutants: { id: string; defect: string; expectation: string; caught: boolean }[];
  /** Rules no case exercises. A suite defect, not an agent one. */
  deadRules: string[];
  /** Rules applicable everywhere and violated nowhere. */
  nonDiscriminatingRules: string[];
  replayStable: boolean;
  hiddenAnswerIsolated: boolean;
}

/** A trace of something that already happened, as RigorRun read it. */
export interface ImportedTraceView {
  traceId: string;
  name: string;
  durationMs: number;
  calls: { tool: string; args: Record<string, unknown>; ok: boolean; error?: string; recognisedBy: string }[];
  failures: { name: string; message: string }[];
  /** Spans it did not understand. Reported rather than hidden. */
  unrecognised: number;
  model: string;
}

export interface ComparisonView {
  comparable: boolean;
  incomparableReason: string;
  headline: string;
  regressed: { caseId: string; caseName: string; detail: string }[];
  improved: { caseId: string; caseName: string; detail: string }[];
  unchanged: { caseId: string }[];
  added: { caseId: string; caseName: string }[];
  removed: { caseId: string; caseName: string }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // The runner always answers JSON. Anything else means the request never
    // reached it — a stale tab against a stopped runner, most likely.
    throw new Error('The runner is not answering. Is it still running?');
  }
  if (!response.ok) {
    const detail = body as { error?: string; detail?: string };
    throw new Error(detail.detail ?? detail.error ?? `The runner answered ${response.status}.`);
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** One case, as its driver sees it. */
export interface WaitingView {
  caseId: string;
  index: number;
  total: number;
  task: { instruction: string; inputs: Record<string, unknown>; policyBrief: string };
  mcpUrl: string;
  expiresAt: string;
  maxSteps: number;
}

export const api = {
  /** Whether this page is being served by a runner, and whether it may drive it. */
  async runner(): Promise<{ runner: boolean; paired: boolean; version: string }> {
    try {
      return await request<{ runner: boolean; paired: boolean; version: string }>('/api/runner');
    } catch {
      return { runner: false, paired: false, version: '' };
    }
  },

  projects: () => request<{ projects: ProjectView[]; broken: BrokenProjectView[] }>('/api/projects'),
  createProject: (name: string, goal: string) =>
    post<{ project: ProjectView }>('/api/projects', { name, goal }),
  project: (id: string) =>
    request<{
      project: ProjectView;
      contract: { rules: RuleView[]; observedFacts: { statement: string }[] } | null;
      benchmark: { cases: CaseView[]; notTestable: { rule: string; reason: string }[] } | null;
      // Everything a freshly loaded page needs in order to look like the page
      // that was open before it.
      environment: { connected: boolean; discovery: DiscoveryView | null };
      questions: SchemaQuestionView[];
      recording: { inProgress: boolean; steps: { tool: string; ok: boolean }[] };
      quality: QualityView | null;
      activation: ActivationView;
    }>(`/api/projects/${id}`),

  reconnect: (id: string) =>
    post<{
      project: ProjectView;
      serverName: string;
      latencyMs: number;
      tools: ToolView[];
      drift: DriftView | null;
    }>(`/api/projects/${id}/environment/reconnect`),

  resumeTeaching: (id: string) =>
    post<{ resumed: boolean; steps: { tool: string; ok: boolean }[] }>(
      `/api/projects/${id}/teach/resume`,
    ),

  connect: (id: string, connector: unknown, safety: string) =>
    post<{ project: ProjectView; serverName: string; latencyMs: number; tools: ToolView[] }>(
      `/api/projects/${id}/environment`,
      { connector, safety },
    ),
  configure: (id: string, config: unknown) =>
    post<{ project: ProjectView; readsProblem: string }>(
      `/api/projects/${id}/environment/config`,
      config,
    ),

  startTeaching: (id: string) => post<{ recording: boolean }>(`/api/projects/${id}/teach/start`),
  teachCall: (id: string, tool: string, args: Record<string, unknown>) =>
    post<{ ok: boolean; data?: unknown; error?: string }>(`/api/projects/${id}/teach/call`, {
      tool,
      args,
    }),
  finishTeaching: (id: string) =>
    post<{
      project: ProjectView;
      questions: SchemaQuestionView[];
      mismatches: AnnotationMismatchView[];
    }>(`/api/projects/${id}/teach/finish`),
  answerSchema: (id: string, answers: { questionId: string; value: string }[]) =>
    post<{ project: ProjectView }>(`/api/projects/${id}/schema/answers`, { answers }),

  compile: (id: string) =>
    post<{ contract: { rules: RuleView[]; observedFacts: { statement: string }[] } }>(
      `/api/projects/${id}/compile`,
    ),
  review: (id: string, confirmedRuleIds: string[], rejectedRuleIds: string[]) =>
    post<{ contract: { rules: RuleView[] } }>(`/api/projects/${id}/review`, {
      confirmedRuleIds,
      rejectedRuleIds,
    }),
  generate: (id: string) =>
    post<{ cases: CaseView[]; notTestable: { rule: string; reason: string }[] }>(
      `/api/projects/${id}/benchmark`,
    ),

  addAgent: (
    id: string,
    input:
      | { name: string; endpoint: string }
      | { name: string; command: string; args: string[] }
      | { name: string; driven: true },
  ) =>
    // `key` comes back only for a driven agent, only on this one response.
    post<{ project: ProjectView; agent: ProjectView['agents'][number]; key?: string }>(
      `/api/projects/${id}/agents`,
      input,
    ),
  checkSuite: (id: string) => post<{ quality: QualityView }>(`/api/projects/${id}/quality`),
  reviewTrace: (id: string, trace: string) =>
    post<{ trace: ImportedTraceView }>(`/api/projects/${id}/trace/review`, { trace }),
  addFailure: (id: string, name: string, reason: string, request: Record<string, unknown>) =>
    post<{
      added: { caseId: string; shouldPerform: boolean; refusalReason: string; cases: number };
    }>(`/api/projects/${id}/trace/add`, { name, reason, request }),
  run: (id: string, agentId: string) =>
    post<{ run: RunView }>(`/api/projects/${id}/runs`, { agentId }),
  /** What an agent RigorRun cannot start is being asked to do right now. */
  waiting: (id: string, agentId: string) =>
    request<{ waiting: WaitingView | null; checkedIn: boolean }>(
      `/api/projects/${id}/agents/${agentId}/waiting`,
    ),
  compare: (id: string, runId: string) =>
    request<{ comparison: ComparisonView }>(`/api/projects/${id}/compare/${runId}`),
  setBaseline: (id: string, runId: string) =>
    post<{ project: ProjectView }>(`/api/projects/${id}/baseline`, { runId }),
};
