/**
 * An agent RigorRun cannot start.
 *
 * The other three ways in all assume RigorRun can invoke the agent. This one
 * inverts it: RigorRun prepares the world, publishes one case, and waits for
 * whoever is driving to come and do it. That covers the agents most teams
 * actually have — inside a product behind a login, in a notebook, on
 * infrastructure that will not take an inbound request from a laptop — and
 * none of them could be benchmarked at all before.
 *
 * The driver below is a real one: it polls with its own key, connects to the
 * MCP endpoint it is handed, does the job through it, and posts a result. The
 * booking agent it runs is the same fixture every other agent test uses, so
 * what is being tested here is the inversion and nothing else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { CAREFUL, runTask } from '../../../fixtures/external/booking-agent/src/agent.ts';
import { ExternalDriver, ProjectStore, Runner, Service } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const DESK = {
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  url: '',
  secretNames: [],
};

let home: string;
let proxy: ProxyServer;
let service: Service;
let store: ProjectStore;
let runner: Runner;
let base: string;
let token: string;
let projectId: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-driven-'));
  proxy = new ProxyServer();
  await proxy.start();
  store = new ProjectStore(home);
  service = new Service({ store, proxy });
  runner = new Runner({ service });
  base = `http://127.0.0.1:${await runner.start()}`;
  token = runner.pairing.token;

  // Set the project up through the service, because what this file is about
  // starts after there is a suite to run.
  const project = await service.createProject({ name: 'Desk', goal: 'Confirm a held booking.' });
  projectId = project.id;
  await service.connectEnvironment(projectId, DESK, 'ephemeral');
  await service.configureEnvironment(projectId, {
    readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
    verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
    reset: { kind: 'tool', tool: 'reset_desk' },
  });
  await service.startTeaching(projectId);
  await service.teachStep(projectId, 'find_bookings', {});
  await service.teachStep(projectId, 'get_booking', { bookingId: 'BKG-4001' });
  await service.teachStep(projectId, 'record_signoff', {
    bookingId: 'BKG-4001',
    approver: 'Dana Whitlock',
  });
  await service.teachStep(projectId, 'confirm_booking', { bookingId: 'BKG-4001' });
  await service.finishTeaching(projectId);
  await service.answerSchema(projectId, [
    { questionId: 'q_unit_Booking_depositAmount', value: 'currency' },
    { questionId: 'q_role_Booking_signedOffBy', value: 'actor' },
    { questionId: 'q_untrusted_Booking_note', value: 'yes' },
  ]);
  const draft = await service.compile(projectId);
  await service.review(projectId, { confirmedRuleIds: draft.rules.map((rule) => rule.id) });
  await service.generate(projectId);
}, 180_000);

afterAll(async () => {
  await runner?.stop();
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

interface Waiting {
  caseId: string;
  index: number;
  total: number;
  task: { instruction: string; inputs: Record<string, unknown>; policyBrief: string };
  mcpUrl: string;
  maxSteps: number;
}

/** Somebody's own agent, driving itself. Polls, works, reports. */
function drive(agentId: string, key: string): { stop: () => void; done: Promise<number> } {
  let running = true;
  let handled = 0;
  const done = (async () => {
    while (running) {
      const answer = await fetch(`${base}/api/drive/${agentId}`, {
        headers: { authorization: `Bearer ${key}` },
      });
      const { waiting } = (await answer.json()) as { waiting: Waiting | null };
      if (!waiting) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      // Everything it does goes through the endpoint it was handed, which is
      // why the evidence is identical to an agent RigorRun called itself.
      const output = await runTask(waiting.mcpUrl, waiting.task.inputs, CAREFUL).catch(
        (error: Error) => `failed: ${error.message}`,
      );
      await fetch(`${base}/api/drive/${agentId}/finished`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: waiting.caseId, status: 'completed', output }),
      });
      handled += 1;
    }
    return handled;
  })();
  return { stop: () => void (running = false), done };
}

describe('an agent RigorRun cannot start', () => {
  let agentId: string;
  let key: string;

  it('hands over a key once, and is not connected until somebody uses it', async () => {
    const response = await fetch(`${base}/api/projects/${projectId}/agents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Our own agent', driven: true }),
    });
    const added = (await response.json()) as {
      agent: { id: string; kind: string; lastProbeOk: boolean; lastProbeProblem: string };
      key: string;
    };
    agentId = added.agent.id;
    key = added.key;

    expect(added.agent.kind).toBe('external');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // Not connected on the strength of somebody typing a name. There is
    // nothing to probe, so the only evidence is a driver turning up.
    expect(added.agent.lastProbeOk).toBe(false);
    expect(added.agent.lastProbeProblem).toContain('has not asked');
  }, 30_000);

  it('keeps the key out of the project, and out of every reply', async () => {
    const response = await fetch(`${base}/api/projects/${projectId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.text();
    expect(body).not.toContain(key);
    // The name of the credential travels; the credential does not.
    expect(body).toContain(`agent:${agentId}:key`);

    const onDisk = await store.read(projectId);
    expect(JSON.stringify(onDisk)).not.toContain(key);
  }, 30_000);

  it('is a key for one agent and not a way into the runner', async () => {
    const projects = await fetch(`${base}/api/projects`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(projects.status).toBe(401);

    const wrong = await fetch(`${base}/api/drive/${agentId}`, {
      headers: { authorization: `Bearer ${'0'.repeat(64)}` },
    });
    expect(wrong.status).toBe(401);

    // An agent that does not exist and a key that is wrong answer the same.
    const missing = await fetch(`${base}/api/drive/a_nope`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(missing.status).toBe(401);
    expect(await missing.text()).toBe(await wrong.clone().text());
  }, 30_000);

  it('marks it connected when its driver asks for work', async () => {
    const answer = await fetch(`${base}/api/drive/${agentId}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(answer.status).toBe(200);
    // Nothing is waiting yet, and that is not an error — it is the answer.
    expect((await answer.json()) as { waiting: null }).toEqual({ waiting: null });

    const project = await store.read(projectId);
    const agent = project.agents.find((entry) => entry.id === agentId);
    expect(agent?.lastProbeOk).toBe(true);
  }, 30_000);

  it('runs the whole suite against it, and grades it the same way', async () => {
    const driver = drive(agentId, key);
    let run: {
      caseResults: { taskSuccess: boolean; steps: unknown[] }[];
      verification: string;
      scores: { taskSuccessRate: number }[];
    };
    try {
      const response = await fetch(`${base}/api/projects/${projectId}/runs`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      expect(response.status).toBe(200);
      run = ((await response.json()) as { run: typeof run }).run;
    } finally {
      driver.stop();
    }
    const handled = await driver.done;

    expect(run.caseResults.length).toBeGreaterThan(1);
    // Every case went through the driver rather than being scored empty.
    expect(handled).toBe(run.caseResults.length);
    // It did the work, rather than being scored on an empty run: the careful
    // agent gets some cases right, and the steps recorded are the calls it
    // made through the endpoint it was handed.
    expect(run.caseResults.some((result) => result.taskSuccess)).toBe(true);
    expect(run.caseResults.some((result) => result.steps.length > 0)).toBe(true);
    expect(run.scores[0]?.taskSuccessRate).toBeGreaterThan(0);
    // Read back from the system afterwards, exactly as for any other agent.
    expect(run.verification).toBe('PARTIAL');
  }, 240_000);

  it('bounds what a key-holder can post', async () => {
    // These are the only endpoints reachable with a credential that is not the
    // runner's own, so what arrives at them has a ceiling that has nothing to
    // do with how large an OpenAPI document might be.
    const response = await fetch(`${base}/api/drive/${agentId}/finished`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: 'c', status: 'completed', output: 'x'.repeat(200_000) }),
    });
    expect(response.status).toBe(413);
  }, 30_000);

  it('refuses an answer to a case it is not waiting for', async () => {
    const response = await fetch(`${base}/api/drive/${agentId}/finished`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: 'case_that_is_not_open', status: 'completed', output: 'hi' }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()) as { detail: string }).toMatchObject({
      detail: expect.stringContaining('not the case RigorRun is waiting for'),
    });
  }, 30_000);
});

/**
 * What happens when nobody comes.
 *
 * These drive the waiting slot directly, because the behaviour worth pinning
 * is measured in timeouts and a suite of twenty cases each waiting ten minutes
 * is not a test, it is a working day.
 */
describe('when nobody is driving', () => {
  const task = {
    instruction: 'do the thing',
    inputs: {},
    policyBrief: '',
    allowedTools: [] as string[],
    tools: [] as never[],
  };
  const env = {
    call: async () => ({ ok: true as const, data: {} }),
    stepsRemaining: () => 10,
    note: () => undefined,
  };

  it('stops waiting for the rest once one case has timed out', async () => {
    const driver = new ExternalDriver();
    const adapter = driver.adapter({
      id: 'a_alone',
      name: 'Nobody',
      proxy,
      total: 3,
      timeoutMs: 60,
    });

    const started = Date.now();
    const first = await adapter.execute({ caseId: 'c1', task, maxSteps: 5 }, env);
    expect(first.report).toContain('timed out');

    // The second does not wait at all, which is the whole point.
    const second = await adapter.execute({ caseId: 'c2', task, maxSteps: 5 }, env);
    expect(second.report).toContain('stopped waiting');
    expect(Date.now() - started).toBeLessThan(1_000);
  }, 30_000);

  it('refuses to run two runs against one agent at once', async () => {
    const driver = new ExternalDriver();
    const adapter = driver.adapter({ id: 'a_busy', name: 'Busy', proxy, total: 1, timeoutMs: 300 });

    const first = adapter.execute({ caseId: 'c1', task, maxSteps: 5 }, env);
    // A second case for the same agent while one is open means two cases
    // against one system, and then neither result means anything.
    const second = await adapter.execute({ caseId: 'c2', task, maxSteps: 5 }, env);
    expect(second.report).toContain('already working on another run');

    driver.finish('a_busy', 'c1', { status: 'completed', output: 'done' });
    expect((await first).report).toBe('done');
  }, 30_000);
});
