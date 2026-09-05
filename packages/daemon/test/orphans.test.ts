/**
 * Servers left running by a runner that was killed rather than stopped.
 *
 * `serve.ts` closes its children on SIGINT and SIGTERM, and says why: an
 * orphaned stdio server keeps running with the credentials it was handed.
 * SIGKILL skips that, and so does an OOM kill, and a stdio MCP server does not
 * die when its parent does — measured against the venue-desk fixture, four
 * children before `kill -9` and four afterwards.
 *
 * The risk in cleaning up is killing something else. Pids are reused, so the
 * arguments are written down beside the number and checked before anything is
 * signalled. These tests are mostly about that check being real.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../src/atomic.ts';
import { claimRunner, forgetChild, noteChild, reapOrphans } from '../src/orphans.ts';

const roots: string[] = [];
const spawned: ChildProcess[] = [];

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rigorrun-orphans-'));
  roots.push(dir);
  return dir;
}

/** A long-lived process standing in for somebody's MCP server. */
function longRunning(marker: string): ChildProcess {
  const child = spawn(process.execPath, ['-e', `setInterval(() => {}, 1e9); // ${marker}`]);
  spawned.push(child);
  return child;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  for (const child of spawned.splice(0)) child.kill('SIGKILL');
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('cleaning up after a runner that was killed', () => {
  it('ends a server whose runner is gone', async () => {
    const dir = await root();
    const child = longRunning('rigorrun-orphan-test-a');
    await claimRunner(dir);
    await noteChild(dir, child.pid!, 'rigorrun-orphan-test-a');

    // Rewrite the note so it belongs to a runner that no longer exists. Pid 1
    // is init and always alive, so a number that cannot be running is needed:
    // 0x7FFFFFFF is above any Linux pid_max.
    const note = JSON.parse(await readFile(join(dir, 'runner.json'), 'utf8')) as {
      pid: number;
      children: unknown[];
    };
    await writeJsonAtomic(join(dir, 'runner.json'), { ...note, pid: 0x7fffffff });

    const reaped = await reapOrphans(dir);
    expect(reaped.map((entry) => entry.pid)).toEqual([child.pid]);
    await new Promise((resolve) => child.once('exit', resolve));
    expect(alive(child.pid!)).toBe(false);
  }, 30_000);

  it('leaves everything alone while the runner that spawned it is still up', async () => {
    const dir = await root();
    const child = longRunning('rigorrun-orphan-test-b');
    // Claimed by *this* process, which is obviously alive. Two runners sharing
    // a workspace is a different problem, and killing the live one's children
    // would be the worst possible answer to it.
    await writeJsonAtomic(join(dir, 'runner.json'), {
      pid: process.pid === 1 ? 2 : 1,
      startedAt: new Date().toISOString(),
      children: [{ pid: child.pid, fingerprint: 'rigorrun-orphan-test-b', at: '' }],
    });

    expect(await reapOrphans(dir)).toEqual([]);
    expect(alive(child.pid!)).toBe(true);
  }, 30_000);

  it('will not signal a pid that is now running something else', async () => {
    const dir = await root();
    const innocent = longRunning('something-entirely-different');
    await writeJsonAtomic(join(dir, 'runner.json'), {
      pid: 0x7fffffff,
      startedAt: new Date().toISOString(),
      children: [
        // The number matches; what is running under it does not. This is the
        // recycled-pid case, and getting it wrong means killing a stranger's
        // process.
        { pid: innocent.pid, fingerprint: 'a-server-that-used-to-be-here', at: '' },
      ],
    });

    expect(await reapOrphans(dir)).toEqual([]);
    expect(alive(innocent.pid!)).toBe(true);
  }, 30_000);

  it('forgets a child that was closed properly', async () => {
    const dir = await root();
    await claimRunner(dir);
    await noteChild(dir, 424242, 'a-server');
    await forgetChild(dir, 424242);

    const note = JSON.parse(await readFile(join(dir, 'runner.json'), 'utf8')) as {
      children: unknown[];
    };
    // Otherwise every startup checks pids that were recycled months ago.
    expect(note.children).toEqual([]);
  });
});
