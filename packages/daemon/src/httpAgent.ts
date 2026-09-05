/**
 * An agent that owns its own loop.
 *
 * This lives with the runner rather than with `@rigorrun/agents`, and the
 * reason is worth recording. It publishes an MCP proxy session, so it pulls in
 * a Node HTTP server — and `@rigorrun/agents` is imported by the browser
 * bundle for the offline example. Putting it there shipped 190KB of
 * `@hono/node-server` to the browser and produced a blank page, because that
 * code references `global`. A package boundary is the only version of this
 * rule a bundler can enforce.
 *
 * The existing HTTP protocol makes RigorRun the driver: it posts the task and
 * the history so far, the agent replies with one tool call, and round it goes.
 * That is a fine shape for an agent written against it and the wrong shape for
 * an agent that already exists, because every real agent already has a loop.
 * Asking somebody to turn theirs inside out to be evaluated is asking them to
 * evaluate something other than the thing they built.
 *
 * So this protocol hands over a URL instead. RigorRun posts the task once, with
 * an MCP endpoint scoped to that case, and waits. The agent connects, works,
 * and says when it is done. Everything it did came through the proxy, so the
 * evidence is identical to an in-process run and so are the limits — the step
 * budget, the allowed tools, the production write guard.
 *
 * The agent's own account of what happened is recorded and never scored. That
 * rule does not soften because the agent had more autonomy: the verdict still
 * comes from reading the system afterwards.
 */
import { z } from 'zod';
import { createProxySession, type ProxyServer } from '@rigorrun/proxy';
import {
  assertSafeAgentUrl,
  type AgentAdapter,
  type AgentEnvironment,
  type AgentRunInput,
  type AgentRunOutput,
} from '@rigorrun/agents';

export const AGENT_PROTOCOL_V2 = 'rigorrun/agent/2';

const CompletionSchema = z.object({
  status: z.enum(['completed', 'failed']),
  /** The agent's account of what it did. Displayed, never scored. */
  output: z.string().max(8000).default(''),
  usage: z
    .object({
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
    })
    .optional(),
  costUsd: z.number().nullable().optional(),
});

const ProbeSchema = z.object({
  ok: z.literal(true),
  agent: z.object({ name: z.string().default(''), version: z.string().default('') }).optional(),
});

export interface HttpV2AgentConfig {
  id: string;
  name: string;
  endpoint: string;
  headers?: Record<string, string>;
  /** How long one case may take. An agent with its own loop needs room. */
  timeoutMs?: number;
  /** Opt-in for endpoints outside loopback. Off by default. */
  allowRemoteHosts?: boolean;
  /** The server that publishes the per-case MCP endpoint. */
  proxy: ProxyServer;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Checks an endpoint is there and speaks the protocol, without doing any work.
 *
 * The reason this exists: an agent must not be markable as CONNECTED because
 * somebody typed a URL. A connector that says "connected" on the strength of a
 * well-formed string is the kind of thing that turns into a failed benchmark
 * run half an hour later, blamed on the agent.
 */
export async function probeAgent(
  config: Pick<HttpV2AgentConfig, 'endpoint' | 'headers' | 'allowRemoteHosts'>,
): Promise<{ ok: true; name: string; version: string } | { ok: false; problem: string }> {
  let url: URL;
  try {
    url = assertSafeAgentUrl(config.endpoint, config.allowRemoteHosts ?? false);
  } catch (error) {
    return { ok: false, problem: (error as Error).message };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', ...(config.headers ?? {}) },
      body: JSON.stringify({ protocol: AGENT_PROTOCOL_V2, probe: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { ok: false, problem: `The endpoint answered ${response.status}.` };
    }
    const parsed = ProbeSchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        ok: false,
        problem:
          'The endpoint answered, but not with {"ok":true}. Check it handles a probe request.',
      };
    }
    return {
      ok: true,
      name: parsed.data.agent?.name ?? '',
      version: parsed.data.agent?.version ?? '',
    };
  } catch (error) {
    return { ok: false, problem: `Could not reach the endpoint: ${(error as Error).message}` };
  }
}

export function createHttpV2Agent(config: HttpV2AgentConfig): AgentAdapter {
  const url = assertSafeAgentUrl(config.endpoint, config.allowRemoteHosts ?? false);

  return {
    id: config.id,
    name: config.name,
    kind: 'http',
    description: `Your agent at ${url.origin}, driving itself through the RigorRun proxy.`,

    async execute(input: AgentRunInput, env: AgentEnvironment): Promise<AgentRunOutput> {
      const { server, calls } = createProxySession({
        tools: input.task.tools,
        environment: env,
      });
      const { sessionId, url: mcpUrl } = await config.proxy.publish(server);
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const expiresAt = new Date(Date.now() + timeoutMs).toISOString();

      try {
        const response = await fetch(url, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', ...(config.headers ?? {}) },
          body: JSON.stringify({
            protocol: AGENT_PROTOCOL_V2,
            caseId: input.caseId,
            task: {
              instruction: input.task.instruction,
              inputs: input.task.inputs,
              policyBrief: input.task.policyBrief,
            },
            environment: { mcpUrl, expiresAt },
            maxSteps: input.maxSteps,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          return report(`The agent endpoint answered ${response.status}.`, calls.length);
        }

        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) {
          return report('The agent endpoint sent more than RigorRun will read.', calls.length);
        }

        const parsed = CompletionSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          return report(
            `The agent endpoint answered in a shape RigorRun does not understand: ${parsed.error.message}`,
            calls.length,
          );
        }

        return {
          report: parsed.data.output || `The agent reported ${parsed.data.status}.`,
          usage: parsed.data.usage ?? null,
          costUsd: parsed.data.costUsd ?? null,
          costNote: parsed.data.costUsd === undefined ? 'cost unavailable' : 'reported by the agent',
        };
      } catch (error) {
        // A timeout is a result, not a crash: an agent that never finishes has
        // failed the case, and whatever it managed to do first is already in
        // the evidence.
        return report(`The agent did not finish: ${(error as Error).message}`, calls.length);
      } finally {
        // The endpoint stops existing whatever happened, so nothing can keep
        // touching the customer's system after the case is over.
        await config.proxy.revoke(sessionId);
      }
    },
  };
}

function report(problem: string, callCount: number): AgentRunOutput {
  return {
    report: `${problem} ${callCount} tool call(s) were made before that.`,
    usage: null,
    costUsd: null,
    costNote: 'cost unavailable',
  };
}
