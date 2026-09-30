/**
 * Reproductions of RigorRun defects R-8, R-5 and R-3 through the product's own
 * Service, written only against pre-remediation APIs. Every test asserts the
 * DEFECT: passing on 07dda8c, failing once fixed.
 *
 * Needs the venue-desk fixture's DESK_RESULT_SHAPE toggle (a test fixture, not
 * product code), which the harness copies into the pre-fix checkout.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { induceSchema } from '@rigorrun/mcp';
import { ProjectStore, Service } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const desk = (secretNames: string[]) => ({
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  url: '',
  secretNames,
});

let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-repro-'));
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

describe('R-8 — JSON inside a text block', () => {
  it('DEFECT: the read probe is silent, then compile refuses after the job was demonstrated', async () => {
    await store.setSecret('DESK_RESULT_SHAPE', 'text-json');
    let project = await service.createProject({ name: 'text-json desk', goal: 'Confirm a held booking.' });
    project = (await service.connectEnvironment(project.id, desk(['DESK_RESULT_SHAPE']), 'ephemeral')).project;
    const configured = await service.configureEnvironment(project.id, {
      readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
      verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
      reset: { kind: 'tool', tool: 'reset_desk' },
    });
    expect(configured.readsProblem).toBe('');
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
    await service.finishTeaching(project.id);
    await expect(service.compile(project.id)).rejects.toThrow(/text rather than structured records/);
  }, 120_000);
});

describe('R-5 — the last call, not the call that changed something, is the job', () => {
  it('DEFECT: a trailing no-op call supplies the primary action or its arguments, and the goal is a tool description', async () => {
    let project = await service.createProject({ name: 'desk', goal: 'Confirm the held booking for the annual general meeting.' });
    project = (await service.connectEnvironment(project.id, desk([]), 'ephemeral')).project;
    await service.configureEnvironment(project.id, {
      readOnlyTools: ['list_venues', 'list_organisers', 'get_booking'],
      verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
      reset: { kind: 'tool', tool: 'reset_desk' },
    });
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4003' });
    await service.teachStep(project.id, 'find_bookings', {});
    await service.finishTeaching(project.id);
    const contract = await service.compile(project.id);
    const wrongJob =
      contract.primaryAction !== 'confirm_booking' ||
      (contract.demonstratedArgs['confirm_booking'] as { bookingId?: string } | undefined)?.bookingId === 'BKG-4003';
    expect(wrongJob).toBe(true);
    expect(contract.goal).not.toContain('Confirm the held booking');
  }, 180_000);
});

describe('R-3 — typed cells induce a value-keyed entity', () => {
  it('DEFECT: a table of {kind,value} cells yields no row entity keyed by its identifier', () => {
    const cell = (kind: string, value: unknown) => ({ kind, value });
    const payload = {
      rows: [
        { columns: { amount: cell('Real', 120.5), id: cell('Integer', 1), title: cell('Text', 'Prepare invoice') } },
        { columns: { amount: cell('Real', 80), id: cell('Integer', 2), title: cell('Text', 'Review contract') } },
      ],
      rows_changed: 0,
    };
    const entities = induceSchema([{ tool: 'query', payload }]).schema.entities;
    expect(entities.some((e) => e.idField === 'id' && e.fields.some((f) => f.name === 'title'))).toBe(false);
  });
});
