import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { clearPacks, registerPack } from '@rigorrun/environment';
import * as generator from '@rigorrun/generator';
import * as core from '@rigorrun/core';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service, SuiteIntegrityError, type Project } from '../src/index.ts';
import { blackBoxAgent, fakeItemsPack, PACK_ID } from './packFixture.ts';

let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;
const servers: Server[] = [];
const services: Service[] = [];
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-integrity-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
  services.push(service);
  project = await service.createProject({ name: 'Integrity' });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  for (const item of services.splice(0)) await item.workspace.close();
  await proxy.stop();
  clearPacks();
  delete process.env['RIGORRUN_SECRET__FAKE_ITEMS_KEY'];
  await rm(home, { recursive: true, force: true });
});

async function packReady() {
  process.env['RIGORRUN_SECRET__FAKE_ITEMS_KEY'] = 'test-only';
  const fake = fakeItemsPack();
  registerPack(fake.pack);
  await service.connectEnvironment(
    project.id,
    { kind: 'pack', pack: PACK_ID, mode: 'twin' },
    'ephemeral',
  );
  await service.installPackSuite(
    project.id,
    {},
    { confirmedRuleIds: ['items.exact', 'items.no_other'] },
  );
  const endpoint = await blackBoxAgent(() => fake.sessions.at(-1)!, 5, servers);
  const { agent } = await service.addAgent(project.id, {
    name: 'Adds five',
    blackBox: { endpoint },
  });
  return agent.id;
}

async function generatedReady() {
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
  return contract;
}

it('review invalidates downstream but retains historical evidence', async () => {
  const agent = await packReady();
  const run = await service.runAgent(project.id, agent);
  await store.writeArtefact(project.id, 'quality', { historical: true });
  await store.writeArtefact(project.id, 'quality-source', { historical: true });
  await service.review(project.id, { rejectedRuleIds: ['items.exact'] });
  for (const name of ['benchmark', 'suite-source', 'quality', 'quality-source']) {
    expect(await store.readArtefact(project.id, name)).toBeUndefined();
  }
  expect(await store.readRun(project.id, run.runId)).toEqual(run);
  expect((await store.read(project.id)).runs.map((entry) => entry.runId)).toContain(run.runId);
  expect((await store.read(project.id)).timings.benchmarkGeneratedAt).toBeNull();
});

it('missing source refuses execution', async () => {
  const agent = await packReady();
  await store.deleteArtefact(project.id, 'suite-source');
  await expect(service.runAgent(project.id, agent)).rejects.toMatchObject({ kind: 'missing' });
  expect((await store.read(project.id)).runs).toHaveLength(0);
});

it('configuration change invalidates suite', async () => {
  await packReady();
  const { source } = await service.readCurrentSuite(project.id);
  await service.configureEnvironment(project.id, {
    readOnlyTools: [],
    verifierReads: [],
    reset: { kind: 'none' },
    budgets: { caseMs: 90_000 },
  });
  await expect(service.assertSuiteCurrent(project.id, source)).rejects.toMatchObject({
    kind: 'stale',
  });
  expect(await store.readArtefact(project.id, 'benchmark')).toBeUndefined();
});

it.each(['goal', 'safety', 'schema'] as const)(
  'detects direct stored %s changes',
  async (field) => {
    await packReady();
    const { source } = await service.readCurrentSuite(project.id);
    if (field === 'schema')
      await store.writeArtefact(project.id, 'schema', { entities: [], relationships: [] });
    else
      await store.write({
        ...(await store.read(project.id)),
        [field]: field === 'goal' ? 'Changed goal' : 'staging',
      });
    await expect(service.assertSuiteCurrent(project.id, source)).rejects.toMatchObject({
      kind: 'stale',
    });
  },
);

it('paused generation cannot publish after review', async () => {
  const contract = await generatedReady();
  const original = generator.generateBenchmark;
  let reached!: () => void;
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const continued = new Promise<void>((resolve) => {
    resume = resolve;
  });
  vi.spyOn(generator, 'generateBenchmark').mockImplementation(async (...args) => {
    const result = await original(...args);
    reached();
    await continued;
    return result;
  });
  const generating = service.generate(project.id);
  const rejected = expect(generating).rejects.toMatchObject({ kind: 'stale' });
  await paused;
  await service.review(project.id, { rejectedRuleIds: [contract.rules[0]!.id] });
  resume();
  await rejected;
  expect(await store.readArtefact(project.id, 'benchmark')).toBeUndefined();
}, 60_000);

it('two Services detect a stale completed run', async () => {
  const agent = await packReady();
  const baseline = await service.runAgent(project.id, agent);
  const second = new Service({ store: new ProjectStore(home), proxy });
  services.push(second);
  let staleError: unknown;
  try {
    await service.runAgent(project.id, agent, {
      afterCase: async (_result, index) => {
        if (index === 0) await second.review(project.id, { rejectedRuleIds: ['items.exact'] });
      },
    });
  } catch (error) {
    staleError = error;
  }
  expect(staleError).toBeInstanceOf(SuiteIntegrityError);
  const stale = staleError as SuiteIntegrityError;
  expect(stale.kind).toBe('stale');
  expect(await store.readRun(project.id, stale.runId!)).toBeDefined();
  const current = await store.read(project.id);
  expect(current.baselineRunId).toBe(baseline.runId);
  expect(current.runs.map((entry) => entry.runId)).not.toContain(stale.runId);
});

it('same contract with regenerated suite detects benchmark change', async () => {
  await generatedReady();
  await service.generate(project.id);
  const { source } = await service.readCurrentSuite(project.id);
  await service.generate(project.id);
  const next = await service.readCurrentSuite(project.id);
  expect(next.source.contractDigest).toBe(source.contractDigest);
  expect(next.source.benchmarkDigest).not.toBe(source.benchmarkDigest);
  await expect(service.assertSuiteCurrent(project.id, source)).rejects.toMatchObject({
    kind: 'stale',
  });
}, 60_000);

it('appending a valid run preserves metadata changed during execution', async () => {
  const agent = await packReady();
  await service.runAgent(project.id, agent, {
    afterCase: async (_result, index) => {
      if (index === 0)
        await store.write({ ...(await store.read(project.id)), name: 'Renamed while running' });
    },
  });
  expect((await store.read(project.id)).name).toBe('Renamed while running');
});

it('recompile removes the published suite and quality while retaining the contract draft', async () => {
  await generatedReady();
  await service.generate(project.id);
  await store.writeArtefact(project.id, 'quality', { old: true });
  const draft = await service.compile(project.id);
  expect(draft.rules.some((rule) => rule.status === 'inferred')).toBe(true);
  for (const name of ['benchmark', 'suite-source', 'quality', 'quality-source']) {
    expect(await store.readArtefact(project.id, name)).toBeUndefined();
  }
}, 60_000);

it('incident additions replace provenance and clear the previous assessment', async () => {
  await generatedReady();
  await service.generate(project.id);
  const { source } = await service.readCurrentSuite(project.id);
  await store.writeArtefact(project.id, 'quality', { old: true });
  await store.writeArtefact(project.id, 'quality-source', { old: true });
  const incident = await service.addFailureToSuite(project.id, {
    name: 'Regression',
    reason: 'Missed approval',
    request: { bookingId: 'BKG-4001' },
  });
  expect((await service.readCurrentSuite(project.id)).benchmark.cases.at(-1)?.id).toBe(
    incident.caseId,
  );
  await expect(service.assertSuiteCurrent(project.id, source)).rejects.toMatchObject({
    kind: 'stale',
  });
  expect(await store.readArtefact(project.id, 'quality')).toBeUndefined();
  expect(await store.readArtefact(project.id, 'quality-source')).toBeUndefined();
}, 60_000);

it('run startup does not overwrite a changed schema to make an obsolete source look current', async () => {
  const agent = await packReady();
  const register = service.workspace.connect.bind(service.workspace);
  vi.spyOn(service.workspace, 'connect').mockImplementation(async (...args) => {
    await store.writeArtefact(project.id, 'schema', { entities: [], relationships: [] });
    return register(...args);
  });
  let completedCases = 0;
  await expect(
    service.runAgent(project.id, agent, {
      afterCase: async () => {
        completedCases += 1;
      },
    }),
  ).rejects.toMatchObject({ kind: 'stale' });
  expect(completedCases).toBe(0);
});

it('generation never publishes old contract content under a newer contract digest', async () => {
  const contract = await generatedReady();
  const write = store.writeArtefact.bind(store);
  let changed = false;
  vi.spyOn(store, 'writeArtefact').mockImplementation(async (id, name, value) => {
    if (name === 'schema' && !changed) {
      changed = true;
      await service.review(project.id, { rejectedRuleIds: [contract.rules[0]!.id] });
    }
    return write(id, name, value);
  });
  await expect(service.generate(project.id)).rejects.toMatchObject({ kind: 'stale' });
  expect(await store.readArtefact(project.id, 'benchmark')).toBeUndefined();
}, 60_000);

it('pack installation cannot bind a suite built with old configuration to new configuration', async () => {
  await packReady();
  const oldBenchmark = await store.readArtefact(project.id, 'benchmark');
  const original = core.hashValue;
  let changed = false;
  vi.spyOn(core, 'hashValue').mockImplementation(async (value) => {
    if (!changed && value && typeof value === 'object' && 'rules' in value) {
      changed = true;
      await store.write({ ...(await store.read(project.id)), goal: 'A different job now' });
    }
    return original(value);
  });
  await expect(service.installPackSuite(project.id, {})).rejects.toMatchObject({ kind: 'stale' });
  expect(await store.readArtefact(project.id, 'benchmark')).toEqual(oldBenchmark);
});
