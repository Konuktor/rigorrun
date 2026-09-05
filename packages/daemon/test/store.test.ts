/**
 * The store, and the promises it makes about where things stay.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore, newProject, nextSteps, timeToFirstVerdictMs } from '../src/index.ts';

const roots: string[] = [];

async function store(): Promise<ProjectStore> {
  const root = await mkdtemp(join(tmpdir(), 'rigorrun-store-'));
  roots.push(root);
  return new ProjectStore(root);
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('projects survive a restart', () => {
  it('writes one and reads it back', async () => {
    const s = await store();
    const project = newProject({ id: 'p1', name: 'My support agent', now: '2026-02-01T09:00:00.000Z' });
    await s.write(project);
    expect(await s.read('p1')).toEqual(project);
  });

  it('lists what exists and nothing else', async () => {
    const s = await store();
    expect(await s.list()).toEqual([]);
    await s.write(newProject({ id: 'a', name: 'A', now: '2026-02-01T09:00:00.000Z' }));
    await s.write(newProject({ id: 'b', name: 'B', now: '2026-02-01T09:00:00.000Z' }));
    expect((await s.list()).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('deletes everything belonging to a project', async () => {
    const s = await store();
    await s.write(newProject({ id: 'gone', name: 'Gone', now: '2026-02-01T09:00:00.000Z' }));
    await s.writeArtefact('gone', 'benchmark', { cases: [] });
    await s.delete('gone');
    expect(await s.has('gone')).toBe(false);
    expect(await s.readArtefact('gone', 'benchmark')).toBeUndefined();
  });
});

describe('what must not escape the project directory', () => {
  it('refuses a project id that could climb out', async () => {
    const s = await store();
    for (const id of ['../escape', 'a/b', '..', 'x'.repeat(100), '']) {
      await expect(s.read(id)).rejects.toThrow(/not a usable project id/);
    }
  });

  it('refuses an artefact name that could climb out', async () => {
    const s = await store();
    await s.write(newProject({ id: 'p', name: 'P', now: '2026-02-01T09:00:00.000Z' }));
    for (const name of ['../../etc/passwd', 'a/b', '..']) {
      await expect(s.writeArtefact('p', name, {})).rejects.toThrow(/not a usable file name/);
    }
  });
});

describe('secrets', () => {
  it('are kept in one place, readable only by the owner', async () => {
    const s = await store();
    await s.setSecret('DESK_TOKEN', 'sk-not-a-real-token');
    expect(await s.secret('DESK_TOKEN')).toBe('sk-not-a-real-token');

    const mode = (await stat(join(s.path, 'secrets.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('never appear in a project file', async () => {
    const s = await store();
    await s.setSecret('DESK_TOKEN', 'sk-not-a-real-token');
    const project = newProject({ id: 'p', name: 'P', now: '2026-02-01T09:00:00.000Z' });
    project.connector = {
      kind: 'mcp',
      transport: 'http',
      command: '',
      args: [],
      url: 'https://desk.example.com/mcp',
      // The name travels; the value does not. That is the whole arrangement.
      secretNames: ['DESK_TOKEN'],
    };
    await s.write(project);

    const raw = await readFile(join(s.path, 'projects', 'p', 'project.json'), 'utf8');
    expect(raw).toContain('DESK_TOKEN');
    expect(raw).not.toContain('sk-not-a-real-token');
  });

  it('can be removed', async () => {
    const s = await store();
    await s.setSecret('GONE', 'x');
    await s.deleteSecret('GONE');
    expect(await s.secret('GONE')).toBeUndefined();
  });
});

describe('run artefacts', () => {
  it('are stored per run and read back by id', async () => {
    const s = await store();
    await s.write(newProject({ id: 'p', name: 'P', now: '2026-02-01T09:00:00.000Z' }));
    await s.writeRun('p', 'run_1', { runId: 'run_1', verdict: 'FAIL' });
    expect(await s.readRun('p', 'run_1')).toMatchObject({ verdict: 'FAIL' });
    expect(await s.readRun('p', 'run_missing')).toBeUndefined();
  });

  it('are written owner-only, because they hold real tool arguments', async () => {
    const s = await store();
    await s.write(newProject({ id: 'p', name: 'P', now: '2026-02-01T09:00:00.000Z' }));
    await s.writeRun('p', 'run_1', { secretish: 'a customer id' });
    const mode = (await stat(join(s.path, 'projects', 'p', 'runs', 'run_1.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('what to do next', () => {
  it('asks for a system first, and says why', () => {
    const project = newProject({ id: 'p', name: 'P', now: '2026-02-01T09:00:00.000Z' });
    const steps = nextSteps(project);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ id: 'connect_environment' });
    expect(steps[0]!.why).toMatch(/nothing can be verified/);
  });

  it('walks through the rest once there is one', () => {
    const project = newProject({ id: 'p', name: 'P', now: '2026-02-01T09:00:00.000Z' });
    project.connector = {
      kind: 'mcp',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      url: '',
      secretNames: [],
    };
    const ids = nextSteps(project).map((step) => step.id);
    expect(ids).toEqual(['nominate_reads', 'teach_a_job', 'generate', 'connect_agent']);
  });

  it('has nothing left to say once a project is ready', () => {
    const project = newProject({ id: 'p', name: 'P', now: '2026-02-01T09:00:00.000Z' });
    project.connector = {
      kind: 'mcp', transport: 'stdio', command: 'node', args: [], url: '', secretNames: [],
    };
    project.verifierReads = [{ tool: 'get_thing', args: {} }];
    project.timings.workflowRecordedAt = '2026-02-01T09:05:00.000Z';
    project.timings.benchmarkGeneratedAt = '2026-02-01T09:06:00.000Z';
    project.agents = [
      {
        id: 'a', name: 'A', kind: 'http', endpoint: 'http://127.0.0.1:8900/',
        command: '', args: [], lastProbeAt: null, lastProbeOk: true, lastProbeProblem: '',
      },
    ];
    expect(nextSteps(project)).toEqual([]);
  });
});

describe('time to first verdict', () => {
  it('is unknown until there is one', () => {
    expect(timeToFirstVerdictMs(newProject({ id: 'p', name: 'P', now: '2026-02-01T09:00:00.000Z' }))).toBeNull();
  });

  it('is measured from creating the project, not from starting the run', () => {
    const project = newProject({ id: 'p', name: 'P', now: '2026-02-01T09:00:00.000Z' });
    project.timings.firstVerdictAt = '2026-02-01T09:08:30.000Z';
    expect(timeToFirstVerdictMs(project)).toBe(510_000);
  });
});
