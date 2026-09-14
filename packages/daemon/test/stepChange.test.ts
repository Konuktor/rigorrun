/**
 * Audit finding R-5: the job is the call that changed the system.
 *
 * Against a server whose one `execute` tool both reads and writes, the
 * recording's last call — a read-back — became the primary action, its
 * arguments became the case's inputs, and the agent was told the tool's doc
 * comment instead of the job. The demonstration now watches the nominated
 * reads across every call the operator has not vouched for, and the compiler
 * takes the job from the calls that changed something.
 *
 * The venue desk reproduces both halves without a new fixture: confirming a
 * booking that is already confirmed is a call of a writing tool that changes
 * nothing, and `find_bookings` is left unvouched, as `execute` was.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Benchmark, CanonicalHumanTrace, EnvironmentContract } from '@rigorrun/core';
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
  home = await mkdtemp(join(tmpdir(), 'rigorrun-stepchange-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
}, 60_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('a recording that ends in calls which change nothing', () => {
  it('records which calls changed the system', async () => {
    project = await service.createProject({
      name: 'Desk',
      goal: 'Confirm the held booking for the annual general meeting.',
    });
    project = (await service.connectEnvironment(project.id, DESK, 'ephemeral')).project;
    project = (
      await service.configureEnvironment(project.id, {
        // `find_bookings` deliberately not vouched for, as `execute` was not.
        readOnlyTools: ['list_venues', 'list_organisers', 'get_booking'],
        verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
        reset: { kind: 'tool', tool: 'reset_desk' },
      })
    ).project;

    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
    // Already confirmed: the tool writes, and this call writes nothing.
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4003' });
    await service.teachStep(project.id, 'find_bookings', {});
    project = (await service.finishTeaching(project.id)).project;

    const trace = await store.readArtefact<CanonicalHumanTrace>(project.id, 'trace');
    expect(trace?.steps.map((step) => [step.action?.name, step.action?.changedState])).toEqual([
      ['record_signoff', true],
      ['confirm_booking', true],
      ['confirm_booking', false],
      ['find_bookings', false],
    ]);
  }, 120_000);

  it('takes the job, its arguments and its goal from what changed and what the person said', async () => {
    const contract: EnvironmentContract = await service.compile(project.id);
    expect(contract.primaryAction).toBe('confirm_booking');
    expect(contract.demonstratedArgs['confirm_booking']).toEqual({ bookingId: 'BKG-4001' });
    expect(contract.completionActions).not.toContain('find_bookings');
    expect(contract.goal).toBe('Confirm the held booking for the annual general meeting');
    // The job changes an existing booking, so the booking's identifier is how
    // the request says which one — and a check that omits it passes the wrong one.
    expect(contract.argumentBindings).toContainEqual(
      expect.objectContaining({ field: 'bookingId', param: 'bookingId', mode: 'equals' }),
    );

    await service.review(project.id, { confirmedRuleIds: contract.rules.map((rule) => rule.id) });
    const benchmark: Benchmark = await service.generate(project.id);
    const happy = benchmark.cases.find((entry) => entry.category === 'happy_path');
    expect(happy).toBeDefined();
    expect(happy!.task.instruction).toContain('Confirm the held booking for the annual general meeting');
    expect(happy!.task.instruction).not.toContain('Moves a held booking to confirmed');
    expect(happy!.task.inputs['bookingId']).toBe('BKG-4001');
    expect(happy!.checks.find((check) => check.id === 'success__performed')?.target).toContain('bookingId=BKG-4001');
  }, 180_000);
});
