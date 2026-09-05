/**
 * The on-disk format, and what happens when it changes.
 *
 * `~/.rigorrun` is somebody's work. Once a stranger has spent twenty minutes
 * connecting a system and teaching it a job, the cost of us changing a field
 * name is that they do it again — and they will not, they will close the tab.
 * So the format carries a version from the first release rather than from the
 * first time we regret not having one.
 *
 * Two directions, and they are not symmetric. An older workspace is migrated
 * forward, in order, with each step small enough to reason about. A *newer*
 * workspace is refused: it was written by a RigorRun that knew things this one
 * does not, and the failure mode of guessing is silent data loss rather than an
 * error. Somebody who downgraded should be told to upgrade back, not have their
 * projects quietly rewritten by an older reader.
 */
import { cp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sweepTemporaries, writeJsonAtomic } from './atomic.ts';

/**
 * Bump this when the shape of anything under `~/.rigorrun` changes, and add a
 * migration. A version bump with no migration is a bug the test below catches.
 */
export const WORKSPACE_VERSION = 1;

export interface WorkspaceMeta {
  version: number;
  /** When this workspace was first created. The start of everything. */
  createdAt: string;
  /** Which RigorRun last wrote here. Only ever for diagnostics. */
  lastWrittenBy: string;
  /** Where the copy taken before the last migration went, if there was one. */
  lastBackup?: { path: string; fromVersion: number; at: string };
}

/** Copies kept before a migration. Enough to go back; not enough to hoard. */
const KEEP_BACKUPS = 3;

/** One step forward. Deliberately narrow: from exactly N to exactly N+1. */
export interface Migration {
  to: number;
  what: string;
  run(root: string): Promise<void>;
}

/**
 * Empty on purpose, and not an oversight.
 *
 * Version 1 is the first format anybody has. The list exists now so the first
 * change is a matter of appending rather than of retrofitting a mechanism
 * under a format people already have on disk.
 */
export const MIGRATIONS: Migration[] = [];

export class WorkspaceTooNewError extends Error {
  constructor(readonly found: number) {
    super(
      `This workspace was written by a newer RigorRun (format ${found}; this one reads ${WORKSPACE_VERSION}). ` +
        'Upgrade RigorRun rather than letting an older version rewrite your projects: `npm i -g rigorrun@latest`.',
    );
    this.name = 'WorkspaceTooNewError';
  }
}

const META_FILE = 'workspace.json';

export async function readWorkspaceMeta(root: string): Promise<WorkspaceMeta | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(root, META_FILE), 'utf8')) as Partial<WorkspaceMeta>;
    if (typeof raw.version !== 'number') return undefined;
    return {
      version: raw.version,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
      lastWrittenBy: typeof raw.lastWrittenBy === 'string' ? raw.lastWrittenBy : 'unknown',
    };
  } catch {
    return undefined;
  }
}

export interface OpenResult {
  meta: WorkspaceMeta;
  /** True when this call created the workspace. The first observable moment. */
  created: boolean;
  /** Migrations that ran, in order. Empty is the ordinary case. */
  applied: string[];
}

/**
 * Opens a workspace, creating or migrating it as needed.
 *
 * Called before anything reads a project, so nothing downstream ever has to
 * wonder which format it is looking at.
 */
export async function openWorkspace(root: string, version: string): Promise<OpenResult> {
  await mkdir(root, { recursive: true });
  const existing = await readWorkspaceMeta(root);
  const now = new Date().toISOString();

  // A crash mid-write leaves a temporary beside the file it was replacing.
  // Harmless, invisible, and the only evidence that a write was interrupted —
  // so it is cleared here, when nothing else is writing, rather than left to
  // accumulate for a year and become a support conversation.
  await sweepTemporaries(root);
  for (const id of await projectIds(root)) {
    await sweepTemporaries(join(root, 'projects', id));
  }

  if (!existing) {
    // A directory with projects in it but no marker predates versioning, and
    // is by definition version 1 — there has never been another.
    const meta: WorkspaceMeta = {
      version: WORKSPACE_VERSION,
      createdAt: now,
      lastWrittenBy: version,
    };
    await write(root, meta);
    return { meta, created: true, applied: [] };
  }

  if (existing.version > WORKSPACE_VERSION) throw new WorkspaceTooNewError(existing.version);

  const pending = MIGRATIONS.filter((entry) => entry.to > existing.version).sort(
    (a, b) => a.to - b.to,
  );

  // A copy before anything is rewritten. A migration is the one moment RigorRun
  // touches every project somebody owns at once, and the cost of getting it
  // wrong without a copy is all of their work rather than one step of it.
  let backup: WorkspaceMeta['lastBackup'] = existing.lastBackup;
  if (pending.length > 0) {
    const path = join(root, 'backups', `v${existing.version}-${now.replace(/[:.]/g, '-')}`);
    await backupWorkspace(root, path);
    backup = { path, fromVersion: existing.version, at: now };
    await pruneBackups(root);
  }

  const applied: string[] = [];
  for (const migration of pending) {
    try {
      await migration.run(root);
    } catch (error) {
      // The meta is deliberately *not* rewritten. The workspace stays at its
      // old version, so an older RigorRun can still read it, and the next
      // attempt starts from the same place rather than from halfway.
      throw new MigrationFailedError(migration, backup?.path, error);
    }
    applied.push(migration.what);
  }

  const meta: WorkspaceMeta = {
    version: WORKSPACE_VERSION,
    createdAt: existing.createdAt,
    lastWrittenBy: version,
    ...(backup ? { lastBackup: backup } : {}),
  };
  await write(root, meta);
  return { meta, created: false, applied };
}

export class MigrationFailedError extends Error {
  constructor(
    readonly migration: Migration,
    readonly backup: string | undefined,
    override readonly cause: unknown,
  ) {
    super(
      `Migrating this workspace to format ${migration.to} failed: ` +
        `${(cause as Error).message}\n` +
        `Nothing was left half-migrated — the workspace is still at its previous ` +
        `format and an older RigorRun can still read it.` +
        (backup ? `\nA copy taken before the attempt is at ${backup}.` : ''),
    );
    this.name = 'MigrationFailedError';
  }
}

/**
 * Copies the parts of a workspace that are somebody's work.
 *
 * `secrets.json` is deliberately not among them. A backup is a file that gets
 * copied to a laptop, attached to a support thread and forgotten in a home
 * directory; credentials belong in exactly one place and this is not it.
 */
export async function backupWorkspace(root: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await cp(join(root, 'projects'), join(destination, 'projects'), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  await cp(join(root, META_FILE), join(destination, META_FILE), { force: true }).catch(
    () => undefined,
  );
}

async function pruneBackups(root: string): Promise<void> {
  const dir = join(root, 'backups');
  const entries = (await readdir(dir).catch(() => [])).sort();
  for (const stale of entries.slice(0, Math.max(0, entries.length - KEEP_BACKUPS))) {
    await rm(join(dir, stale), { recursive: true, force: true });
  }
}

async function projectIds(root: string): Promise<string[]> {
  return (await readdir(join(root, 'projects')).catch(() => [])).filter((id) =>
    /^[A-Za-z0-9_-]{1,64}$/.test(id),
  );
}

async function write(root: string, meta: WorkspaceMeta): Promise<void> {
  await writeJsonAtomic(join(root, META_FILE), meta, 0o600);
}
