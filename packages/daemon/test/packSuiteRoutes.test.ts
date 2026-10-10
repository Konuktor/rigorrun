import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearPacks, registerPack } from '@rigorrun/environment';
import {
  helpdeskPack,
  helpdeskContract,
  startTwin,
  type RunningTwin,
} from '@rigorrun/env-helpdesk';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Runner, Service, type Project } from '../src/index.ts';
import { fakeItemsPack, PACK_ID } from './packFixture.ts';
import { registerBuiltInPacks } from '../../cli/src/packs.ts';

let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let runner: Runner;
let project: Project;
let base: string;
let candidate: Server;
let candidateCalls: number;
let twin: RunningTwin | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-review-routes-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
  runner = new Runner({ service });
  base = `http://127.0.0.1:${await runner.start()}`;
  registerPack(fakeItemsPack().pack);
  process.env['RIGORRUN_SECRET__FAKE_ITEMS_KEY'] = 'test-only';
  project = await service.createProject({ name: 'Route review' });
  await service.connectEnvironment(
    project.id,
    { kind: 'pack', pack: PACK_ID, mode: 'twin' },
    'ephemeral',
  );
  candidateCalls = 0;
  candidate = createServer((_req, res) => {
    candidateCalls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output: 'Test control answers' }));
  });
  await new Promise<void>((resolve) => candidate.listen(0, '127.0.0.1', resolve));
  const address = candidate.address();
  if (!address || typeof address === 'string') throw new Error('Candidate did not bind');
  await service.addAgent(project.id, {
    name: 'HTTP control',
    blackBox: { endpoint: `http://127.0.0.1:${address.port}` },
  });
});

afterEach(async () => {
  await runner?.stop();
  await service?.workspace.close();
  await proxy?.stop();
  if (candidate)
    await new Promise<void>((resolve, reject) =>
      candidate.close((error) => (error ? reject(error) : resolve())),
    );
  await twin?.close();
  twin = undefined;
  clearPacks();
  delete process.env['RIGORRUN_SECRET__FAKE_ITEMS_KEY'];
  await rm(home, { recursive: true, force: true });
});

function api(path: string, options: RequestInit = {}) {
  return fetch(`${base}/api/projects/${project.id}/${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${runner.pairing.token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
  });
}

function install(body: unknown, headers: Record<string, string> = {}) {
  return api('pack-suite', { method: 'POST', body: JSON.stringify(body), headers });
}

async function diskBytes(directory = home): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(snapshot, await diskBytes(path));
    else
      snapshot[path] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
  }
  return snapshot;
}

async function readiness() {
  const before = await diskBytes();
  const calls = candidateCalls;
  const response = await api('gate-readiness');
  expect(response.status).toBe(200);
  const result = (await response.json()) as {
    ready: boolean;
    reasons: string[];
    source: { origin: string } | null;
  };
  expect(await diskBytes()).toEqual(before);
  expect(candidateCalls).toBe(calls);
  return result;
}

describe('pack suite decisions over real Runner HTTP', () => {
  it('persists both explicit decisions and preserves the contract/cases response', async () => {
    const response = await install({
      params: {},
      confirmedRuleIds: ['items.exact'],
      rejectedRuleIds: ['items.no_other'],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.contract.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'items.exact', status: 'confirmed' }),
        expect.objectContaining({ id: 'items.no_other', status: 'rejected' }),
      ]),
    );
    expect(body.cases).toHaveLength(3);
    expect(body.cases[0]).toEqual({
      id: 'case_a',
      name: 'Add one item (case_a)',
      category: expect.any(String),
    });
    expect(await store.readArtefact(project.id, 'contract')).toEqual(body.contract);
  });

  it('leaves omitted decisions inferred', async () => {
    expect((await install({ params: {} })).status).toBe(200);
    const contract = await store.readArtefact<{ rules: { status: string }[] }>(
      project.id,
      'contract',
    );
    expect(contract!.rules.every((rule) => rule.status === 'inferred')).toBe(true);
  });

  it.each(
    [
      null,
      [],
      'invalid',
      1,
      { confirmedRuleIds: null },
      { rejectedRuleIds: null },
      { confirmedRuleIds: 'items.exact' },
      { rejectedRuleIds: {} },
      { confirmedRuleIds: ['items.exact', 2] },
      { rejectedRuleIds: ['items.no_other', false] },
      { rejectedRuleIds: [{ id: 'items.no_other' }] },
      { confirmedRuleIds: ['items.invented'] },
      { rejectedRuleIds: ['items.invented'] },
      { confirmedRuleIds: ['items.exact', 'items.exact'] },
      { rejectedRuleIds: ['items.no_other', 'items.no_other'] },
      { confirmedRuleIds: ['items.exact'], rejectedRuleIds: ['items.exact'] },
    ].map((body) => ({ body })),
  )('refuses invalid decisions without changing stored bytes: $body', async ({ body }) => {
    const before = await diskBytes();
    const response = await install(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual(expect.any(String));
    expect(await diskBytes()).toEqual(before);
  });

  it('requires pairing for both new routes', async () => {
    for (const [path, method, body] of [
      ['pack-suite', 'POST', '{}'],
      ['gate-readiness', 'GET', undefined],
    ] as const) {
      const response = await fetch(`${base}/api/projects/${project.id}/${path}`, {
        method,
        ...(body ? { body } : {}),
      });
      expect(response.status).toBe(401);
    }
  });

  it('refuses cross-origin mutation and allows an authenticated cross-origin read', async () => {
    const before = await diskBytes();
    expect(
      (
        await install(
          {},
          { cookie: `rigorrun_session=${runner.pairing.token}`, 'sec-fetch-site': 'same-site' },
        )
      ).status,
    ).toBe(403);
    const response = await fetch(`${base}/api/projects/${project.id}/gate-readiness`, {
      headers: {
        cookie: `rigorrun_session=${runner.pairing.token}`,
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(response.status).toBe(200);
    expect(await diskBytes()).toEqual(before);
  });
});

describe('read-only release gate readiness over real Runner HTTP', () => {
  it('reports a missing suite without writing or calling the candidate', async () => {
    expect(await readiness()).toMatchObject({ ready: false, source: null });
  });

  it('reports pending explicit review without writing or calling the candidate', async () => {
    await service.installPackSuite(project.id, {});
    const result = await readiness();
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain('The contract still needs explicit review.');
  });

  it('reports stale provenance without writing or calling the candidate', async () => {
    await service.installPackSuite(
      project.id,
      {},
      { confirmedRuleIds: ['items.exact', 'items.no_other'] },
    );
    await store.write({
      ...(await store.read(project.id)),
      goal: 'Changed after suite installation',
    });
    expect(await readiness()).toMatchObject({ ready: false, source: null });
  });

  it('refuses a generated suite before and after inadequate assessment without automatic writes or candidate calls', async () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    await service.connectEnvironment(
      project.id,
      {
        kind: 'mcp',
        transport: 'stdio',
        command: join(root, 'node_modules/.bin/tsx'),
        args: [join(root, 'fixtures/external/mcp-venue-desk/src/stdio.ts')],
        url: '',
        secretNames: [],
      },
      'ephemeral',
    );
    await service.configureEnvironment(project.id, {
      readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
      verifierReads: [
        { tool: 'find_bookings' },
        { tool: 'list_venues' },
        { tool: 'list_organisers' },
      ],
      reset: { kind: 'tool', tool: 'reset_desk' },
    });
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'record_signoff', {
      bookingId: 'BKG-4001',
      approver: 'Dana Whitlock',
    });
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
    await service.finishTeaching(project.id);
    const contract = await service.compile(project.id);
    await service.review(project.id, { confirmedRuleIds: contract.rules.map((rule) => rule.id) });
    await service.generate(project.id);
    const result = await readiness();
    expect(result).toMatchObject({ ready: false, source: { origin: 'generated' } });
    expect(result.reasons.some((reason) => /quality assessment/.test(reason))).toBe(true);
    expect(await store.readArtefact(project.id, 'quality')).toBeUndefined();
    // Assessment is an explicit write operation in this disposable environment.
    // A subsequent GET must retain the inadequate result rather than reassess it.
    await service.assessSuite(project.id);
    expect(await service.quality(project.id)).toBeDefined();
    const assessed = await readiness();
    expect(assessed).toMatchObject({ ready: false, source: { origin: 'generated' } });
    expect(assessed.reasons.length).toBeGreaterThan(0);
  }, 60_000);

  it('accepts a reviewed bundled Helpdesk suite without writing or calling the candidate', async () => {
    registerBuiltInPacks();
    twin = await startTwin({ port: 0 });
    await service.connectEnvironment(
      project.id,
      { kind: 'pack', pack: helpdeskPack.id, mode: 'twin', baseUrl: twin.url },
      'ephemeral',
    );
    const ids = helpdeskContract('2026-10-02T00:00:00.000Z').rules.map((rule) => rule.id);
    await service.installPackSuite(
      project.id,
      { confirmedRuleIds: ids },
      { confirmedRuleIds: ids },
    );
    expect(await readiness()).toMatchObject({
      ready: true,
      reasons: [],
      source: { origin: 'pack' },
    });
  });
});
