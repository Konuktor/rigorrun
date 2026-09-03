/**
 * HTTP agent adapter.
 *
 * RigorRun drives the loop and the agent stays stateless: we POST the task plus
 * the history so far, the agent replies with either the next tool call or a
 * final report. See docs/AGENT_PROTOCOL.md.
 *
 * Security: the endpoint comes from the operator's own configuration, never
 * from a benchmark file — a downloaded benchmark must not be able to point
 * RigorRun at an arbitrary host. Redirects are refused, responses are size
 * capped, and every reply is validated before use.
 */
import { z } from 'zod';
import type { AgentAdapter, AgentEnvironment, AgentRunInput, AgentRunOutput } from './types.ts';

const ResponseSchema = z.union([
  z.object({
    action: z.object({
      tool: z.string().min(1),
      args: z.record(z.string(), z.unknown()).default({}),
    }),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    done: z.literal(true),
    report: z.string().max(8000),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
      })
      .optional(),
    costUsd: z.number().nullable().optional(),
  }),
]);

export interface HttpAgentConfig {
  id: string;
  name: string;
  endpoint: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Opt-in for endpoints outside loopback. Off by default. */
  allowRemoteHosts?: boolean;
}

const MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Rejects anything that is not a plain HTTP(S) endpoint, and by default
 * anything that is not loopback — the documented use case is an agent running
 * on the operator's own machine.
 */
export function assertSafeAgentUrl(raw: string, allowRemoteHosts = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Agent endpoint is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Agent endpoint must be http or https, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error('Agent endpoint must not embed credentials in the URL.');
  }
  const host = url.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (!isLoopback && !allowRemoteHosts) {
    throw new Error(
      `Refusing to call ${host}: pass allowRemoteHosts to target a non-loopback agent endpoint.`,
    );
  }
  return url;
}

export function createHttpAgent(config: HttpAgentConfig): AgentAdapter {
  const url = assertSafeAgentUrl(config.endpoint, config.allowRemoteHosts ?? false);

  return {
    id: config.id,
    name: config.name,
    kind: 'http',
    description: `HTTP agent at ${url.origin}${url.pathname}`,

    async execute(input: AgentRunInput, env: AgentEnvironment): Promise<AgentRunOutput> {
      const history: { tool: string; args: Record<string, unknown>; result: unknown }[] = [];
      const usage: AgentRunOutput['usage'] = null;

      while (env.stepsRemaining() > 0) {
        const reply = await post(url, config, {
          protocol: 'rigorrun/agent/1',
          caseId: input.caseId,
          task: input.task,
          history,
          stepsRemaining: env.stepsRemaining(),
        });

        const parsed = ResponseSchema.safeParse(reply);
        if (!parsed.success) {
          return {
            report: `Agent returned a response that does not match the RigorRun agent protocol: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
            costUsd: null,
            costNote: 'cost unavailable',
          };
        }

        if ('done' in parsed.data) {
          return {
            report: parsed.data.report,
            usage: parsed.data.usage ?? usage,
            costUsd: parsed.data.costUsd ?? null,
            costNote: parsed.data.costUsd === undefined ? 'cost unavailable' : 'reported by agent',
          };
        }

        if (parsed.data.note) env.note(parsed.data.note);
        const result = await env.call(parsed.data.action.tool, parsed.data.action.args);
        history.push({ tool: parsed.data.action.tool, args: parsed.data.action.args, result });
      }

      return {
        report: 'Agent exhausted its step budget without producing a final report.',
        usage,
        costUsd: null,
        costNote: 'cost unavailable',
      };
    },
  };
}

async function post(url: URL, config: HttpAgentConfig, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000);
  try {
    const response = await fetch(url, {
      method: config.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...config.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      // A redirect could take us somewhere the safety check never saw.
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Agent endpoint returned HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(`Agent response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
