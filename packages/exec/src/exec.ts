/**
 * The one place in RigorRun that starts a process.
 *
 * There is a test in `packages/cli/test/security.test.ts` asserting that the
 * benchmark execution path — core, environment, compiler, generator, verifier,
 * scoring, runner, report, agents — imports no process-spawning API at all.
 * That test is what makes "a crafted benchmark cannot run a command" a fact
 * rather than an intention, and it is deliberately kept.
 *
 * This file sits outside that path, in the daemon, alongside the other code
 * that acts on what the operator typed. Everything it runs has to say where the
 * command came from:
 *
 *   'rigorrun-internal'    a constant in RigorRun's own source — the OS keychain
 *                          helper, and nothing else. Never assembled from input.
 *   'operator-configured'  a person typed it into the interface or the CLI on
 *                          this machine, and confirmed it.
 *
 * `provenance` is a literal at every call site and is declared by no schema
 * anywhere, so no JSON — a benchmark, an imported project, an MCP tool result,
 * a trace — can produce a value of this type. That is the property the whole
 * design rests on, and it is one grep to check.
 *
 * `shell` is never true. Arguments are always an array. A command that arrives
 * as one string with a pipe in it is not supported and never will be.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export type CommandProvenance = 'rigorrun-internal' | 'operator-configured';

export interface Command {
  /** An executable path or a bare name. Never a shell string. */
  command: string;
  args: readonly string[];
  cwd?: string;
  /** Extra environment. Merged over a minimal base, never over all of ours. */
  env?: Readonly<Record<string, string>>;
  timeoutMs: number;
  provenance: CommandProvenance;
}

export interface ExecResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Output beyond this is dropped rather than buffered without limit. */
const MAX_OUTPUT_BYTES = 1024 * 1024;
/** How long a process gets to die politely before it is killed. */
const GRACE_MS = 5_000;

/** Refuses the shapes that only ever appear when somebody is being clever. */
export function assertRunnable(command: Command): void {
  if (command.command.trim().length === 0) throw new Error('No command to run.');
  if (/[;&|`$<>\n\r]/.test(command.command)) {
    throw new Error(
      `"${command.command}" contains shell punctuation. RigorRun runs a program directly ` +
        'rather than through a shell, so give the program and its arguments separately.',
    );
  }
}

export function startCommand(command: Command): ChildProcess {
  assertRunnable(command);
  return spawn(command.command, [...command.args], {
    ...(command.cwd ? { cwd: command.cwd } : {}),
    env: { ...baseEnvironment(), ...command.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    detached: false,
  });
}

/** Runs to completion, or kills it. A timeout is a result, not a crash. */
export async function runCommand(command: Command, stdin?: string): Promise<ExecResult> {
  const child = startCommand(command);
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let outBytes = 0;
  let errBytes = 0;
  let timedOut = false;

  child.stdout?.on('data', (chunk: Buffer) => {
    if (outBytes < MAX_OUTPUT_BYTES) {
      out.push(chunk);
      outBytes += chunk.length;
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    if (errBytes < MAX_OUTPUT_BYTES) {
      err.push(chunk);
      errBytes += chunk.length;
    }
  });

  if (stdin !== undefined) {
    child.stdin?.end(stdin);
  } else {
    child.stdin?.end();
  }

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    // Politeness has a deadline. A process that ignores SIGTERM would
    // otherwise hold a case open until the whole run is abandoned.
    setTimeout(() => child.kill('SIGKILL'), GRACE_MS).unref();
  }, command.timeoutMs);

  try {
    return await new Promise<ExecResult>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => {
        resolve({
          code,
          signal,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
          timedOut,
        });
      });
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The environment a child starts with.
 *
 * Not `process.env`. A child inherits whatever CI put in the environment
 * otherwise, and that routinely includes tokens for entirely unrelated
 * services. Named secrets are passed deliberately by the caller.
 */
function baseEnvironment(): Record<string, string> {
  const keep = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP', 'LANG'];
  const base: Record<string, string> = {};
  for (const name of keep) {
    const value = process.env[name];
    if (value !== undefined) base[name] = value;
  }
  return base;
}
