/**
 * What survives a reload, a restart, and a system that changed underneath.
 *
 * The failure these guard against does not look like a crash. It looks like a
 * person losing twenty minutes of setup to a stray refresh and not coming back
 * — which is invisible in every metric except the one that matters.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import {
  ProjectStore,
  Service,
  WORKSPACE_VERSION,
  WorkspaceTooNewError,
  detectDrift,
  openWorkspace,
  readWorkspaceMeta,
  type Discovery,
} from '../src/index.ts';

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

/** A fresh service over the same directory — what a runner restart looks like. */
function serviceOver(directory: string): Service {
  return new Service({ store: new ProjectStore(directory), proxy });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-durable-'));
  proxy = new ProxyServer();
  await proxy.start();
}, 60_000);

afterAll(async () => {
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('the workspace format', () => {
  it('is stamped from the first time anybody uses it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rigorrun-fmt-'));
    const opened = await openWorkspace(directory, '0.1.0-alpha.1');
    expect(opened.created).toBe(true);
    expect(opened.meta.version).toBe(WORKSPACE_VERSION);
    expect(opened.applied).toEqual([]);

    // Opening again is not creating again.
    const again = await openWorkspace(directory, '0.1.0-alpha.1');
    expect(again.created).toBe(false);
    expect(again.meta.createdAt).toBe(opened.meta.createdAt);
    await rm(directory, { recursive: true, force: true });
  });

  it('refuses a workspace a newer RigorRun wrote, rather than guessing', async () => {
    // The asymmetry that matters: forward is a migration, backward is data
    // loss. An older reader that "did its best" would silently drop fields it
    // did not know about.
    const directory = await mkdtemp(join(tmpdir(), 'rigorrun-future-'));
    await writeFile(
      join(directory, 'workspace.json'),
      JSON.stringify({ version: WORKSPACE_VERSION + 7, createdAt: new Date().toISOString() }),
    );
    await expect(openWorkspace(directory, '0.1.0-alpha.1')).rejects.toThrow(WorkspaceTooNewError);
    await expect(openWorkspace(directory, '0.1.0-alpha.1')).rejects.toThrow(/Upgrade RigorRun/);
    await rm(directory, { recursive: true, force: true });
  });

  it('records which RigorRun last wrote, for when somebody asks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rigorrun-stamp-'));
    await openWorkspace(directory, '9.9.9');
    expect((await readWorkspaceMeta(directory))?.lastWrittenBy).toBe('9.9.9');
    await rm(directory, { recursive: true, force: true });
  });
});

describe('setup that survives a reload', () => {
  let projectId: string;

  it('keeps what the system published, so a fresh page can show it', async () => {
    const service = serviceOver(home);
    const project = await service.createProject({ name: 'Durable', goal: 'A job.' });
    projectId = project.id;
    await service.connectEnvironment(projectId, DESK, 'ephemeral');
    await service.workspace.close();

    // A completely new service, as if the runner had been restarted.
    const restarted = serviceOver(home);
    const discovery = await restarted.discovery(projectId);
    expect(discovery?.serverName).toBe('venue-desk');
    expect(discovery?.tools).toHaveLength(9);
    // And it knows the session itself is gone.
    expect(restarted.isConnected(projectId)).toBe(false);
  }, 120_000);

  it('resumes a recording that was half done', async () => {
    const service = serviceOver(home);
    await service.configureEnvironment(projectId, {
      readOnlyTools: ['find_bookings', 'get_booking'],
      verifierReads: [{ tool: 'find_bookings' }],
      reset: { kind: 'tool', tool: 'reset_desk' },
    });
    await service.startTeaching(projectId);
    await service.teachStep(projectId, 'get_booking', { bookingId: 'BKG-4001' });
    await service.teachStep(projectId, 'record_signoff', {
      bookingId: 'BKG-4001',
      approver: 'Dana Whitlock',
    });
    // The tab is closed mid-recording. Nothing was "finished".
    await service.workspace.close();

    const restarted = serviceOver(home);
    expect(await restarted.resumeTeaching(projectId)).toBe(true);
    const steps = await restarted.recordedSoFar(projectId);
    expect(steps.map((step) => step.tool)).toEqual(['record_signoff']);

    // And it can be carried on rather than merely inspected.
    await restarted.teachStep(projectId, 'confirm_booking', { bookingId: 'BKG-4001' });
    const finished = await restarted.finishTeaching(projectId);
    expect(finished.questions.length).toBeGreaterThan(0);
    await restarted.workspace.close();
  }, 180_000);

  it('forgets a recording once it has been compiled', async () => {
    // Resuming a finished recording would append to something already turned
    // into a contract, which is worse than losing it.
    const service = serviceOver(home);
    expect(await service.resumeTeaching(projectId)).toBe(false);
    await service.workspace.close();
  }, 60_000);

  it('keeps what it worked out, so the review screen comes back', async () => {
    const service = serviceOver(home);
    const induced = await service.artefact<{ questions: unknown[] }>(projectId, 'induced');
    expect(induced?.questions.length).toBeGreaterThan(0);
    await service.workspace.close();
  }, 60_000);
});

describe('reconnecting', () => {
  it('opens the session again and reports that nothing moved', async () => {
    const service = serviceOver(home);
    const project = await service.createProject({ name: 'Reconnect', goal: 'A job.' });
    await service.connectEnvironment(project.id, DESK, 'ephemeral');
    await service.workspace.close();

    const restarted = serviceOver(home);
    expect(restarted.isConnected(project.id)).toBe(false);
    const again = await restarted.reconnect(project.id);
    expect(restarted.isConnected(project.id)).toBe(true);
    expect(again.serverName).toBe('venue-desk');
    expect(again.drift?.unchanged).toBe(true);
    await restarted.workspace.close();
  }, 180_000);
});

describe('a system that changed while we were not looking', () => {
  const base: Discovery = {
    serverName: 'desk',
    serverVersion: '1.0.0',
    protocolVersion: '2025-11-25',
    discoveredAt: '2026-02-01T09:00:00.000Z',
    latencyMs: 10,
    tools: [
      {
        name: 'get_thing',
        description: '',
        params: [{ name: 'thingId', type: 'string', required: true, description: '' }],
        unsupported: [],
        schemaTruncated: false,
        hints: { readOnly: true },
        risk: { level: 'read', source: 'server-hint', rationale: '' },
      },
      {
        name: 'change_thing',
        description: '',
        params: [{ name: 'thingId', type: 'string', required: true, description: '' }],
        unsupported: [],
        schemaTruncated: false,
        hints: {},
        risk: { level: 'unknown', source: 'default', rationale: '' },
      },
    ],
  };

  const withTools = (tools: Discovery['tools']): Discovery => ({ ...base, tools });

  it('says nothing when nothing changed', () => {
    const report = detectDrift(base, { ...base, discoveredAt: 'later' });
    expect(report.unchanged).toBe(true);
    expect(report.serious).toEqual([]);
  });

  it('treats a vanished tool as serious, because cases call it', () => {
    const report = detectDrift(base, withTools([base.tools[0]!]));
    expect(report.serious.map((drift) => drift.kind)).toEqual(['tool_removed']);
    expect(report.serious[0]?.detail).toMatch(/rather than because of your agent/);
  });

  it('treats a new tool as harmless, because nothing uses it yet', () => {
    const added = withTools([
      ...base.tools,
      { ...base.tools[0]!, name: 'brand_new' },
    ]);
    const report = detectDrift(base, added);
    expect(report.drifts.map((drift) => drift.kind)).toEqual(['tool_added']);
    expect(report.serious).toEqual([]);
  });

  it('separates a newly required argument from a newly optional one', () => {
    const required = withTools([
      base.tools[0]!,
      {
        ...base.tools[1]!,
        params: [
          ...base.tools[1]!.params,
          { name: 'reason', type: 'string', required: true, description: '' },
        ],
      },
    ]);
    expect(detectDrift(base, required).serious.map((d) => d.kind)).toEqual(['argument_added']);

    const optional = withTools([
      base.tools[0]!,
      {
        ...base.tools[1]!,
        params: [
          ...base.tools[1]!.params,
          { name: 'reason', type: 'string', required: false, description: '' },
        ],
      },
    ]);
    expect(detectDrift(base, optional).serious).toEqual([]);
  });

  it('flags a read-only claim that reversed, because a person may have believed it', () => {
    const flipped = withTools([
      { ...base.tools[0]!, hints: { readOnly: false } },
      base.tools[1]!,
    ]);
    const report = detectDrift(base, flipped);
    expect(report.serious.map((drift) => drift.kind)).toContain('hint_changed');
    expect(report.serious[0]?.detail).toMatch(/RigorRun never acted on that claim, but you may have/);
  });

  it('flags a connector that is answering as somebody else entirely', () => {
    const report = detectDrift(base, { ...base, serverName: 'not-the-desk' });
    expect(report.serious.map((drift) => drift.kind)).toContain('server_changed');
  });

  it('puts what matters first', () => {
    const messy = withTools([
      { ...base.tools[0]!, name: 'renamed' },
      { ...base.tools[1]!, params: [] },
    ]);
    const report = detectDrift(base, messy);
    const seriousness = report.drifts.map((drift) => drift.serious);
    expect(seriousness).toEqual([...seriousness].sort((a, b) => Number(b) - Number(a)));
  });
});

describe('a completed project', () => {
  it('is intact after the runner has gone away and come back', async () => {
    const service = serviceOver(home);
    const projects = await service.listProjects();
    const durable = projects.find((project) => project.name === 'Durable');
    expect(durable).toBeDefined();
    expect(durable?.connector).toMatchObject({ kind: 'mcp', transport: 'stdio' });
    expect(durable?.verifierReads).toHaveLength(1);
    expect(durable?.reset).toMatchObject({ kind: 'tool', tool: 'reset_desk' });

    // The artefacts are files, not memory.
    const files = await readFile(
      join(home, 'projects', durable!.id, 'project.json'),
      'utf8',
    );
    expect(JSON.parse(files)).toMatchObject({ name: 'Durable' });
    await service.workspace.close();
  }, 60_000);
});

describe('a recording that has only read so far is still a recording', () => {
  /**
   * The bug this exists for. Reads are deliberately kept out of the trace — the
   * contract comes from what changed — so a recording in which somebody has
   * only looked around had an empty `entries` array, and "no entries" was read
   * as "no recording". After a restart the interface then offered to *start*
   * one, which resets the system again and throws away the before-state the
   * first reset paid for.
   */
  it('reports itself as in progress before anything has been written', async () => {
    const service = serviceOver(home);
    const project = await service.createProject({ name: 'Only looked', goal: 'A job.' });
    await service.connectEnvironment(project.id, DESK, 'ephemeral');
    await service.configureEnvironment(project.id, {
      readOnlyTools: ['find_bookings'],
      verifierReads: [{ tool: 'find_bookings' }],
      reset: { kind: 'tool', tool: 'reset_desk' },
    });
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'find_bookings', {});
    await service.workspace.close();

    // A restarted runner, reading only what is on disk.
    const restarted = serviceOver(home);
    const state = await restarted.recordingState(project.id);
    // Nothing in the trace, because a read is not work an agent must reproduce.
    expect(state.steps).toEqual([]);
    // And yet: a recording is open, and the starting point is still here.
    expect(state.inProgress).toBe(true);
    expect(await restarted.resumeTeaching(project.id)).toBe(true);
    await restarted.workspace.close();
  }, 120_000);
});
