/**
 * Starting the runner the way a person does, for the suites that need one.
 *
 * Extracted when a second suite needed it. The important detail is that these
 * start the *real* executable — `RIGORRUN_BIN` when a packaged tarball is under
 * test, the sources through `tsx` otherwise — because a test that imported the
 * server and called it directly would not be testing the thing a person runs.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const tsx = join(repoRoot, 'node_modules', '.bin', 'tsx');

/** An installed executable when there is one, the sources when there is not. */
export const PACKAGED = process.env['RIGORRUN_BIN'];

export const PAIRED_URL =
  /http:\/\/127\.0\.0\.1:\d+\/\?code=[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/;

export interface Started {
  child: ChildProcess;
  match: string;
}

/** Starts a process and waits for the line that says it is ready. */
export function startAndWait(
  command: string,
  args: string[],
  env: Record<string, string>,
  ready: RegExp,
  timeoutMs = 60_000,
): Promise<Started> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...env } });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`nothing matched ${String(ready)} in time: ${buffer.slice(-800)}`));
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString();
      const found = ready.exec(buffer);
      if (!found) return;
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      resolve({ child, match: found[0] });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`process exited with ${code}: ${buffer.slice(-800)}`));
    });
  });
}

/** Starts the runner against a given workspace, and returns its pairing URL. */
export function startRunner(home: string): Promise<Started> {
  return startAndWait(
    PACKAGED ?? tsx,
    [...(PACKAGED ? [] : [join(repoRoot, 'packages', 'cli', 'src', 'bin.ts')]), '--no-open'],
    { RIGORRUN_HOME: home, NO_COLOR: '1' },
    PAIRED_URL,
  );
}

/**
 * Asks a running runner for a fresh pairing link.
 *
 * A pairing code is single-use on purpose, so a second browser context cannot
 * reuse the first one's. The runner reissues on a newline at its terminal —
 * being there is the same authority that read the first code off the screen —
 * and its stdin is a pipe here, so a test can ask the same way a person does.
 */
export function reissuePairing(runner: ChildProcess, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      runner.stdout?.off('data', onData);
      reject(new Error(`no new pairing URL in time: ${buffer.slice(-400)}`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString();
      const found = PAIRED_URL.exec(buffer);
      if (!found) return;
      clearTimeout(timer);
      runner.stdout?.off('data', onData);
      resolve(found[0]);
    };
    runner.stdout?.on('data', onData);
    runner.stdin?.write('\n');
  });
}
