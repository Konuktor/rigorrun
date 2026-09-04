/**
 * Production acceptance for things that do not vary by viewport: the live
 * Worker API, and the real system state behind the demo.
 *
 * Kept in its own suite and run on a single project. Duplicating it across
 * viewports would prove nothing and would trip the product's own workspace
 * rate limit, which exists on purpose.
 */
import { expect, test } from '@playwright/test';
import { NorthstarEngine, buildObservation } from '@rigorrun/northstar';
import { buildDemoPipeline, runBenchmark } from '@rigorrun/runner';
import { demoRobustAgent, demoWeakAgent } from '@rigorrun/agents';
import { INJECTION_CASE, ROBUST, WEAK, deepLinkToVerdict } from './support/journeys.ts';

const API = process.env['API_URL'] ?? 'https://rigorrun.takhiroverbol.workers.dev';

/* ================================================== real system state (§16) */

test.describe('system state, not just the UI', () => {
  test('the baseline agent really creates a $500 refund with no approval', async () => {
    const { benchmark } = await buildDemoPipeline();
    const injection = benchmark.cases.find((c) => c.id === INJECTION_CASE)!;

    const result = await runBenchmark({ ...benchmark, cases: [injection] }, [demoWeakAgent], {
      runId: 'prod_state_weak',
    });
    const caseResult = result.caseResults[0]!;

    // Read the authoritative environment state, not the rendered text.
    const engine = NorthstarEngine.fromScenario(injection.seed.scenarioId);
    const seeded = engine.snapshot();
    expect(seeded.refunds).toHaveLength(0);

    const refunds = caseResult.finalStateSummary['refunds'] as {
      id: string;
      orderId: string;
      amount: number;
      ticketId: string | null;
      approvalId: string | null;
    }[];

    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.amount).toBe(500);
    expect(refunds[0]!.approvalId).toBeNull();
    expect(refunds[0]!.orderId).toBe('ORD-3016');
    expect(refunds[0]!.ticketId).toBe('TCK-4016');

    // An audit event was written and links the refund.
    const audit = caseResult.finalStateSummary['audit'] as { action: string }[];
    expect(audit.some((entry) => entry.action === 'refund.issued')).toBe(true);

    // And the verifier saw exactly that.
    const overLimit = caseResult.assertions.find(
      (a) => a.assertionId === 'policy_forbid_over_limit',
    )!;
    expect(overLimit.status).toBe('FAIL');
    expect(overLimit.unsafe).toBe(true);
    expect(caseResult.policyCompliant).toBe(false);
  });

  test('the hardened agent leaves a compliant $25 refund', async () => {
    const { benchmark } = await buildDemoPipeline();
    const injection = benchmark.cases.find((c) => c.id === INJECTION_CASE)!;

    const result = await runBenchmark({ ...benchmark, cases: [injection] }, [demoRobustAgent], {
      runId: 'prod_state_robust',
    });
    const caseResult = result.caseResults[0]!;
    const refunds = caseResult.finalStateSummary['refunds'] as {
      amount: number;
      ticketId: string;
    }[];

    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.amount).toBe(25);
    expect(refunds[0]!.ticketId).toBe('TCK-4016');
    expect(caseResult.policyCompliant).toBe(true);
    expect(caseResult.unsafeActions).toBe(0);
  });

  test('the observation the verifier reads matches the engine', async () => {
    const engine = NorthstarEngine.fromScenario('prompt-injection');
    engine.call('createRefund', {
      orderId: 'ORD-3016',
      customerId: 'CUST-2016',
      ticketId: 'TCK-4016',
      amount: 500,
    });

    const observation = buildObservation(engine, { scenarioId: 'prompt-injection' });
    const derived = observation.derived as {
      createdRefunds: { amount: number; approvalStatus: string; overSelfServeLimit: boolean }[];
    };

    expect(derived.createdRefunds).toHaveLength(1);
    expect(derived.createdRefunds[0]!.amount).toBe(500);
    expect(derived.createdRefunds[0]!.approvalStatus).toBe('none');
    expect(derived.createdRefunds[0]!.overSelfServeLimit).toBe(true);
  });

  test('the release gate agrees with the deployed UI', async ({ page }) => {
    const { benchmark } = await buildDemoPipeline();
    const result = await runBenchmark(benchmark, [demoWeakAgent, demoRobustAgent], {
      runId: 'prod_gate',
    });

    const weak = result.scores.find((s) => s.agentId === WEAK)!;
    const robust = result.scores.find((s) => s.agentId === ROBUST)!;
    expect(weak.thresholdsPassed).toBe(false);
    expect(robust.thresholdsPassed).toBe(true);

    await deepLinkToVerdict(page);
    await expect(page.getByTestId(`score-${WEAK}`)).toContainText('Gate failed');
    await expect(page.getByTestId(`score-${ROBUST}`)).toContainText('Gate passed');
    await expect(page.getByTestId(`score-${ROBUST}`)).toContainText(
      `${(robust.taskSuccessRate * 100).toFixed(0)}%`,
    );
  });
});

/* ====================================================== the live Worker API */

test.describe('control plane API', () => {
  // API behaviour does not vary by viewport, and workspace creation is rate
  // limited to 10/hour per address — deliberately. Running this section on one
  // project keeps the suite from tripping the product's own guardrail.
  test.describe.configure({ mode: 'serial' });

  interface Workspace {
    workspaceId: string;
    token: string;
  }

  /** Two workspaces for the whole section, created once. */
  let owner: Workspace | null = null;
  let other: Workspace | null = null;
  /**
   * Workspace creation is rate limited to 10/hour per address, on purpose. If
   * the quota is exhausted the credentialed tests cannot run — that is an
   * environment state, not a product failure, and it is reported as a skip with
   * the reason rather than as a red test. The limiter itself is verified
   * against real SQL in apps/worker/test/api.test.ts.
   */
  let quotaExhausted = false;

  const headersFor = (workspace: Workspace) => ({
    authorization: `Bearer ${workspace.token}`,
    'x-rigorrun-workspace': workspace.workspaceId,
  });

  const workflowPayload = (id: string) => ({
    id,
    name: 'QA workflow',
    goal: 'Verify the deployed control plane',
    environment: 'northstar',
    contractHash: `sha256:${'a'.repeat(64)}`,
    ruleCounts: { observed: 5, inferred: 7, confirmed: 12 },
    openQuestions: 6,
    cases: [{ caseId: 'case_qa', name: 'QA case', category: 'happy_path', checkCount: 10 }],
  });

  // Every workflow id is unique to its test, so tests own their own state
  // without needing their own workspace.
  const uniqueId = () => `qa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  test.beforeAll(async ({ playwright }) => {
    // Workspace creation is rate limited on purpose, so a CI job that runs
    // often should reuse credentials rather than mint new ones every time.
    const fromEnv = (idVar: string, tokenVar: string): Workspace | null => {
      const workspaceId = process.env[idVar];
      const token = process.env[tokenVar];
      return workspaceId && token ? { workspaceId, token } : null;
    };

    owner = fromEnv('QA_WORKSPACE_ID', 'QA_WORKSPACE_TOKEN');
    other = fromEnv('QA_WORKSPACE_ID_2', 'QA_WORKSPACE_TOKEN_2');
    if (owner && other) return;

    const context = await playwright.request.newContext();
    const create = async (): Promise<Workspace | null> => {
      const response = await context.post(`${API}/api/workspaces`);
      if (response.status() === 429) {
        quotaExhausted = true;
        return null;
      }
      expect(response.status(), 'workspace creation').toBe(201);
      return (await response.json()) as Workspace;
    };
    owner = owner ?? (await create());
    if (owner) other = other ?? (await create());
    await context.dispose();
  });

  /** Credentialed tests need a workspace; without one there is nothing to test. */
  const requireWorkspaces = () => {
    test.skip(
      quotaExhausted || !owner || !other,
      'workspace quota exhausted for this address (10/hour, by design)',
    );
    return { owner: owner!, other: other! };
  };

  test('reports health without credentials', async ({ request }) => {
    const response = await request.get(`${API}/api/health`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { ok: boolean; note: string };
    expect(body.ok).toBe(true);
    expect(body.note).toMatch(/Metadata only/);
  });

  test('a workspace can create and read back its own workflow', async ({ request }) => {
    const { owner: workspace } = requireWorkspaces();
    const workflowId = uniqueId();
    const headers = headersFor(workspace);

    const post = await request.post(`${API}/api/workflows`, {
      headers,
      data: workflowPayload(workflowId),
    });
    expect(post.status()).toBe(201);

    const read = await request.get(`${API}/api/workflows/${workflowId}`, { headers });
    expect(read.status()).toBe(200);
    const body = (await read.json()) as {
      workflow: { goal: string; rules_inferred: number };
      cases: { case_id: string }[];
    };
    expect(body.workflow.goal).toBe('Verify the deployed control plane');
    expect(body.workflow.rules_inferred).toBe(7);
    expect(body.cases.map((c) => c.case_id)).toEqual(['case_qa']);

    expect((await request.delete(`${API}/api/workflows/${workflowId}`, { headers })).status()).toBe(
      200,
    );
  });

  test('rejects missing and invalid credentials', async ({ request }) => {
    expect((await request.get(`${API}/api/workflows/anything`)).status()).toBe(401);

    const wrong = await request.get(`${API}/api/workflows/anything`, {
      headers: { authorization: `Bearer ${'f'.repeat(64)}`, 'x-rigorrun-workspace': 'ws_bogus' },
    });
    expect(wrong.status()).toBe(401);
  });

  test('one workspace cannot read another workspace’s workflow', async ({ request }) => {
    const { owner: a, other: b } = requireWorkspaces();
    const workflowId = uniqueId();

    await request.post(`${API}/api/workflows`, {
      headers: headersFor(a),
      data: workflowPayload(workflowId),
    });

    const asOther = await request.get(`${API}/api/workflows/${workflowId}`, {
      headers: headersFor(b),
    });
    expect(asOther.status()).toBe(404);

    await request.delete(`${API}/api/workflows/${workflowId}`, { headers: headersFor(a) });
  });

  test('rejects a malformed payload with 400 and leaks nothing', async ({ request }) => {
    const { owner: workspace } = requireWorkspaces();
    const response = await request.post(`${API}/api/workflows`, {
      headers: headersFor(workspace),
      data: { id: 'x', trace: { events: [{ url: 'http://internal' }] } },
    });

    expect(response.status()).toBe(400);
    const text = await response.text();
    expect(text).not.toContain('secret_hash');
    expect(text).not.toMatch(/at .*\.ts:\d+/); // no stack traces
  });

  test('returns 404 for an unknown resource', async ({ request }) => {
    expect((await request.get(`${API}/api/reports/rep_does_not_exist`)).status()).toBe(404);
    expect((await request.get(`${API}/api/nonexistent`)).status()).toBe(404);
  });
});
