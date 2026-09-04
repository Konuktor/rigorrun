/**
 * Production acceptance for things that do not vary by viewport: the live
 * Worker API, and the real system state behind the demo.
 *
 * Kept in its own suite and run on a single project. Duplicating it across
 * viewports would prove nothing and would trip the product's own workspace
 * rate limit, which exists on purpose.
 */
import { expect, test } from '@playwright/test';
import { buildProjection, createEnvironment, type CanonicalState } from '@rigorrun/environment';
import { compileWorkflow, workflowByKey } from '@rigorrun/environments';
import { createReferenceAgent } from '@rigorrun/generator';
import { runBenchmark } from '@rigorrun/runner';
import { carefulAgent, naiveAgent } from '@rigorrun/agents';
import { REFERENCE, WEAK, deepLinkToVerdict } from './support/journeys.ts';

const API = process.env['API_URL'] ?? 'https://rigorrun.takhiroverbol.workers.dev';

/* ================================================== real system state (§15) */

test.describe('system state, not just the UI', () => {
  test('a policy violation is visible in the system of record, not only in a score', async () => {
    const { benchmark, generation } = await compileWorkflow(workflowByKey('refund'));
    // A case a compliant operator would refuse.
    const refusal = generation.cases.find((entry) => !entry.expected.shouldPerform)!;
    expect(refusal).toBeDefined();

    const result = await runBenchmark({ ...benchmark, cases: [refusal.testCase] }, [naiveAgent], {
      runId: 'prod_state_naive',
    });
    const caseResult = result.caseResults[0]!;

    // The agent that ignores the policy leaves a record behind. Read it from
    // the environment's own state, not from anything the agent said.
    const focus = benchmark.projectionFocus;
    expect(focus.length).toBeGreaterThan(0);
    const summary = caseResult.finalStateSummary as Record<string, { count: number }>;
    const created = Object.values(summary).reduce((total, entry) => total + entry.count, 0);
    expect(created).toBeGreaterThan(0);

    expect(caseResult.policyCompliant).toBe(false);
    expect(caseResult.unsafeActions).toBeGreaterThan(0);
    const failed = caseResult.assertions.filter((a) => a.status === 'FAIL');
    expect(failed.length).toBeGreaterThan(0);
    // Every failure names the rule a person confirmed.
    expect(failed.every((a) => a.ruleId !== undefined || a.assertionId.startsWith('success'))).toBe(
      true,
    );
    expect(failed.every((a) => a.verificationSource === 'STATE')).toBe(true);
  });

  test('the reference implementation is not failed by its own benchmark', async () => {
    // A suite no correct actor can pass is broken. This is the check that
    // says so, on the real artefacts.
    const { benchmark } = await compileWorkflow(workflowByKey('refund'));
    const result = await runBenchmark(benchmark, [createReferenceAgent(benchmark)], {
      runId: 'prod_state_reference',
    });
    const score = result.scores[0]!;
    expect(score.thresholdsPassed).toBe(true);
    expect(score.unsafeActions).toBe(0);
  });

  test('the projection the verifier reads is computed from state, not reported', async () => {
    const { benchmark } = await compileWorkflow(workflowByKey('refund'));
    const testCase = benchmark.cases.find((c) => c.category === 'happy_path')!;
    const adapter = createEnvironment(benchmark.environment);
    const seed = (testCase.seed.state ?? { entities: {} }) as CanonicalState;
    await adapter.seed(seed, testCase.seed.config);

    for (const step of testCase.referencePlan) {
      const outcome = await adapter.executeAction(step.action, step.args);
      expect(outcome.ok).toBe(true);
    }

    const { derived } = buildProjection(adapter.describeEntities(), {
      seed,
      final: await adapter.getState(),
      events: await adapter.getEvents(),
      focus: benchmark.projectionFocus,
    });
    const focus = benchmark.projectionFocus[0]!;
    expect(Object.keys(derived.created)).toContain(focus);
  });

  test('the release gate agrees with the deployed UI', async ({ page }) => {
    const { benchmark } = await compileWorkflow(workflowByKey('refund'));
    const result = await runBenchmark(
      benchmark,
      [naiveAgent, carefulAgent, createReferenceAgent(benchmark)],
      { runId: 'prod_gate' },
    );

    const naive = result.scores.find((s) => s.agentId === WEAK)!;
    const reference = result.scores.find((s) => s.agentId === REFERENCE)!;
    expect(naive.thresholdsPassed).toBe(false);
    expect(reference.thresholdsPassed).toBe(true);

    await deepLinkToVerdict(page);
    await expect(page.getByTestId(`score-${WEAK}`)).toContainText('Gate failed');
    await expect(page.getByTestId(`score-${REFERENCE}`)).toContainText('Gate passed');
  });
});

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
    environment: 'support-refund',
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
