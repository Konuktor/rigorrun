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

export interface ProjectView {
  id: string;
  name: string;
  goal: string;
  safety: 'production' | 'staging' | 'local' | 'ephemeral';
  connector: {
    transport: 'stdio' | 'http';
    command: string;
    args: string[];
    url: string;
    secretNames: string[];
  } | null;
  readOnlyTools: string[];
  verifierReads: { tool: string; args: Record<string, unknown> }[];
  reset: { kind: 'tool' | 'none'; tool: string };
  schemaAnswers: { questionId: string; value: string }[];
  agents: {
    id: string;
    name: string;
    endpoint: string;
    lastProbeOk: boolean;
    lastProbeProblem: string;
    lastProbeAt: string | null;
  }[];
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
  caseResults: {
    caseId: string;
    caseName: string;
    category: string;
    taskSuccess: boolean;
    policyCompliant: boolean;
    unsafeActions: number;
    durationMs: number;
  }[];
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

export const api = {
  /** Whether this page is being served by a runner, and whether it may drive it. */
  async runner(): Promise<{ runner: boolean; paired: boolean }> {
    try {
      return await request<{ runner: boolean; paired: boolean }>('/api/runner');
    } catch {
      return { runner: false, paired: false };
    }
  },

  projects: () => request<{ projects: ProjectView[] }>('/api/projects'),
  createProject: (name: string, goal: string) =>
    post<{ project: ProjectView }>('/api/projects', { name, goal }),
  project: (id: string) =>
    request<{
      project: ProjectView;
      contract: { rules: RuleView[]; observedFacts: { statement: string }[] } | null;
      benchmark: { cases: CaseView[]; notTestable: { rule: string; reason: string }[] } | null;
    }>(`/api/projects/${id}`),

  connect: (id: string, connector: unknown, safety: string) =>
    post<{ project: ProjectView; serverName: string; latencyMs: number; tools: ToolView[] }>(
      `/api/projects/${id}/environment`,
      { connector, safety },
    ),
  configure: (id: string, config: unknown) =>
    post<{ project: ProjectView }>(`/api/projects/${id}/environment/config`, config),

  startTeaching: (id: string) => post<{ recording: boolean }>(`/api/projects/${id}/teach/start`),
  teachCall: (id: string, tool: string, args: Record<string, unknown>) =>
    post<{ ok: boolean; data?: unknown; error?: string }>(`/api/projects/${id}/teach/call`, {
      tool,
      args,
    }),
  finishTeaching: (id: string) =>
    post<{ project: ProjectView; questions: SchemaQuestionView[] }>(
      `/api/projects/${id}/teach/finish`,
    ),
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

  addAgent: (id: string, name: string, endpoint: string) =>
    post<{ project: ProjectView; agent: ProjectView['agents'][number] }>(
      `/api/projects/${id}/agents`,
      { name, endpoint },
    ),
  run: (id: string, agentId: string) =>
    post<{ run: RunView }>(`/api/projects/${id}/runs`, { agentId }),
  compare: (id: string, runId: string) =>
    request<{ comparison: ComparisonView }>(`/api/projects/${id}/compare/${runId}`),
  setBaseline: (id: string, runId: string) =>
    post<{ project: ProjectView }>(`/api/projects/${id}/baseline`, { runId }),
};
