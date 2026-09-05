#!/usr/bin/env node
/**
 * An agent RigorRun runs as a command.
 *
 * The whole integration, and it is deliberately unglamorous: read one line of
 * JSON from stdin, do the work through the MCP endpoint that line carries,
 * write one line of JSON back. No SDK, no framework, no RigorRun import —
 * `readline` and an MCP client this agent already had.
 *
 * That is the point of the protocol being this shape. An agent that already
 * exists has its own loop, and asking somebody to turn theirs inside out to be
 * evaluated is asking them to evaluate something other than the thing they
 * built.
 *
 * Set RIGORRUN_AGENT_BEHAVIOUR=careless to ship the bug on purpose.
 */
import { createInterface } from 'node:readline';
import { CARELESS, CAREFUL, runTask } from '../../booking-agent/src/agent.ts';

const behaviour = process.env['RIGORRUN_AGENT_BEHAVIOUR'] === 'careless' ? CARELESS : CAREFUL;

interface Request {
  protocol?: string;
  probe?: boolean;
  task?: { inputs?: Record<string, unknown> };
  environment?: { mcpUrl?: string };
}

const say = (value: unknown): void => process.stdout.write(`${JSON.stringify(value)}\n`);

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (!line.trim()) continue;
  let request: Request;
  try {
    request = JSON.parse(line) as Request;
  } catch {
    say({ status: 'failed', output: 'that was not JSON' });
    continue;
  }

  if (request.probe === true) {
    say({ ok: true, agent: { name: 'booking-agent-process', version: '1.0.0' } });
    continue;
  }

  try {
    const output = await runTask(
      request.environment?.mcpUrl ?? '',
      (request.task?.inputs ?? {}) as Record<string, unknown>,
      behaviour,
    );
    say({ status: 'completed', output });
  } catch (error) {
    say({ status: 'failed', output: (error as Error).message });
  }
  // One case, one process. RigorRun starts a fresh one for the next case, so
  // nothing of this case survives into the next.
  break;
}
