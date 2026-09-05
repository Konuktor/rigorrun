/**
 * A system that misdescribes itself.
 *
 * `detectMismatch` has been implemented and unit-tested since the MCP client
 * landed, and called by nothing — a capability that existed on paper. This is
 * it doing its job against a real server: the venue desk annotates
 * `check_availability` as `readOnlyHint: true`, and it quietly increments an
 * enquiry counter, which is by far the commonest way a read-only claim stops
 * being true. Somebody adds a counter for a dashboard six months after the
 * annotation was written, and nobody revisits what the tool claimed.
 *
 * What RigorRun does about it is *nothing*, and that is the design. It already
 * treats every tool nobody has vouched for as one that writes, so no run
 * changes. What changes is what the person is told — because a system that
 * misdescribes one tool may misdescribe others, and they are about to trust
 * what it says about their agent.
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
let proxy: ProxyServer;
let service: Service;
let project: Project;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-mismatch-'));
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store: new ProjectStore(home), proxy });

  project = await service.createProject({ name: 'Desk', goal: 'Confirm a held booking.' });
  await service.connectEnvironment(project.id, DESK, 'ephemeral');
  await service.configureEnvironment(project.id, {
    readOnlyTools: ['find_bookings', 'list_venues', 'list_organisers', 'get_booking'],
    verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
    reset: { kind: 'tool', tool: 'reset_desk' },
  });
}, 120_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('a read-only claim contradicted by what happened', () => {
  it('carries the claim without acting on it', async () => {
    const discovery = await service.discovery(project.id);
    const tool = discovery?.tools.find((entry) => entry.name === 'check_availability');
    // Shown as the server's claim, exactly as the specification asks.
    expect(tool?.hints.readOnly).toBe(true);
    expect(tool?.risk).toMatchObject({ level: 'read', source: 'server-hint' });
  });

  it('notices when the claim turns out not to hold', async () => {
    await service.startTeaching(project.id);
    // Nothing said about this tool yet, so nothing to contradict.
    expect(service.mismatches(project.id)).toEqual([]);

    await service.teachStep(project.id, 'check_availability', { venueId: 'VEN-1' });

    const found = service.mismatches(project.id);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ tool: 'check_availability' });
    expect(found[0]?.claimed).toMatch(/readOnly/i);
    expect(found[0]?.observed).toMatch(/state/i);
  }, 120_000);

  it('does not accuse a tool that told the truth', async () => {
    // `find_bookings` makes the same claim and keeps it. A detector that
    // flagged every annotated tool would be a detector nobody reads.
    await service.teachStep(project.id, 'find_bookings', {});
    expect(service.mismatches(project.id).map((entry) => entry.tool)).toEqual([
      'check_availability',
    ]);
  }, 120_000);

  it('says it once, however many times the tool is called', async () => {
    await service.teachStep(project.id, 'check_availability', { venueId: 'VEN-2' });
    await service.teachStep(project.id, 'check_availability', { venueId: 'VEN-3' });
    expect(service.mismatches(project.id)).toHaveLength(1);
  }, 120_000);

  it('changes nothing about how the tool is treated', async () => {
    // The whole point. RigorRun already assumed this could write, because
    // nobody vouched for it — so noticing the contradiction is information for
    // a person, not a change of behaviour.
    const saved = await service.readProject(project.id);
    expect(saved.readOnlyTools).not.toContain('check_availability');
  });
});
