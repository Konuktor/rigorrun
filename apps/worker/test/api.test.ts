import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index.ts';
import { createTestD1, type TestDatabase } from './d1.ts';

let db: TestDatabase;
const env = () => ({ DB: db as never, RIGORRUN_ENV: 'test', REPORT_RETENTION_DAYS: '30' });

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

async function call(
  path: string,
  init: RequestInit = {},
  auth?: { workspaceId: string; token: string },
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (auth) {
    headers.set('authorization', `Bearer ${auth.token}`);
    headers.set('x-rigorrun-workspace', auth.workspaceId);
  }
  return app.fetch(new Request(`https://rigorrun.test${path}`, { ...init, headers }), env());
}

async function newWorkspace(): Promise<{ workspaceId: string; token: string }> {
  const response = await call('/api/workspaces', { method: 'POST' });
  const body = (await response.json()) as { workspaceId: string; token: string };
  return body;
}

const workflowPayload = {
  id: 'wfc_refund_v1',
  name: 'Standard customer refund',
  goal: 'Issue a valid customer refund',
  environment: 'northstar',
  contractHash: HASH_A,
  ruleCounts: { observed: 5, inferred: 7, confirmed: 12 },
  openQuestions: 6,
  cases: [
    {
      caseId: 'case_standard-refund',
      name: 'Standard refund',
      category: 'happy_path',
      checkCount: 10,
    },
    {
      caseId: 'case_prompt-injection',
      name: 'Injected note',
      category: 'prompt_injection',
      checkCount: 10,
    },
  ],
};

beforeEach(() => {
  db = createTestD1();
});

afterEach(() => {
  db.close();
});

describe('health', () => {
  it('reports what the service does and does not store', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; note: string };
    expect(body.ok).toBe(true);
    expect(body.note).toMatch(/Metadata only/);
  });
});

describe('guest workspaces', () => {
  it('issues an unguessable id and token', async () => {
    const { workspaceId, token } = await newWorkspace();
    expect(workspaceId).toMatch(/^ws_[0-9a-z]{16}$/);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores only a hash of the token, never the token', async () => {
    const { token } = await newWorkspace();
    const row = await db
      .prepare('SELECT secret_hash FROM workspaces')
      .first<{ secret_hash: string }>();
    expect(row?.secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.secret_hash).not.toBe(token);
  });

  it('issues distinct credentials each time', async () => {
    const a = await newWorkspace();
    const b = await newWorkspace();
    expect(a.workspaceId).not.toBe(b.workspaceId);
    expect(a.token).not.toBe(b.token);
  });
});

describe('authentication', () => {
  it('rejects a request with no credentials', async () => {
    const response = await call('/api/workflows', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const { workspaceId } = await newWorkspace();
    const response = await call(
      '/api/workflows',
      { method: 'POST', body: JSON.stringify(workflowPayload) },
      { workspaceId, token: 'f'.repeat(64) },
    );
    expect(response.status).toBe(401);
  });

  it('rejects a valid token against the wrong workspace', async () => {
    const a = await newWorkspace();
    const b = await newWorkspace();
    const response = await call(
      '/api/workflows',
      { method: 'POST', body: JSON.stringify(workflowPayload) },
      { workspaceId: b.workspaceId, token: a.token },
    );
    expect(response.status).toBe(401);
  });
});

describe('workflows', () => {
  it('stores metadata and the case index', async () => {
    const auth = await newWorkspace();
    const created = await call(
      '/api/workflows',
      { method: 'POST', body: JSON.stringify(workflowPayload) },
      auth,
    );
    expect(created.status).toBe(201);

    const fetched = await call('/api/workflows/wfc_refund_v1', {}, auth);
    const body = (await fetched.json()) as {
      workflow: { goal: string; rules_inferred: number; contract_hash: string };
      cases: { case_id: string }[];
    };
    expect(body.workflow.goal).toBe('Issue a valid customer refund');
    expect(body.workflow.rules_inferred).toBe(7);
    expect(body.workflow.contract_hash).toBe(HASH_A);
    expect(body.cases).toHaveLength(2);
  });

  it('upserts rather than duplicating on re-post', async () => {
    const auth = await newWorkspace();
    await call('/api/workflows', { method: 'POST', body: JSON.stringify(workflowPayload) }, auth);
    await call(
      '/api/workflows',
      { method: 'POST', body: JSON.stringify({ ...workflowPayload, name: 'Renamed' }) },
      auth,
    );
    const count = await db.prepare('SELECT COUNT(*) AS n FROM workflows').first<{ n: number }>();
    expect(count?.n).toBe(1);
    const cases = await db
      .prepare('SELECT COUNT(*) AS n FROM benchmark_cases')
      .first<{ n: number }>();
    expect(cases?.n).toBe(2);
  });

  it('never exposes another workspace’s workflow', async () => {
    const owner = await newWorkspace();
    const other = await newWorkspace();
    await call('/api/workflows', { method: 'POST', body: JSON.stringify(workflowPayload) }, owner);
    const response = await call('/api/workflows/wfc_refund_v1', {}, other);
    expect(response.status).toBe(404);
  });

  it('rejects a payload that is not workflow metadata', async () => {
    const auth = await newWorkspace();
    const response = await call(
      '/api/workflows',
      { method: 'POST', body: JSON.stringify({ id: 'x', trace: { events: [] } }) },
      auth,
    );
    expect(response.status).toBe(400);
  });

  it('rejects a malformed contract hash', async () => {
    const auth = await newWorkspace();
    const response = await call(
      '/api/workflows',
      { method: 'POST', body: JSON.stringify({ ...workflowPayload, contractHash: 'nope' }) },
      auth,
    );
    expect(response.status).toBe(400);
  });

  it('deletes a workflow and its cases', async () => {
    const auth = await newWorkspace();
    await call('/api/workflows', { method: 'POST', body: JSON.stringify(workflowPayload) }, auth);
    await call('/api/workflows/wfc_refund_v1', { method: 'DELETE' }, auth);
    const cases = await db
      .prepare('SELECT COUNT(*) AS n FROM benchmark_cases')
      .first<{ n: number }>();
    expect(cases?.n).toBe(0);
  });
});

describe('runs', () => {
  const runPayload = {
    id: 'run_abc123',
    workflowId: 'wfc_refund_v1',
    benchmarkHash: HASH_B,
    contractHash: HASH_A,
    environment: 'northstar',
    agentCount: 2,
    caseCount: 17,
    startedAt: '2026-01-20T09:00:00.000Z',
  };

  const resultsPayload = {
    resultHash: HASH_C,
    finishedAt: '2026-01-20T09:00:04.000Z',
    verdict: 'Agent B wins',
    winnerAgentId: 'demo-robust',
    caseResults: [
      {
        caseId: 'case_standard-refund',
        agentId: 'demo-weak',
        category: 'happy_path',
        taskSuccess: true,
        policyCompliant: true,
        unsafeActions: 0,
        durationMs: 0.4,
      },
      {
        caseId: 'case_prompt-injection',
        agentId: 'demo-weak',
        category: 'prompt_injection',
        taskSuccess: false,
        policyCompliant: false,
        unsafeActions: 1,
        durationMs: 0.6,
      },
      {
        caseId: 'case_prompt-injection',
        agentId: 'demo-robust',
        category: 'prompt_injection',
        taskSuccess: true,
        policyCompliant: true,
        unsafeActions: 0,
        durationMs: 0.5,
      },
    ],
  };

  it('records a run and aggregates its results per agent', async () => {
    const auth = await newWorkspace();
    await call('/api/workflows', { method: 'POST', body: JSON.stringify(workflowPayload) }, auth);
    expect(
      (await call('/api/runs', { method: 'POST', body: JSON.stringify(runPayload) }, auth)).status,
    ).toBe(201);

    const posted = await call(
      '/api/runs/run_abc123/results',
      { method: 'POST', body: JSON.stringify(resultsPayload) },
      auth,
    );
    expect(posted.status).toBe(200);

    const fetched = await call('/api/runs/run_abc123', {}, auth);
    const body = (await fetched.json()) as {
      run: { winner_agent: string; result_hash: string };
      agents: { agent_id: string; cases: number; successes: number; unsafe_actions: number }[];
    };
    expect(body.run.winner_agent).toBe('demo-robust');
    expect(body.run.result_hash).toBe(HASH_C);

    const weak = body.agents.find((a) => a.agent_id === 'demo-weak')!;
    expect(weak.cases).toBe(2);
    expect(weak.successes).toBe(1);
    expect(weak.unsafe_actions).toBe(1);
  });

  it('refuses results for a run in another workspace', async () => {
    const owner = await newWorkspace();
    const other = await newWorkspace();
    await call('/api/runs', { method: 'POST', body: JSON.stringify(runPayload) }, owner);
    const response = await call(
      '/api/runs/run_abc123/results',
      { method: 'POST', body: JSON.stringify(resultsPayload) },
      other,
    );
    expect(response.status).toBe(404);
  });

  it('replaces results rather than accumulating them on re-post', async () => {
    const auth = await newWorkspace();
    await call('/api/runs', { method: 'POST', body: JSON.stringify(runPayload) }, auth);
    await call(
      '/api/runs/run_abc123/results',
      { method: 'POST', body: JSON.stringify(resultsPayload) },
      auth,
    );
    await call(
      '/api/runs/run_abc123/results',
      { method: 'POST', body: JSON.stringify(resultsPayload) },
      auth,
    );
    const count = await db.prepare('SELECT COUNT(*) AS n FROM case_results').first<{ n: number }>();
    expect(count?.n).toBe(3);
  });
});

describe('published reports', () => {
  const publishPayload = {
    runId: 'run_abc123',
    title: 'Refund processing reliability',
    benchmarkHash: HASH_B,
    contractHash: HASH_A,
    caseCategories: ['happy_path', 'prompt_injection'],
    scores: [
      {
        agentId: 'demo-robust',
        agentName: 'Agent B (hardened)',
        n: 17,
        taskSuccessRate: 1,
        taskSuccessLower: 0.8157,
        taskSuccessUpper: 1,
        policyComplianceRate: 1,
        unsafeActions: 0,
        thresholdsPassed: true,
      },
    ],
  };

  it('publishes and reads back without credentials', async () => {
    const auth = await newWorkspace();
    const published = await call(
      '/api/publish',
      { method: 'POST', body: JSON.stringify(publishPayload) },
      auth,
    );
    expect(published.status).toBe(201);
    const { reportId } = (await published.json()) as { reportId: string };

    const fetched = await call(`/api/reports/${reportId}`);
    expect(fetched.status).toBe(200);
    const body = (await fetched.json()) as {
      report: { scores: { agentId: string }[] };
      note: string;
    };
    expect(body.report.scores[0]?.agentId).toBe('demo-robust');
    expect(body.note).toMatch(/Sanitised/);
  });

  it('has no field in which private workflow content could be published', async () => {
    const auth = await newWorkspace();
    const response = await call(
      '/api/publish',
      {
        method: 'POST',
        body: JSON.stringify({
          ...publishPayload,
          agentReport: 'secret',
          traceEvents: [{ url: 'x' }],
        }),
      },
      auth,
    );
    expect(response.status).toBe(201);
    const stored = await db
      .prepare('SELECT payload FROM published_reports')
      .first<{ payload: string }>();
    expect(stored?.payload).not.toContain('secret');
    expect(stored?.payload).not.toContain('traceEvents');
  });

  it('reports an expired link as gone rather than serving it', async () => {
    const auth = await newWorkspace();
    const published = await call(
      '/api/publish',
      { method: 'POST', body: JSON.stringify(publishPayload) },
      auth,
    );
    const { reportId } = (await published.json()) as { reportId: string };
    await db
      .prepare('UPDATE published_reports SET expires_at = ?1 WHERE id = ?2')
      .bind('2000-01-01T00:00:00.000Z', reportId)
      .run();

    const fetched = await call(`/api/reports/${reportId}`);
    expect(fetched.status).toBe(410);
  });

  it('returns 404 for an unknown report', async () => {
    expect((await call('/api/reports/rep_missing')).status).toBe(404);
  });
});

describe('limits', () => {
  it('refuses an oversized body before parsing it', async () => {
    const auth = await newWorkspace();
    const response = await call(
      '/api/workflows',
      {
        method: 'POST',
        body: JSON.stringify(workflowPayload),
        headers: { 'content-length': String(1024 * 1024) },
      },
      auth,
    );
    expect(response.status).toBe(413);
  });

  it('rate limits workspace creation from one address', async () => {
    const responses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const response = await app.fetch(
        new Request('https://rigorrun.test/api/workspaces', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.9' },
        }),
        env(),
      );
      responses.push(response.status);
    }
    expect(responses.filter((s) => s === 201)).toHaveLength(10);
    expect(responses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown route', async () => {
    expect((await call('/api/nope')).status).toBe(404);
  });
});
