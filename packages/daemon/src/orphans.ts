/**
 * Servers a crashed runner left behind.
 *
 * `serve.ts` closes its children on SIGINT and SIGTERM, and the comment there
 * says why it matters: an orphaned stdio server keeps running with the
 * credentials it was handed. SIGKILL skips all of that, and so does a kernel
 * OOM kill, and so does pulling the power out — and a stdio MCP server does not
 * die when its parent does. Measured, not assumed: four child processes before
 * `kill -9`, four afterwards.
 *
 * So the runner writes down what it spawned, and the next runner cleans up.
 *
 * The obvious hazard is killing the wrong thing. A pid is reused, sometimes
 * within minutes on a busy machine, and a note saying "pid 4821 was mine" is
 * worthless on its own. So the command line is written down beside it and
 * checked before anything is signalled: a pid that has been recycled is running
 * something else, its arguments will not match, and it is left alone. On a
 * platform where the check cannot be made, nothing is killed at all — a
 * lingering server is a smaller problem than a wrong `kill`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic.ts';
import { runCommand } from './exec.ts';

const FILE = 'runner.json';

interface SpawnedChild {
  pid: number;
  /** Enough of the command line to recognise it again. */
  fingerprint: string;
  at: string;
}

interface RunnerNote {
  /** The runner that wrote this. If it is gone, its children are orphans. */
  pid: number;
  startedAt: string;
  children: SpawnedChild[];
}

async function read(root: string): Promise<RunnerNote | undefined> {
  try {
    return JSON.parse(await readFile(join(root, FILE), 'utf8')) as RunnerNote;
  } catch {
    return undefined;
  }
}

/** Starts a fresh note. Called once, as the runner comes up. */
export async function claimRunner(root: string): Promise<void> {
  await writeJsonAtomic(
    join(root, FILE),
    { pid: process.pid, startedAt: new Date().toISOString(), children: [] } satisfies RunnerNote,
    0o600,
  );
}

/** Records a child, so a later runner can find it if this one dies badly. */
export async function noteChild(root: string, pid: number, fingerprint: string): Promise<void> {
  const note = (await read(root)) ?? {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    children: [],
  };
  if (note.children.some((child) => child.pid === pid)) return;
  note.children.push({ pid, fingerprint, at: new Date().toISOString() });
  await writeJsonAtomic(join(root, FILE), note, 0o600);
}

/** Forgets a child that was closed properly. */
export async function forgetChild(root: string, pid: number): Promise<void> {
  const note = await read(root);
  if (!note) return;
  note.children = note.children.filter((child) => child.pid !== pid);
  await writeJsonAtomic(join(root, FILE), note, 0o600);
}

function alive(pid: number): boolean {
  try {
    // Signal 0 asks the kernel whether it could signal, without signalling.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // The two failures mean opposite things and treating them alike is a bug:
    // ESRCH is "no such process", EPERM is "it is there and not yours". A
    // process owned by somebody else must count as alive, or a previous
    // runner started under another account looks dead and its children get
    // reaped out from under it.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What that pid is actually running now, or undefined if it cannot be told. */
async function commandLine(pid: number): Promise<string | undefined> {
  // /proc first: no process to spawn, and exact.
  const proc = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => undefined);
  if (proc !== undefined) return proc.replace(/\0/g, ' ').trim();

  const result = await runCommand({
    command: 'ps',
    args: ['-o', 'args=', '-p', String(pid)],
    timeoutMs: 5_000,
    provenance: 'rigorrun-internal',
  }).catch(() => undefined);
  return result?.code === 0 ? result.stdout.trim() : undefined;
}

export interface Reaped {
  pid: number;
  fingerprint: string;
}

/**
 * Ends servers a previous runner left running, and returns what it ended.
 *
 * Called at startup, before anything else opens a connection. Does nothing if
 * the previous runner is still alive — two runners on one workspace is a
 * different problem, and killing the live one's children would be the worst
 * possible response to it.
 */
export async function reapOrphans(root: string): Promise<Reaped[]> {
  const note = await read(root);
  if (!note || note.children.length === 0) return [];
  if (note.pid !== process.pid && alive(note.pid)) return [];

  const reaped: Reaped[] = [];
  for (const child of note.children) {
    if (!alive(child.pid)) continue;
    const running = await commandLine(child.pid);
    // Cannot tell what it is: leave it. A lingering server is a smaller
    // problem than signalling something that merely inherited the number.
    if (running === undefined || !running.includes(child.fingerprint)) continue;
    try {
      process.kill(child.pid, 'SIGTERM');
      reaped.push({ pid: child.pid, fingerprint: child.fingerprint });
    } catch {
      // It exited between the check and the signal. Nothing to do.
    }
  }
  return reaped;
}
