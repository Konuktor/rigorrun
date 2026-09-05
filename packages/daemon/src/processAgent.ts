/**
 * An agent that is a command on this machine.
 *
 * `AgentKind` has declared `'process'` since long before anything implemented
 * it, and the reason it stayed empty is worth stating: the product had a test
 * asserting that nothing in the benchmark execution path could start a process,
 * and that test is what makes "a crafted benchmark cannot run a command" a fact
 * rather than an intention. Adding a process agent to `@rigorrun/agents` would
 * have deleted it.
 *
 * So this lives here, beside the HTTP agent and for the same reason that one
 * does: `@rigorrun/agents` is in the browser bundle and in the execution path,
 * and this package is in neither. The invariant is untouched — the assertion in
 * `packages/cli/test/security.test.ts` still says exactly one file in the whole
 * codebase starts a process, and it names `exec.ts`.
 *
 * The protocol is the HTTP one, moved onto stdio. RigorRun writes one line of
 * JSON carrying the task and an MCP endpoint scoped to that case; the agent
 * connects to it, works however it normally works, and writes one line back.
 * `CompletionSchema` and `ProbeSchema` are reused rather than reimplemented, so
 * an agent that already speaks the HTTP protocol is a `readline` away from
 * speaking this one — and the evidence RigorRun gathers is byte-identical,
 * because everything the agent did went through the same proxy.
 *
 * **One process per case.** A case is the isolation unit everywhere else in
 * this product; a long-lived agent process lets case seven inherit case six's
 * memory, which is precisely what `isolation: RESET` claims did not happen.
 */
import { createProxySession, type ProxyServer } from '@rigorrun/proxy';
import type {
  AgentAdapter,
  AgentEnvironment,
  AgentRunInput,
  AgentRunOutput,
} from '@rigorrun/agents';
import { AGENT_PROTOCOL_V2, CompletionSchema, ProbeSchema } from './httpAgent.ts';
import { assertRunnable, startCommand, type Command } from './exec.ts';

export interface ProcessAgentConfig {
  id: string;
  name: string;
  /** The executable. Operator-typed, never from a file RigorRun read. */
  command: string;
  args: readonly string[];
  cwd?: string;
  /** How long one case may take. An agent with its own loop needs room. */
  timeoutMs?: number;
  proxy: ProxyServer;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_LINE_BYTES = 256 * 1024;
/** Kept for the failure message. Customer data, so only shown on a failure. */
const STDERR_KEEP = 8 * 1024;

interface Spoken {
  line?: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/**
 * Runs the command once, writes one line, and waits for one line back.
 *
 * Everything here is bounded, because the thing on the other end is somebody
 * else's program: the line it may send, the time it may take, the stderr kept.
 * A test harness that can be made to hang or to eat memory by the program it is
 * testing is a test harness nobody can leave running.
 */
async function speak(command: Command, request: string): Promise<Spoken> {
  const child = startCommand(command);
  const stderr: Buffer[] = [];
  let stderrBytes = 0;
  let buffered = '';
  let line: string | undefined;
  let timedOut = false;

  // Resolved by whichever happens first: the agent answers, or the process
  // ends without answering. Waiting for the exit either way cost the full
  // timeout on every probe — ten seconds to find out an agent is there, on a
  // screen where somebody is waiting to see whether they typed the path right.
  let settle: (value: number | null) => void = () => undefined;
  const finished = new Promise<number | null>((resolve, reject) => {
    settle = resolve;
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    if (line !== undefined) return;
    buffered += chunk;
    if (buffered.length > MAX_LINE_BYTES) {
      line = '';
      child.kill('SIGKILL');
      return;
    }
    const end = buffered.indexOf('\n');
    if (end >= 0) {
      line = buffered.slice(0, end);
      // The answer is in. Whatever the agent does with the rest of its life is
      // not this case's business, and the `finally` below ends it.
      settle(null);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderrBytes >= STDERR_KEEP) return;
    stderr.push(chunk);
    stderrBytes += chunk.length;
  });

  child.stdin?.write(`${request}\n`);
  // Left open rather than ended: an agent may want to send progress, and some
  // runtimes treat a closed stdin as a reason to exit.

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
  }, command.timeoutMs);

  try {
    const code = await finished;
    return {
      ...(line !== undefined ? { line } : {}),
      stderr: Buffer.concat(stderr).toString('utf8'),
      code,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
    // Whatever happened, nothing of this agent's is left running.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

function commandFor(config: ProcessAgentConfig, timeoutMs: number): Command {
  return {
    command: config.command,
    args: config.args,
    ...(config.cwd ? { cwd: config.cwd } : {}),
    timeoutMs,
    // A literal, at the one call site. No schema anywhere can produce this
    // value, which is what makes a command unable to arrive from a file.
    provenance: 'operator-configured',
  };
}

/**
 * Checks the command is there and speaks the protocol, without doing any work.
 *
 * The same rule the HTTP agent has: an agent is not connected because somebody
 * typed a path. A configuration that says CONNECTED on the strength of a
 * well-formed string turns into a failed run half an hour later, blamed on the
 * agent.
 */
export async function probeProcessAgent(
  config: Pick<ProcessAgentConfig, 'command' | 'args' | 'cwd'>,
): Promise<{ ok: true; name: string; version: string } | { ok: false; problem: string }> {
  const command = commandFor({ ...config, id: '', name: '', proxy: null as never }, 10_000);
  try {
    assertRunnable(command);
  } catch (error) {
    return { ok: false, problem: (error as Error).message };
  }

  let spoken: Spoken;
  try {
    spoken = await speak(command, JSON.stringify({ protocol: AGENT_PROTOCOL_V2, probe: true }));
  } catch (error) {
    return {
      ok: false,
      problem: `Could not start it: ${(error as Error).message}. Check the path and that it is executable.`,
    };
  }

  if (spoken.line === undefined) {
    return {
      ok: false,
      problem: spoken.timedOut
        ? 'It started but did not answer the probe within ten seconds.'
        : `It exited with code ${String(spoken.code)} without answering. ${spoken.stderr.slice(0, 300)}`.trim(),
    };
  }
  let parsed;
  try {
    parsed = ProbeSchema.safeParse(JSON.parse(spoken.line));
  } catch {
    return { ok: false, problem: 'It answered, but not with JSON on one line.' };
  }
  if (!parsed.success) {
    return {
      ok: false,
      problem: 'It answered, but not with {"ok":true}. Check it handles a probe request.',
    };
  }
  return {
    ok: true,
    name: parsed.data.agent?.name ?? '',
    version: parsed.data.agent?.version ?? '',
  };
}

export function createProcessAgent(config: ProcessAgentConfig): AgentAdapter {
  assertRunnable(commandFor(config, config.timeoutMs ?? DEFAULT_TIMEOUT_MS));

  return {
    id: config.id,
    name: config.name,
    kind: 'process',
    description: `Your agent, run as \`${config.command}\`, driving itself through the RigorRun proxy.`,

    async execute(input: AgentRunInput, env: AgentEnvironment): Promise<AgentRunOutput> {
      const { server, calls } = createProxySession({
        tools: input.task.tools,
        environment: env,
      });
      const { sessionId, url: mcpUrl } = await config.proxy.publish(server);
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      try {
        const spoken = await speak(
          commandFor(config, timeoutMs),
          JSON.stringify({
            protocol: AGENT_PROTOCOL_V2,
            caseId: input.caseId,
            task: {
              instruction: input.task.instruction,
              inputs: input.task.inputs,
              policyBrief: input.task.policyBrief,
            },
            environment: {
              mcpUrl,
              expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
            },
            maxSteps: input.maxSteps,
          }),
        );

        if (spoken.line === undefined) {
          // Its own words, but only when something went wrong — stderr is the
          // customer's data and ends up in a run artefact.
          const said = spoken.stderr.trim().slice(-400);
          return report(
            spoken.timedOut
              ? 'The agent did not finish in time.'
              : `The agent exited with code ${String(spoken.code)} before answering.`,
            calls.length,
            said,
          );
        }

        let parsed;
        try {
          parsed = CompletionSchema.safeParse(JSON.parse(spoken.line));
        } catch {
          return report('The agent wrote something that is not JSON.', calls.length, '');
        }
        if (!parsed.success) {
          return report(
            `The agent answered in a shape RigorRun does not understand: ${parsed.error.message}`,
            calls.length,
            '',
          );
        }

        return {
          report: parsed.data.output || `The agent reported ${parsed.data.status}.`,
          usage: parsed.data.usage ?? null,
          costUsd: parsed.data.costUsd ?? null,
          costNote:
            parsed.data.costUsd === undefined ? 'cost unavailable' : 'reported by the agent',
        };
      } catch (error) {
        return report(`The agent could not be run: ${(error as Error).message}`, calls.length, '');
      } finally {
        // Revoked before anything else, so a process that outlived its kill
        // has nothing left to talk to.
        await config.proxy.revoke(sessionId);
      }
    },
  };
}

function report(problem: string, callCount: number, said: string): AgentRunOutput {
  return {
    report:
      `${problem} ${callCount} tool call(s) were made before that.` +
      (said ? `\n\nIt wrote: ${said}` : ''),
    usage: null,
    costUsd: null,
    costNote: 'cost unavailable',
  };
}
