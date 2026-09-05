/**
 * Putting an existing agent under test, in about ten lines.
 *
 * The whole surface is one function that takes yours and returns a server
 * speaking the protocol RigorRun expects. Deliberately not a framework:
 * RigorRun evaluates agents, and the moment this starts offering a loop, a
 * memory or a tool abstraction it is competing with the thing it is supposed to
 * measure, and every opinion it takes narrows what it can honestly measure.
 *
 *     import { defineAgent, serve } from '@rigorrun/agent-sdk';
 *
 *     const agent = defineAgent(async ({ task, environment }) => {
 *       // Connect your existing agent to environment.mcpUrl and let it work.
 *       return { status: 'completed', output: 'Confirmed the booking.' };
 *     });
 *
 *     await serve(agent, { port: 8900 });
 *
 * What you get for free is the part that is tedious and easy to get subtly
 * wrong: the probe RigorRun uses to check you are there before it starts a run,
 * request validation, error shaping, and a body limit.
 */
import { serve as honoServe, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';

export const AGENT_PROTOCOL_V2 = 'rigorrun/agent/2';

/** One case, as your agent receives it. */
export interface AgentTaskRequest {
  caseId: string;
  task: {
    /** What to do, in the words the operator would use. */
    instruction: string;
    /** The specific arguments this case is about. */
    inputs: Record<string, unknown>;
    /** The policy the agent is expected to follow. Deliberately public. */
    policyBrief: string;
  };
  environment: {
    /**
     * An MCP endpoint scoped to this case.
     *
     * Everything your agent is allowed to do is here, and only until the case
     * ends. Point your existing MCP client at it.
     */
    mcpUrl: string;
    expiresAt: string;
  };
  /** How many tool calls this case allows. Exceeding it ends the case. */
  maxSteps: number;
}

export interface AgentResult {
  status: 'completed' | 'failed';
  /**
   * Your account of what you did.
   *
   * Recorded and shown next to what actually happened, and never scored. The
   * verdict comes from reading the system afterwards, so there is nothing to
   * gain here by being generous and nothing to lose by being honest.
   */
  output?: string;
  usage?: { promptTokens: number; completionTokens: number };
  costUsd?: number | null;
}

export type AgentHandler = (request: AgentTaskRequest) => Promise<AgentResult> | AgentResult;

export interface DefinedAgent {
  name: string;
  version: string;
  handle: AgentHandler;
}

export interface DefineAgentOptions {
  name?: string;
  version?: string;
}

export function defineAgent(handler: AgentHandler, options: DefineAgentOptions = {}): DefinedAgent {
  return {
    name: options.name ?? 'agent',
    version: options.version ?? '0.0.0',
    handle: handler,
  };
}

export interface ServeOptions {
  port?: number;
  /**
   * Defaults to loopback.
   *
   * An agent under test usually has credentials for the system it is being
   * tested against, so binding it to every interface should be a decision
   * somebody makes on purpose rather than a default they inherit.
   */
  hostname?: string;
}

const MAX_BODY_BYTES = 1024 * 1024;

/** Serves one agent over the protocol RigorRun speaks. */
export async function serve(
  agent: DefinedAgent,
  options: ServeOptions = {},
): Promise<{ port: number; url: string; close: () => Promise<void> }> {
  const app = new Hono();

  app.post('/', async (context) => {
    const declared = Number(context.req.header('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return context.json({ status: 'failed', output: 'request too large' }, 413);
    }

    let body: Record<string, unknown>;
    try {
      body = (await context.req.json()) as Record<string, unknown>;
    } catch {
      return context.json({ status: 'failed', output: 'body was not JSON' }, 400);
    }

    // The probe: RigorRun asking whether anybody is home, before it commits a
    // run to an endpoint that turns out to be a typo.
    if (body['probe'] === true) {
      return context.json({ ok: true, agent: { name: agent.name, version: agent.version } });
    }

    if (body['protocol'] !== AGENT_PROTOCOL_V2) {
      return context.json(
        { status: 'failed', output: `expected protocol ${AGENT_PROTOCOL_V2}` },
        400,
      );
    }

    try {
      const result = await agent.handle(body as unknown as AgentTaskRequest);
      return context.json(result);
    } catch (error) {
      // An agent that threw has failed the case, which is a result. Reporting
      // it as one keeps the run going and puts the reason in the evidence,
      // rather than turning one bad case into a broken benchmark.
      return context.json({ status: 'failed', output: `the agent threw: ${(error as Error).message}` });
    }
  });

  const server: ServerType = honoServe({
    fetch: app.fetch,
    hostname: options.hostname ?? '127.0.0.1',
    port: options.port ?? 0,
  });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);

  return {
    port,
    url: `http://${options.hostname ?? '127.0.0.1'}:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
