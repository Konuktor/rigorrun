/**
 * Audit IO-7-mixed-a, at the level a person configures: a verifier read and one
 * of the system's own reads nominated together.
 *
 * With a verifier nominated, RigorRun reads the world only through it, at setup
 * and in the demonstration as well as in the verdict, and says which reads it
 * will ignore. A read that goes through the system's own connection can only add
 * the system's account of itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const desk = {
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  url: '',
  secretNames: ['DESK_STATE_FILE'],
};

const READ_ONLY = [
  'list_venues', 'list_organisers', 'find_bookings', 'get_booking',
  'verifier:list_venues', 'verifier:list_organisers', 'verifier:find_bookings', 'verifier:get_booking',
];

let scratch: string;
let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rigorrun-mixed-state-'));
  home = await mkdtemp(join(tmpdir(), 'rigorrun-mixed-'));
  store = new ProjectStore(home);
  await store.setSecret('DESK_STATE_FILE', join(scratch, 'desk.json'));
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
}, 60_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

async function configured(name: string, verifierReads: { tool: string }[]) {
  const project = await service.createProject({ name, goal: 'Confirm a held booking.' });
  await service.connectEnvironment(project.id, { ...desk, verifier: desk }, 'ephemeral');
  return service.configureEnvironment(project.id, {
    readOnlyTools: READ_ONLY,
    verifierReads,
    reset: { kind: 'tool', tool: 'reset_desk' },
  });
}

async function demonstratedRecordTypes(projectId: string): Promise<string[]> {
  await service.startTeaching(projectId);
  await service.teachStep(projectId, 'record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
  await service.teachStep(projectId, 'confirm_booking', { bookingId: 'BKG-4001' });
  const finished = await service.finishTeaching(projectId);
  return finished.schema.entities.map((entity) => entity.name).sort();
}

describe('a verifier read nominated beside the system’s own reads', () => {
  it('names the reads it will ignore, in either order, and says why', async () => {
    for (const reads of [
      [{ tool: 'verifier:find_bookings' }, { tool: 'list_organisers' }],
      [{ tool: 'list_organisers' }, { tool: 'verifier:find_bookings' }],
    ]) {
      const result = await configured('Desk, mixed', reads);
      expect(result.readsIgnored).toEqual(['list_organisers']);
      expect(result.readsProblem).toMatch(/ignored: list_organisers/);
      expect(result.readsProblem).toMatch(/SELF_REPORTED/);
    }
  }, 120_000);

  it('has nothing to say about ignored reads when every read goes through the verifier', async () => {
    const result = await configured('Desk, verified', [{ tool: 'verifier:find_bookings' }]);
    expect(result.readsIgnored).toEqual([]);
    expect(result.readsProblem).not.toMatch(/ignored/);
  }, 60_000);

  it('records the demonstration from the verifier reads alone', async () => {
    const control = await configured('Desk, verifier only', [{ tool: 'verifier:find_bookings' }]);
    const mixed = await configured('Desk, verifier and organisers', [
      { tool: 'list_organisers' },
      { tool: 'verifier:find_bookings' },
    ]);
    const expected = await demonstratedRecordTypes(control.project.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(await demonstratedRecordTypes(mixed.project.id)).toEqual(expected);
  }, 240_000);
});
