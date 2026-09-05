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
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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
}

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

  const applied: string[] = [];
  let current = existing.version;
  for (const migration of MIGRATIONS.filter((entry) => entry.to > current).sort(
    (a, b) => a.to - b.to,
  )) {
    await migration.run(root);
    current = migration.to;
    applied.push(migration.what);
  }

  const meta: WorkspaceMeta = {
    version: WORKSPACE_VERSION,
    createdAt: existing.createdAt,
    lastWrittenBy: version,
  };
  await write(root, meta);
  return { meta, created: false, applied };
}

async function write(root: string, meta: WorkspaceMeta): Promise<void> {
  await writeFile(join(root, META_FILE), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
}
