/**
 * The funnel, the human clock, and the bundle we ask strangers to send us.
 *
 * Two things are being pinned here. That the number we report is a person's
 * wall-clock time rather than the machine's — because the machine's number is
 * the one that would let us believe onboarding is fast while everybody gives
 * up at step three. And that the bundle contains nothing we would be ashamed
 * to receive.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTIVATION_STAGES,
  ActivationLog,
  ProjectStore,
  buildFeedbackBundle,
  formatElapsed,
  newProject,
  scanForLeaks,
  stageCode,
  summarise,
} from '../src/index.ts';

let home: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-activation-'));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('the funnel', () => {
  it('has ten ordered stages, and they are readable at a glance', () => {
    expect(ACTIVATION_STAGES).toHaveLength(10);
    expect(stageCode('installation_started')).toBe('A0');
    expect(stageCode('first_real_verdict')).toBe('A8');
    expect(stageCode('second_run_completed')).toBe('A9');
  });

  it('records how far somebody got, and keeps them apart by project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rigorrun-funnel-'));
    const log = new ActivationLog(directory);
    await log.stage('runner_started');
    await log.stage('project_created', 'p_one');
    await log.stage('environment_connected', 'p_one');
    await log.stage('project_created', 'p_two');

    const one = await log.summary('p_one');
    expect(one.reached).toBe('environment_connected');
    expect(one.reachedIndex).toBe(3);

    // A second attempt is a second funnel, not a continuation of the first.
    const two = await log.summary('p_two');
    expect(two.reached).toBe('project_created');
    await rm(directory, { recursive: true, force: true });
  });

  it('counts what went wrong as a class, never as a message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rigorrun-attempts-'));
    const log = new ActivationLog(directory);
    await log.attempt('environment_connection_failed', 'p');
    await log.attempt('environment_connection_failed', 'p');
    await log.attempt('agent_probe_failed', 'p');

    expect((await log.summary('p')).attempts).toEqual({
      environment_connection_failed: 2,
      agent_probe_failed: 1,
    });

    // Nothing in the file names anything.
    const raw = await readFile(join(directory, 'activation.jsonl'), 'utf8');
    expect(raw).not.toMatch(/https?:|\/home\/|command|hostname/);
    await rm(directory, { recursive: true, force: true });
  });

  it('knows when nothing has ever happened, which is the install moment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rigorrun-new-'));
    const log = new ActivationLog(directory);
    expect(await log.isNew()).toBe(true);
    await log.stage('runner_started');
    expect(await log.isNew()).toBe(false);
    await rm(directory, { recursive: true, force: true });
  });

  it('never breaks the thing it is measuring', async () => {
    // A funnel that can fail a run is worse than no funnel. A directory that
    // is actually a file is the cheapest way to make every write fail.
    const directory = await mkdtemp(join(tmpdir(), 'rigorrun-broken-'));
    const blocked = join(directory, 'not-a-directory');
    await writeFile(blocked, 'this is a file');

    const log = new ActivationLog(join(blocked, 'inside'));
    await expect(log.stage('runner_started')).resolves.toBeUndefined();
    await expect(log.attempt('run_failed')).resolves.toBeUndefined();
    expect(await log.read()).toEqual([]);
    expect((await log.summary()).reached).toBeNull();
    await rm(directory, { recursive: true, force: true });
  });
});

describe('the number we report', () => {
  it('is wall-clock human time from making a project to a first verdict', () => {
    const summary = summarise([
      { at: '2026-02-01T09:00:00.000Z', project: 'p', stage: 'runner_started' },
      { at: '2026-02-01T09:01:00.000Z', project: 'p', stage: 'project_created' },
      // Eleven minutes of a person reading, deciding, and getting it wrong once.
      { at: '2026-02-01T09:05:00.000Z', project: 'p', attempt: 'environment_connection_failed' },
      { at: '2026-02-01T09:12:34.000Z', project: 'p', stage: 'first_real_verdict' },
    ]);

    expect(summary.humanMsToFirstVerdict).toBe(11 * 60_000 + 34_000);
    expect(formatElapsed(summary.humanMsToFirstVerdict!)).toBe('11m 34s');
    // The failure on the way is part of the story, not noise to be dropped.
    expect(summary.attempts['environment_connection_failed']).toBe(1);
  });

  it('is unknown until somebody actually gets one', () => {
    const summary = summarise([
      { at: '2026-02-01T09:00:00.000Z', project: 'p', stage: 'project_created' },
      { at: '2026-02-01T09:04:00.000Z', project: 'p', stage: 'benchmark_built' },
    ]);
    // Reporting a partial number here is how an onboarding claim becomes a lie.
    expect(summary.humanMsToFirstVerdict).toBeNull();
    expect(summary.reached).toBe('benchmark_built');
  });

  it('reads the way somebody would say it', () => {
    expect(formatElapsed(45_000)).toBe('45s');
    expect(formatElapsed(12 * 60_000 + 34_000)).toBe('12m 34s');
    expect(formatElapsed(3 * 3_600_000 + 4 * 60_000 + 5_000)).toBe('3h 4m 5s');
  });
});

describe('the feedback bundle', () => {
  it('describes a project without describing anybody’s business', async () => {
    const store = new ProjectStore(home);
    const project = newProject({
      id: 'p_bundle',
      name: 'Acme refunds for Contoso',
      goal: 'Refund a customer named Priya at 14 Bramble Lane.',
      now: new Date().toISOString(),
    });
    project.connector = {
      kind: 'mcp',
      transport: 'stdio',
      command: '/home/someone/secret-tool',
      args: ['--token', 'hunter2'],
      url: 'https://internal.acme.example/mcp',
      secretNames: ['ACME_TOKEN'],
    };
    project.safety = 'staging';
    await store.write(project);
    await store.setSecret('ACME_TOKEN', 'sk-live-notarealtoken000000');

    const bundle = await buildFeedbackBundle({ store, version: '0.1.0-alpha.1' });
    const text = JSON.stringify(bundle);

    for (const forbidden of [
      'Acme',
      'Contoso',
      'Priya',
      'Bramble',
      'hunter2',
      'sk-live-notarealtoken000000',
      '/home/someone',
      'internal.acme.example',
      'secret-tool',
    ]) {
      expect(text, `${forbidden} reached the bundle`).not.toContain(forbidden);
    }

    // What it does say is enough to start debugging.
    const shape = bundle.projects.find((entry) => entry.id === 'p_bundle')!;
    expect(shape.connector).toBe('mcp:stdio');
    expect(shape.safety).toBe('staging');
    expect(shape.usesCredentials).toBe(true);
    expect(bundle.machine.node).toBe(process.versions.node);
    expect(bundle.rigorrun.version).toBe('0.1.0-alpha.1');
  });

  it('says in itself what it leaves out', async () => {
    const bundle = await buildFeedbackBundle({
      store: new ProjectStore(home),
      version: '0.1.0-alpha.1',
    });
    expect(bundle.omitted.join(' ')).toMatch(/credentials/);
    expect(bundle.omitted.join(' ')).toMatch(/tool arguments/);
  });

  it('is checked for leaks even though it is built by naming fields', () => {
    // The construction should make this impossible. It runs anyway, because
    // "should be impossible" is what everybody says about the thing that leaks.
    const clean = {
      format: 1,
      generatedAt: '2026-02-01T09:00:00.000Z',
      rigorrun: { version: '0.1.0-alpha.1' },
      machine: { os: 'linux', osRelease: '6.1', arch: 'x64', node: '22.0.0' },
      workspace: { format: 1, ageDays: 0 },
      activation: summarise([]),
      projects: [],
      problems: {},
      omitted: [],
    };
    expect(scanForLeaks(clean, ['sk-live-abcdefgh'])).toEqual([]);

    const dirty = { ...clean, problems: { 'failed at https://internal.example/mcp': 1 } };
    expect(scanForLeaks(dirty, [])).toContain('a URL');

    const withSecret = { ...clean, problems: { 'sk-live-abcdefgh': 1 } };
    expect(scanForLeaks(withSecret, ['sk-live-abcdefgh'])).toContain('sk-l…');
  });
});
