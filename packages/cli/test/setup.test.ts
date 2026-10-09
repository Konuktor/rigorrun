/**
 * `rigorrun setup`: a project from a spec, with no interface (audit R-6).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProjectStore } from '@rigorrun/daemon';
import type { EnvironmentContract } from '@rigorrun/core';
import { main } from '../src/main.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
let scratch: string;
let home: string;

async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  try {
    return { code: await main(args), out, err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

const spec = {
  name: 'Desk, set up headlessly',
  goal: 'Confirm a held booking.',
  connector: {
    kind: 'mcp',
    transport: 'stdio',
    command: join(root, 'node_modules', '.bin', 'tsx'),
    args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
    secretNames: ['DESK_RESULT_SHAPE'],
  },
  safety: 'ephemeral',
  secrets: { DESK_RESULT_SHAPE: 'RR_SETUP_TEST_DESK_SHAPE' },
  readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
  verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
  reset: { kind: 'tool', tool: 'reset_desk' },
  teach: [
    { tool: 'record_signoff', args: { bookingId: 'BKG-4001', approver: 'Dana Whitlock' } },
    { tool: 'confirm_booking', args: { bookingId: 'BKG-4001' } },
  ],
  review: { confirm: ['.'] },
};

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rigorrun-setup-spec-'));
  home = await mkdtemp(join(tmpdir(), 'rigorrun-setup-home-'));
});

afterAll(async () => {
  delete process.env['RR_SETUP_TEST_DESK_SHAPE'];
  await rm(scratch, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('rigorrun setup', () => {
  async function reviewSetup(review: { confirm?: string[]; reject?: string[] }) {
    process.env['RR_SETUP_TEST_DESK_SHAPE'] = 'text-json';
    const isolatedHome = await mkdtemp(join(scratch, 'review-home-'));
    const path = join(isolatedHome, 'spec.json');
    await writeFile(
      path,
      JSON.stringify({
        ...spec,
        review,
        quality: true,
        agents: [{ name: 'Must not be registered on refusal', endpoint: 'http://127.0.0.1:1' }],
      }),
    );
    const result = await cli('setup', path, '--home', isolatedHome, '--json');
    const store = new ProjectStore(isolatedHome);
    const projects = (await store.listAll()).projects;
    return { ...result, store, projects };
  }

  async function expectNoDownstream(store: ProjectStore, projectId: string) {
    for (const artefact of ['benchmark', 'suite-source', 'quality', 'quality-source']) {
      expect(await store.readArtefact(projectId, artefact)).toBeUndefined();
    }
    expect((await store.read(projectId)).agents).toEqual([]);
    expect((await store.read(projectId)).runs).toEqual([]);
  }

  it('retains unmatched inferred rules and stops before suite, assessment and agent registration', async () => {
    const result = await reviewSetup({ confirm: ['pattern-that-matches-no-rule'] });
    expect(result.code).toBe(2);
    expect(result.projects).toHaveLength(1);
    const id = result.projects[0]!.id;
    const contract = await result.store.readArtefact<EnvironmentContract>(id, 'contract');
    const pending = contract!.rules.filter((rule) => rule.status === 'inferred');
    expect(pending.length).toBeGreaterThan(0);
    expect(contract!.rules.filter((rule) => rule.status === 'rejected')).toEqual([]);
    expect(result.err).toContain(id);
    for (const rule of pending) expect(result.err).toContain(rule.id);
    await expectNoDownstream(result.store, id);
  }, 180_000);

  it('persists explicit rejection while leaving unmatched rules pending', async () => {
    const result = await reviewSetup({ reject: ['must happen before'] });
    expect(result.code).toBe(2);
    const id = result.projects[0]!.id;
    const contract = await result.store.readArtefact<EnvironmentContract>(id, 'contract');
    expect(contract!.rules.some((rule) => rule.status === 'rejected')).toBe(true);
    expect(contract!.rules.some((rule) => rule.status === 'inferred')).toBe(true);
    await expectNoDownstream(result.store, id);
  }, 180_000);

  it('refuses overlapping confirm and reject matches without persisting either decision', async () => {
    const result = await reviewSetup({ confirm: ['.'], reject: ['.'] });
    expect(result.code).toBe(2);
    const id = result.projects[0]!.id;
    const contract = await result.store.readArtefact<EnvironmentContract>(id, 'contract');
    expect(contract!.rules.some((rule) => rule.status === 'inferred')).toBe(true);
    expect(
      contract!.rules.some((rule) => rule.status === 'confirmed' || rule.status === 'rejected'),
    ).toBe(false);
    expect(result.err).toContain(id);
    expect(result.err).toMatch(/both|conflict/i);
    await expectNoDownstream(result.store, id);
  }, 180_000);

  it.each(['confirm', 'reject'] as const)(
    'refuses an invalid %s regex before creating a project',
    async (decision) => {
      const result = await reviewSetup({ [decision]: ['['] });
      expect(result.code).toBe(2);
      expect(result.err).toMatch(/pattern|regular expression|regex/i);
      expect(result.projects).toEqual([]);
    },
  );

  it('creates, teaches, compiles and builds a project from a spec', async () => {
    // The JSON-in-text shape, so a headless setup also proves R-8 end to end.
    process.env['RR_SETUP_TEST_DESK_SHAPE'] = 'text-json';
    const path = join(scratch, 'desk.json');
    await writeFile(path, JSON.stringify(spec));
    const { code, out, err } = await cli('setup', path, '--home', home, '--json');
    expect(code, err).toBe(0);
    const summary = JSON.parse(out) as { projectId: string; cases: number; records: string[]; rules: { confirmed: number } };
    expect(summary.projectId).toMatch(/^p_/);
    expect(summary.records).toContain('Booking');
    expect(summary.cases).toBeGreaterThan(0);
    expect(summary.rules.confirmed).toBeGreaterThan(0);

    const store = new ProjectStore(home);
    const project = await store.read(summary.projectId);
    expect(project.verifierReads).toHaveLength(3);
    expect(await store.readArtefact(summary.projectId, 'benchmark')).toBeDefined();
    const contract = await store.readArtefact<EnvironmentContract>(summary.projectId, 'contract');
    expect(contract!.rules.some((rule) => rule.status === 'inferred')).toBe(false);
    expect(contract!.rules.some((rule) => rule.status === 'rejected')).toBe(false);
    // The value went to the credential store, and the spec never held it.
    expect(await store.secret('DESK_RESULT_SHAPE')).toBe('text-json');
    expect(await readFile(path, 'utf8')).not.toContain('text-json');
  }, 180_000);

  it('refuses before creating anything when a secret is missing from the environment', async () => {
    delete process.env['RR_SETUP_TEST_DESK_SHAPE'];
    const path = join(scratch, 'missing.json');
    await writeFile(path, JSON.stringify(spec));
    const emptyHome = await mkdtemp(join(tmpdir(), 'rigorrun-setup-empty-'));
    try {
      const { code, err } = await cli('setup', path, '--home', emptyHome);
      expect(code).toBe(2);
      expect(err).toContain('RR_SETUP_TEST_DESK_SHAPE');
      expect((await new ProjectStore(emptyHome).listAll()).projects).toEqual([]);
    } finally {
      await rm(emptyHome, { recursive: true, force: true });
    }
  });

  it('refuses a spec that does not parse', async () => {
    const path = join(scratch, 'broken.json');
    await writeFile(path, JSON.stringify({ name: 'no teach steps', connector: {} }));
    const { code, err } = await cli('setup', path, '--home', home);
    expect(code).toBe(2);
    expect(err).toMatch(/not a usable spec/);
  });
});
