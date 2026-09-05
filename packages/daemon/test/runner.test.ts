/**
 * The runner over HTTP: who gets in, and the whole flow for whoever does.
 *
 * The access tests come first deliberately. This process holds credentials for
 * a customer's systems and can call tools that move money; listening on
 * loopback keeps other machines out and keeps nothing else out, because every
 * page in every tab on this machine can also reach 127.0.0.1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { CAREFUL, runTask } from '../../../fixtures/external/booking-agent/src/agent.ts';
import { ProjectStore, Runner, Service } from '../src/index.ts';

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
let runner: Runner;
let base: string;
let token: string;
const agents: { close: () => Promise<void>; url: string }[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await api(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-runner-'));
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store: new ProjectStore(home), proxy });
  runner = new Runner({ service });
  const port = await runner.start();
  base = `http://127.0.0.1:${port}`;
  token = runner.pairing.token;
}, 60_000);

afterAll(async () => {
  for (const agent of agents) await agent.close();
  await runner?.stop();
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('who may drive the runner', () => {
  it('refuses an unpaired caller', async () => {
    const response = await fetch(`${base}/api/projects`);
    expect(response.status).toBe(401);
    expect((await response.json()) as { detail: string }).toMatchObject({
      detail: expect.stringContaining('was not invited'),
    });
  });

  it('refuses a wrong token', async () => {
    const response = await fetch(`${base}/api/projects`, {
      headers: { authorization: 'Bearer not-the-token' },
    });
    expect(response.status).toBe(401);
  });

  it('trades a pairing code for a session cookie, once', async () => {
    const code = runner.pairing.reissue();
    const first = await fetch(`${base}/?code=${code}`, { redirect: 'manual' });
    expect(first.status).toBe(302);
    expect(first.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(first.headers.get('set-cookie')).toMatch(/SameSite=Strict/);

    // Spent. A code left in shell history or a screenshot is worthless.
    const second = await fetch(`${base}/?code=${code}`, { redirect: 'manual' });
    expect(second.status).toBe(403);
  });

  it('refuses a request claiming somebody else’s host', async () => {
    const status = await rawStatus(runner.port, '/api/projects', 'evil.example.com');
    expect(status).toBe(403);
  });
});

describe('the whole flow over HTTP', () => {
  let projectId: string;

  it('creates a project and says what to do first', async () => {
    const created = await post<{ project: { id: string; nextSteps: { id: string }[] } }>(
      '/api/projects',
      { name: 'Venue desk agent', goal: 'Confirm a held booking.' },
    );
    projectId = created.project.id;
    expect(created.project.nextSteps[0]?.id).toBe('connect_environment');
  });

  it('connects the system and reports the tools with their risk', async () => {
    const connected = await post<{
      serverName: string;
      tools: { name: string; risk: { level: string; source: string } }[];
    }>(`/api/projects/${projectId}/environment`, { connector: DESK, safety: 'ephemeral' });

    expect(connected.serverName).toBe('venue-desk');
    const list = connected.tools.find((tool) => tool.name === 'list_venues');
    // The server's word is carried and labelled as the server's word.
    expect(list?.risk).toMatchObject({ level: 'read', source: 'server-hint' });
    const signoff = connected.tools.find((tool) => tool.name === 'record_signoff');
    expect(signoff?.risk.level).toBe('unknown');
  }, 60_000);

  it('walks the rest of the way to a verdict', async () => {
    await post(`/api/projects/${projectId}/environment/config`, {
      readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
      verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
      reset: { kind: 'tool', tool: 'reset_desk' },
    });

    await post(`/api/projects/${projectId}/teach/start`);
    for (const [tool, args] of [
      ['find_bookings', {}],
      ['get_booking', { bookingId: 'BKG-4001' }],
      ['record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' }],
      ['confirm_booking', { bookingId: 'BKG-4001' }],
      ['get_booking', { bookingId: 'BKG-4001' }],
    ] as const) {
      await post(`/api/projects/${projectId}/teach/call`, { tool, args });
    }

    const finished = await post<{ questions: { id: string; kind: string }[] }>(
      `/api/projects/${projectId}/teach/finish`,
    );
    expect(finished.questions.length).toBeGreaterThan(0);

    await post(`/api/projects/${projectId}/schema/answers`, {
      answers: [
        { questionId: 'q_unit_Booking_depositAmount', value: 'currency' },
        { questionId: 'q_role_Booking_signedOffBy', value: 'actor' },
        { questionId: 'q_untrusted_Booking_note', value: 'yes' },
      ],
    });

    const compiled = await post<{ contract: { rules: { id: string }[] } }>(
      `/api/projects/${projectId}/compile`,
    );
    await post(`/api/projects/${projectId}/review`, {
      confirmedRuleIds: compiled.contract.rules.map((rule) => rule.id),
    });

    const suite = await post<{ cases: unknown[]; notTestable: unknown[] }>(
      `/api/projects/${projectId}/benchmark`,
    );
    expect(suite.cases.length).toBeGreaterThan(1);
    expect(suite.notTestable.length).toBeGreaterThan(0);

    const served = await serve(
      defineAgent(
        async ({ task, environment }) => ({
          status: 'completed' as const,
          output: await runTask(environment.mcpUrl, task.inputs, CAREFUL),
        }),
        { name: 'booking-agent', version: '1.0.0' },
      ),
    );
    agents.push(served);

    const added = await post<{ agent: { id: string; lastProbeOk: boolean } }>(
      `/api/projects/${projectId}/agents`,
      { name: 'Booking agent', endpoint: served.url },
    );
    expect(added.agent.lastProbeOk).toBe(true);

    const run = await post<{ run: { runId: string; verification: string; caseResults: unknown[] } }>(
      `/api/projects/${projectId}/runs`,
      { agentId: added.agent.id },
    );
    expect(run.run.verification).toBe('PARTIAL');
    expect(run.run.caseResults.length).toBeGreaterThan(1);

    // And the full evidence is fetchable separately from the summary.
    const detail = await api(`/api/projects/${projectId}/runs/${run.run.runId}`);
    const body = (await detail.json()) as { run: { caseResults: { steps: unknown[] }[] } };
    expect(body.run.caseResults[0]?.steps).toBeDefined();
  }, 240_000);

  it('turns a failure into something a person can read', async () => {
    const response = await api(`/api/projects/${projectId}/runs`, {
      method: 'POST',
      body: JSON.stringify({ agentId: 'nope' }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('No agent'),
    });
  });
});

function rawStatus(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve_, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let received = '';
    socket.on('data', (chunk) => {
      received += String(chunk);
    });
    socket.on('error', reject);
    socket.on('close', () => {
      const match = /^HTTP\/1\.1 (\d{3})/.exec(received);
      resolve_(match?.[1] ? Number(match[1]) : 0);
    });
  });
}
