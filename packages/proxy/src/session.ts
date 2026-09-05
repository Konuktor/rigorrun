/**
 * An MCP server that is really a hole punched into a running benchmark case.
 *
 * This is the adoption path that costs a customer nothing. An agent that
 * already speaks MCP — because it was built for Claude, or Cursor, or anything
 * else — does not need a RigorRun SDK, a rewrite, or a step function. It needs
 * a URL. Point it here and it is under test, and everything it does arrives in
 * the evidence.
 *
 * What makes that safe is that this exposes no new powers. A session is a
 * transport onto the *same* bounded channel an in-process agent gets: the same
 * step budget, the same production write guard, the same recorded steps, the
 * same allowed-tool list from the case. An agent cannot reach further by
 * arriving over HTTP than it could by being imported, which is the property
 * that has to hold for a proxy like this to be worth having at all.
 *
 * And the private half of the case never comes near it. `tools/list` is built
 * from the public task, so the assertions an agent is judged against cannot be
 * discovered by asking the thing it is talking to.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AgentEnvironment } from '@rigorrun/agents';
import type { ToolDescription } from '@rigorrun/core';

export const PROXY_INFO = { name: 'rigorrun-proxy', version: '0.1.0' } as const;

/** One tool call, as it went past. */
export interface ProxyCall {
  ordinal: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  at: number;
  durationMs: number;
  error?: string;
}

export interface ProxySessionOptions {
  /** Exactly the tools the case allows. Nothing else is advertised or callable. */
  tools: readonly ToolDescription[];
  /** The bounded channel. The only way this session can affect anything. */
  environment: AgentEnvironment;
  /** Called after every call, so a UI can show activity as it happens. */
  onCall?: (call: ProxyCall) => void;
}

/**
 * Builds the MCP server for one case.
 *
 * Not connected to a transport here: a session is created before anyone knows
 * how the agent will arrive, and the same server object serves whichever
 * transport turns up.
 */
export function createProxySession(options: ProxySessionOptions): {
  server: Server;
  calls: ProxyCall[];
} {
  const calls: ProxyCall[] = [];
  const allowed = new Map(options.tools.map((tool) => [tool.name, tool]));

  const server = new Server(PROXY_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: options.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: inputSchemaFor(tool),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const startedAt = Date.now();

    // A tool the case did not offer is refused here rather than passed
    // through. The allowed list is part of the test.
    if (!allowed.has(name)) {
      const call: ProxyCall = {
        ordinal: calls.length,
        tool: name,
        args,
        ok: false,
        at: startedAt,
        durationMs: 0,
        error: 'TOOL_NOT_ALLOWED',
      };
      calls.push(call);
      options.onCall?.(call);
      return {
        content: [{ type: 'text', text: `${name} is not available in this task.` }],
        isError: true,
      };
    }

    const result = await options.environment.call(name, args);
    const call: ProxyCall = {
      ordinal: calls.length,
      tool: name,
      args,
      ok: result.ok,
      at: startedAt,
      durationMs: Date.now() - startedAt,
      ...(result.ok ? {} : { error: result.error.code }),
    };
    calls.push(call);
    options.onCall?.(call);

    // The agent gets the real answer, success or failure. Softening a refusal
    // into something that reads like success would change what is being
    // measured: how an agent behaves when a system says no is most of the
    // question.
    return result.ok
      ? {
          content: [{ type: 'text', text: JSON.stringify(result.data) }],
          structuredContent: asStructured(result.data),
        }
      : {
          content: [{ type: 'text', text: `${result.error.code}: ${result.error.message}` }],
          isError: true,
        };
  });

  return { server, calls };
}

/** A JSON Schema for the tool's parameters, from the case's own description. */
function inputSchemaFor(tool: ToolDescription): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of tool.params) {
    const property: Record<string, unknown> = {
      type: param.type === 'enum' || param.type === 'timestamp' ? 'string' : param.type,
    };
    if (param.enumValues) property['enum'] = param.enumValues;
    if (param.description) property['description'] = param.description;
    if (param.type === 'timestamp') property['format'] = 'date-time';
    properties[param.name] = property;
    if (param.required) required.push(param.name);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** MCP's `structuredContent` must be an object; anything else travels as text. */
function asStructured(data: unknown): Record<string, unknown> | undefined {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined;
}
