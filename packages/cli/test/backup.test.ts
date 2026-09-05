/**
 * Moving somebody's work between machines, without moving their credentials.
 *
 * Two promises are under test and both are the kind that only matter when they
 * are broken. A bundle must not carry a credential value unless somebody asked
 * for one by name — a file with a production token in it cannot be un-emailed.
 * And an imported project must not open its connector until a person has read
 * the command it would run, because `import-project` is exactly the shape of
 * thing that gets forwarded in a chat and run without looking.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore, newProject, assertConnectorTrusted } from '@rigorrun/daemon';
import { cmdBackup, cmdExportProject, cmdImportProject, cmdRestore, cmdTrust } from '../src/backup.ts';
import type { Flags } from '../src/commands.ts';

const roots: string[] = [];
async function workspace(): Promise<{ home: string; store: ProjectStore }> {
  const home = await mkdtemp(join(tmpdir(), 'rigorrun-bundle-'));
  roots.push(home);
  const store = new ProjectStore(home);
  const project = newProject({ id: 'p_1', name: 'Desk agent', now: '2026-02-01T09:00:00.000Z' });
  project.connector = {
    kind: 'mcp',
    transport: 'stdio',
    command: '/usr/local/bin/desk-mcp',
    args: ['--staging'],
    url: '',
    secretNames: ['DESK_TOKEN'],
  };
  await store.write(project);
  await store.writeArtefact('p_1', 'benchmark', { cases: [{ id: 'c1' }] });
  await store.setSecret('DESK_TOKEN', 'sk-not-a-real-token');
  return { home, store };
}

const flags = (home: string, extra: Record<string, unknown> = {}): Flags =>
  ({ home, json: false, quiet: true, agent: [], published: false, ...extra }) as Flags;

afterEach(async () => {
  for (const home of roots.splice(0)) await rm(home, { recursive: true, force: true });
});

describe('exporting a project', () => {
  it('carries the names of the credentials it needs, and none of the values', async () => {
    const { home } = await workspace();
    const out = join(home, 'bundle.json');
    expect(await cmdExportProject('p_1', flags(home, { out }))).toBe(0);

    const bundle = await readFile(out, 'utf8');
    // The name has to travel — an importer must be told what to set.
    expect(bundle).toContain('DESK_TOKEN');
    // The value must not.
    expect(bundle).not.toContain('sk-not-a-real-token');
    expect(JSON.parse(bundle).containsSecrets).toBe(false);
    // Nor the recording, which is the customer's own work in their own system.
    expect(JSON.parse(bundle).artefacts.trace).toBeUndefined();
  });

  it('carries values only when asked, and says so in the file', async () => {
    const { home } = await workspace();
    const out = join(home, 'with-secrets.json');
    expect(await cmdExportProject('p_1', flags(home, { out, withSecrets: true }))).toBe(0);

    const bundle = JSON.parse(await readFile(out, 'utf8'));
    expect(bundle.containsSecrets).toBe(true);
    expect(bundle.secrets.DESK_TOKEN).toBe('sk-not-a-real-token');
  });
});

describe('importing a project', () => {
  it('lands under a new id, with nothing claimed about this machine', async () => {
    const { home } = await workspace();
    const out = join(home, 'bundle.json');
    await cmdExportProject('p_1', flags(home, { out }));

    const elsewhere = await mkdtemp(join(tmpdir(), 'rigorrun-elsewhere-'));
    roots.push(elsewhere);
    expect(await cmdImportProject(out, flags(elsewhere))).toBe(0);

    const [imported] = await new ProjectStore(elsewhere).list();
    expect(imported).toBeDefined();
    // A new id, so importing twice gives two projects rather than one silently
    // overwriting the other.
    expect(imported!.id).not.toBe('p_1');
    expect(imported!.connector?.kind).toBe('mcp');
    if (imported!.connector?.kind !== 'mcp') throw new Error('expected an MCP connector');
    expect(imported!.connector.command).toBe('/usr/local/bin/desk-mcp');
    // Runs belong to the machine that produced them.
    expect(imported!.runs).toEqual([]);
    expect(imported!.connectorTrust).toEqual({ origin: 'imported', confirmedAt: null });
  });

  it('will not open the connector until somebody has read the command', async () => {
    const { home } = await workspace();
    const out = join(home, 'bundle.json');
    await cmdExportProject('p_1', flags(home, { out }));
    const elsewhere = await mkdtemp(join(tmpdir(), 'rigorrun-elsewhere-'));
    roots.push(elsewhere);
    await cmdImportProject(out, flags(elsewhere));

    const store = new ProjectStore(elsewhere);
    const [imported] = await store.list();

    // The refusal names the command, because reading it is the whole point.
    expect(() => assertConnectorTrusted(imported!)).toThrow(/desk-mcp/);
    expect(() => assertConnectorTrusted(imported!)).toThrow(/imported/);

    // Without --yes it shows the command and exits 2: a question, not a failure.
    expect(await cmdTrust(imported!.id, flags(elsewhere))).toBe(2);
    expect(() => assertConnectorTrusted(imported!)).toThrow();

    expect(await cmdTrust(imported!.id, flags(elsewhere, { yes: true }))).toBe(0);
    const trusted = await store.read(imported!.id);
    expect(() => assertConnectorTrusted(trusted)).not.toThrow();
  });
});

describe('backing the whole workspace up', () => {
  it('copies the projects and leaves the credentials behind', async () => {
    const { home } = await workspace();
    const out = join(home, 'backup');
    expect(await cmdBackup(flags(home, { out }))).toBe(0);

    const copied = await readFile(join(out, 'projects', 'p_1', 'project.json'), 'utf8');
    expect(copied).toContain('Desk agent');
    await expect(readFile(join(out, 'secrets.json'), 'utf8')).rejects.toThrow();
  });

  it('refuses to overwrite an existing project without being told to', async () => {
    const { home } = await workspace();
    const out = join(home, 'backup');
    await cmdBackup(flags(home, { out }));

    await expect(cmdRestore(out, flags(home))).rejects.toThrow(/already exist/);
    expect(await cmdRestore(out, flags(home, { force: true }))).toBe(0);
  });
});
