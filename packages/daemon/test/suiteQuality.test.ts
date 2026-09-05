/**
 * Grading the suite before anybody grades an agent with it.
 *
 * A benchmark that cannot tell a good agent from a bad one produces a confident
 * verdict about nothing, and finding that out from the verdict is finding it
 * out too late. `packages/quality` has been able to measure this since it was
 * written and only ever ran over the five bundled workflows, in a script that
 * builds the marketing page. This is it running over somebody's own suite,
 * against their own system.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '../src/index.ts';
import type { Project } from '../src/project.ts';

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
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-quality-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });

  project = await service.createProject({ name: 'Desk', goal: 'Confirm a held booking.' });
  await service.connectEnvironment(project.id, DESK, 'ephemeral');
  await service.configureEnvironment(project.id, {
    readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
    verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
    reset: { kind: 'tool', tool: 'reset_desk' },
  });
  await service.startTeaching(project.id);
  await service.teachStep(project.id, 'find_bookings', {});
  await service.teachStep(project.id, 'get_booking', { bookingId: 'BKG-4001' });
  await service.teachStep(project.id, 'record_signoff', {
    bookingId: 'BKG-4001',
    approver: 'Dana Whitlock',
  });
  await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
  await service.finishTeaching(project.id);
  await service.answerSchema(project.id, [
    { questionId: 'q_unit_Booking_depositAmount', value: 'currency' },
    { questionId: 'q_role_Booking_signedOffBy', value: 'actor' },
    { questionId: 'q_untrusted_Booking_note', value: 'yes' },
  ]);
  const draft = await service.compile(project.id);
  await service.review(project.id, { confirmedRuleIds: draft.rules.map((rule) => rule.id) });
  await service.generate(project.id);
  project = await store.read(project.id);
}, 180_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('checking the suite against known-broken behaviour', () => {
  it('reports how many injected defects it caught', async () => {
    const quality = await service.assessSuite(project.id);

    expect(quality.mutants.length).toBeGreaterThan(0);
    expect(quality.mutantKillRate).toBeGreaterThanOrEqual(0);
    expect(quality.mutantKillRate).toBeLessThanOrEqual(1);

    // Reported separately, and the distinction is the whole value. A defect
    // derived from the rules under test can only re-measure the plumbing; one
    // derived from the environment is a real question about the suite.
    expect(quality.independentKillRate).toBeGreaterThanOrEqual(0);

    process.stdout.write(
      `\n  suite quality: ${(quality.mutantKillRate * 100).toFixed(0)}% of injected defects caught, ` +
        `${(quality.independentKillRate * 100).toFixed(0)}% of the independent ones\n`,
    );
  }, 300_000);

  it('names the rules that never decide anything', async () => {
    const quality = (await service.quality(project.id))!;
    // Not a failure — a fact worth having. A rule applicable everywhere and
    // violated nowhere adds review effort and decides nothing, and RigorRun
    // over-produces rules on purpose because saying no is cheap.
    expect(Array.isArray(quality.nonDiscriminatingRules)).toBe(true);
    expect(Array.isArray(quality.deadRules)).toBe(true);
  }, 60_000);

  it('survives a restart, because it is written down', async () => {
    const restarted = new Service({ store: new ProjectStore(home), proxy });
    expect((await restarted.quality(project.id))?.benchmarkId).toBeTruthy();
    await restarted.workspace.close();
  });

  it('refuses to do this to a production system', async () => {
    const saved = await store.read(project.id);
    await store.write({ ...saved, safety: 'production' });
    await expect(service.assessSuite(project.id)).rejects.toThrow(/production/);
    await store.write(saved);
  }, 60_000);
});
