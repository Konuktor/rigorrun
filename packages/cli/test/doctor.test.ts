/**
 * `doctor` on a project that has something wrong with it.
 *
 * The check worth having is not "is node new enough". It is "can this machine
 * reach the system this project names, right now, with the credentials it has"
 * — which is the question somebody is actually asking when they run this.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '@rigorrun/daemon';
import { main } from '../src/main.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
let home: string;

async function cli(...args: string[]): Promise<{ code: number; out: string }> {
  let out = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  try {
    return { code: await main(args), out };
  } finally {
    spy.mockRestore();
  }
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-doctor-'));
  const proxy = new ProxyServer();
  await proxy.start();
  const service = new Service({ store: new ProjectStore(home), proxy });

  const reachable = await service.createProject({ name: 'Reachable', goal: 'A job.' });
  await service.connectEnvironment(
    reachable.id,
    {
      kind: 'mcp',
      transport: 'stdio',
      command: join(root, 'node_modules', '.bin', 'tsx'),
      args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
      url: '',
      secretNames: [],
    },
    'ephemeral',
  );
  await service.configureEnvironment(reachable.id, {
    readOnlyTools: ['find_bookings'],
    verifierReads: [{ tool: 'find_bookings' }],
    reset: { kind: 'tool', tool: 'reset_desk' },
  });
  // An agent that will not answer, which is the common case worth diagnosing.
  await service.addAgent(reachable.id, { name: 'Missing', endpoint: 'http://127.0.0.1:1/' });

  const broken = await service.createProject({ name: 'Broken', goal: 'A job.' });
  const store = new ProjectStore(home);
  const project = await store.read(broken.id);
  project.connector = {
    kind: 'mcp',
    transport: 'stdio',
    auth: 'header' as const,
    command: join(root, 'node_modules', '.bin', 'tsx'),
    args: [join(root, 'no', 'such', 'server.ts')],
    url: '',
    secretNames: ['DESK_TOKEN'],
  };
  await store.write(project);

  await service.workspace.close();
  await proxy.stop();
}, 180_000);

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('doctor', () => {
  it('reaches a system that is there, and says what it found', async () => {
    const { out } = await cli('doctor', '--home', home);
    expect(out).toContain('Reachable');
    expect(out).toContain('venue-desk');
    expect(out).toMatch(/9 tools/);
  }, 120_000);

  it('names the credential a project needs and this machine does not have', async () => {
    const { out } = await cli('doctor', '--home', home);
    expect(out).toContain('DESK_TOKEN not set on this machine');
  }, 120_000);

  it('says an agent is not answering rather than leaving it looking fine', async () => {
    const { out } = await cli('doctor', '--home', home);
    expect(out).toContain('agent Missing');
  }, 120_000);

  it('exits 2, because a configuration problem is never an agent failing', async () => {
    const { code } = await cli('doctor', '--home', home);
    expect(code).toBe(2);
  }, 120_000);

  it('names secrets and never prints one', async () => {
    process.env['RIGORRUN_SECRET_VALUE'] = 'sk-not-a-real-token';
    await cli('secret', 'set', 'DESK_TOKEN', '--home', home);
    delete process.env['RIGORRUN_SECRET_VALUE'];

    const { out } = await cli('doctor', '--home', home);
    expect(out).toContain('DESK_TOKEN');
    // Diagnostics get pasted into support requests.
    expect(out).not.toContain('sk-not-a-real-token');
  }, 120_000);
});
