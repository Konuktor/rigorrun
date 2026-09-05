/**
 * The migration mechanism, exercised before anybody's data depends on it.
 *
 * `MIGRATIONS` has been an empty array since the format was introduced, which
 * means the code that walks it, backs up before it and refuses to half-apply it
 * has never actually run. A mechanism nobody has run is a mechanism nobody
 * knows works, and the first time it matters is the worst time to find out.
 *
 * So these tests inject migrations of their own rather than waiting for a real
 * one. What is under test is the machinery — the copy, the ordering, and above
 * all what happens when a migration throws.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MIGRATIONS,
  MigrationFailedError,
  WORKSPACE_VERSION,
  openWorkspace,
  readWorkspaceMeta,
  type Migration,
} from '../src/workspaceVersion.ts';

const roots: string[] = [];

/** A workspace at an older format, with one project in it worth losing. */
async function oldWorkspace(version: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rigorrun-migrate-'));
  roots.push(root);
  await mkdir(join(root, 'projects', 'p_1'), { recursive: true });
  await writeFile(
    join(root, 'projects', 'p_1', 'project.json'),
    JSON.stringify({ id: 'p_1', name: 'Twenty minutes of somebody’s work' }),
  );
  await writeFile(
    join(root, 'workspace.json'),
    JSON.stringify({ version, createdAt: '2026-01-01T00:00:00.000Z', lastWrittenBy: 'old' }),
  );
  return root;
}

/** Whatever ships, captured before any test appends to it. */
const shipped: Migration[] = [...MIGRATIONS];
afterEach(async () => {
  MIGRATIONS.length = 0;
  MIGRATIONS.push(...shipped);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('migrating a workspace somebody has been using', () => {
  it('takes a copy first, and does not put credentials in it', async () => {
    const root = await oldWorkspace(WORKSPACE_VERSION);
    await writeFile(join(root, 'secrets.json'), JSON.stringify({ API_KEY: 'sk-do-not-copy-me' }));
    MIGRATIONS.push({ to: WORKSPACE_VERSION + 1, what: 'a change', run: async () => undefined });

    await openWorkspace(root, '0.0.0-test');

    const backups = await readdir(join(root, 'backups'));
    expect(backups).toHaveLength(1);
    const copied = await readFile(
      join(root, 'backups', backups[0]!, 'projects', 'p_1', 'project.json'),
      'utf8',
    );
    expect(copied).toContain('somebody');

    // A backup gets copied to a laptop and forgotten in a home directory.
    expect(await readdir(join(root, 'backups', backups[0]!))).not.toContain('secrets.json');
  });

  it('records where the copy went, so the message can name it', async () => {
    const root = await oldWorkspace(WORKSPACE_VERSION);
    MIGRATIONS.push({ to: WORKSPACE_VERSION + 1, what: 'a change', run: async () => undefined });

    const opened = await openWorkspace(root, '0.0.0-test');
    expect(opened.applied).toEqual(['a change']);
    expect(opened.meta.lastBackup?.fromVersion).toBe(WORKSPACE_VERSION);
  });

  it('leaves the workspace at its old version when a migration throws', async () => {
    const root = await oldWorkspace(WORKSPACE_VERSION);
    MIGRATIONS.push({
      to: WORKSPACE_VERSION + 1,
      what: 'a change that goes wrong',
      run: async () => {
        throw new Error('disk full');
      },
    });

    await expect(openWorkspace(root, '0.0.0-test')).rejects.toThrow(MigrationFailedError);

    // The asymmetry that makes this recoverable: an older RigorRun can still
    // read this workspace, because nothing claimed the new format was reached.
    const meta = await readWorkspaceMeta(root);
    expect(meta?.version).toBe(WORKSPACE_VERSION);
    expect(await readFile(join(root, 'projects', 'p_1', 'project.json'), 'utf8')).toContain(
      'somebody',
    );
  });

  it('names the backup in the failure, because that is the way back', async () => {
    const root = await oldWorkspace(WORKSPACE_VERSION);
    MIGRATIONS.push({
      to: WORKSPACE_VERSION + 1,
      what: 'a change that goes wrong',
      run: async () => {
        throw new Error('disk full');
      },
    });

    const error = await openWorkspace(root, '0.0.0-test').catch((e: unknown) => e);
    expect((error as MigrationFailedError).message).toContain('backups');
    expect((error as MigrationFailedError).message).toContain('disk full');
  });

  it('applies migrations in order, lowest first', async () => {
    const root = await oldWorkspace(WORKSPACE_VERSION);
    const order: number[] = [];
    MIGRATIONS.push(
      {
        to: WORKSPACE_VERSION + 2,
        what: 'second',
        run: async () => void order.push(WORKSPACE_VERSION + 2),
      },
      {
        to: WORKSPACE_VERSION + 1,
        what: 'first',
        run: async () => void order.push(WORKSPACE_VERSION + 1),
      },
    );

    const opened = await openWorkspace(root, '0.0.0-test');
    expect(order).toEqual([WORKSPACE_VERSION + 1, WORKSPACE_VERSION + 2]);
    expect(opened.applied).toEqual(['first', 'second']);
  });
});
