/**
 * A real MCP client.
 *
 * This is the first code in RigorRun that talks to a system it did not create.
 * Everything it returns is therefore treated as evidence about an untrusted
 * peer rather than as configuration: tool descriptions are text to show a
 * person, annotations are claims with a named source, and results are data that
 * never reaches an assertion path.
 *
 * Discovery answers three questions the product needs before it can do
 * anything else. What can be done here. What is that likely to cost the world.
 * And what, if anything, can be read back afterwards — because a benchmark that
 * cannot observe the outcome is not a benchmark.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { assertSafeCommand, assertSafeMcpUrl, describeConfig, type McpConfig } from './config.ts';
import type { LocalOAuthProvider } from './oauth.ts';
import {
  assessFromHints,
  paramsFromInputSchema,
  readServerHints,
  type CallResult,
  type DiscoveredTool,
  type DiscoveryResult,
} from '@rigorrun/connector';

export const CLIENT_INFO = { name: 'rigorrun', version: '0.1.0' } as const;

export type { DiscoveredTool, DiscoveryResult };

export interface ConnectOptions {
  /** How long the handshake may take before RigorRun gives up. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** The sign-in for this config, if it has one. Only HTTP servers can. */
function signInFor(config: McpConfig): LocalOAuthProvider | undefined {
  return config.transport === 'http' ? config.auth : undefined;
}

function buildTransport(config: McpConfig): Transport {
  if (config.transport === 'stdio') {
    assertSafeCommand(config);
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      // The SDK's default set is a deliberately small allowlist. Merging the
      // operator's own variables over it is how a server gets its credentials
      // without RigorRun handing the child every secret in the shell.
      env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
      ...(config.cwd ? { cwd: config.cwd } : {}),
      // Keep the child's diagnostics rather than letting them onto our stdout,
      // which is a machine-readable channel for the CLI.
      stderr: 'pipe',
    });
  }
  const url = assertSafeMcpUrl(config.url);
  // The cast is interop, not laziness. This repository compiles with
  // `exactOptionalPropertyTypes`, under which the SDK's `sessionId?: string`
  // and its own `string | undefined` implementation are not assignable. The
  // SDK is not built with that flag; nothing about the runtime shape differs.
  return new StreamableHTTPClientTransport(url, {
    ...(config.headers ? { requestInit: { headers: config.headers } } : {}),
    // The SDK does the protocol: it tries the token it has, refreshes an
    // expired one, and only then asks the provider to send somebody to sign
    // in. What RigorRun supplies is where the tokens live and how a person is
    // asked — see `oauth.ts`.
    // `LocalOAuthProvider` satisfies the SDK's `OAuthClientProvider`
    // structurally. Cast rather than implemented, so that RigorRun's own
    // provider does not import the SDK's types into everything that touches a
    // connector config.
    ...(config.auth ? { authProvider: config.auth as never } : {}),
  }) as unknown as Transport;
}

/**
 * An open connection to somebody else's MCP server.
 *
 * Deliberately not an `EnvironmentAdapter`. Connecting to a server and being an
 * environment RigorRun can benchmark against are different things, and most of
 * the product's honesty depends on keeping them apart: a server is a tool
 * surface, and it becomes an environment only once a person has said which of
 * its tools read state and how the world gets reset.
 */
export class McpConnection {
  private constructor(
    private readonly client: Client,
    readonly discovery: DiscoveryResult,
    readonly config: McpConfig,
    /**
     * The child this connection spawned, for a stdio connector.
     *
     * Exposed because a process is not only this connection's business. The
     * runner writes it down so that if the runner is killed outright — no
     * shutdown, no chance to close anything — the next one can find the server
     * left behind and end it. An orphaned stdio server keeps running with the
     * credentials it was handed, which is exactly the thing tidy shutdown
     * exists to prevent and exactly the thing SIGKILL skips.
     */
    readonly childPid: number | null,
  ) {}

  static async open(config: McpConfig, options: ConnectOptions = {}): Promise<McpConnection> {
    const auth = signInFor(config);
    if (!auth) return await McpConnection.connect(config, options);
    // The loopback listener has to be up before the first request, because the
    // SDK reads the address to come back to the moment a 401 arrives — and it
    // is torn down as soon as this connection is made or refused. A sign-in
    // that nobody completes leaves nothing listening.
    await auth.start();
    try {
      return await McpConnection.connect(config, options);
    } finally {
      await auth.close();
    }
  }

  private static async connect(
    config: McpConfig,
    options: ConnectOptions,
  ): Promise<McpConnection> {
    let client = new Client(CLIENT_INFO, { capabilities: {} });
    let transport = buildTransport(config);
    const startedAt = Date.now();

    try {
      await client.connect(transport, { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    } catch (error) {
      const auth = signInFor(config);
      if (!auth || !(error instanceof UnauthorizedError)) {
        throw new Error(
          `Could not reach the MCP server at ${describeConfig(config)}: ${(error as Error).message}`,
          { cause: error },
        );
      }
      // The server wants somebody to sign in, and the SDK has already sent
      // them. What is left is the code coming back to the loopback listener,
      // and one more attempt with the token it buys. The exchange happens on
      // the transport that saw the 401, because that is what knows which
      // authorization server the server named.
      const code = await auth.waitForCode();
      await (transport as StreamableHTTPClientTransport).finishAuth(code);
      await client.close().catch(() => undefined);
      // A transport cannot be started twice, so the second attempt is a fresh
      // one. It needs no discovery: the tokens are in the credential store.
      client = new Client(CLIENT_INFO, { capabilities: {} });
      transport = buildTransport(config);
      try {
        await client.connect(transport, { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
      } catch (again) {
        throw new Error(
          `Signed in to ${describeConfig(config)}, but the connection was still refused: ${(again as Error).message}`,
          { cause: again },
        );
      }
    }
    const latencyMs = Date.now() - startedAt;

    const server = client.getServerVersion();
    let tools: DiscoveredTool[];
    try {
      tools = await discoverTools(client, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw new Error(
        `Connected to ${describeConfig(config)}, but tools/list failed: ${(error as Error).message}`,
        { cause: error },
      );
    }

    return new McpConnection(
      client,
      {
        serverName: server?.name ?? 'unnamed server',
        serverVersion: server?.version ?? 'unknown',
        // The SDK exposes what initialize settled on, which is the number worth
        // reporting: a server may have negotiated down from the latest.
        protocolVersion: transportProtocolVersion(client),
        tools,
        latencyMs,
      },
      config,
      (transport as { pid?: number | null }).pid ?? null,
    );
  }

  /** Calls a tool. The result is untrusted data and is returned unparsed. */
  async call(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<McpCallResult> {
    const startedAt = Date.now();
    try {
      const result = await this.client.callTool({ name, arguments: args }, undefined, {
        timeout: timeoutMs,
      });
      return {
        ok: result.isError !== true,
        content: result.content,
        // Present when the server publishes an outputSchema. This is the only
        // machine-readable view of a result, and the only one worth inducing a
        // record shape from.
        structured: (result as { structuredContent?: unknown }).structuredContent,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        error: { code: 'call_failed', message: (error as Error).message },
        durationMs: Date.now() - startedAt,
      };
    }
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => undefined);
  }
}

/** Kept as a name because callers use it; the shape is the connector's. */
export type McpCallResult = CallResult;

async function discoverTools(client: Client, timeout: number): Promise<DiscoveredTool[]> {
  const listed = await client.listTools(undefined, { timeout });
  return listed.tools.map((tool) => {
    const converted = paramsFromInputSchema(tool.inputSchema);
    const hints = readServerHints(tool.annotations);
    return {
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      params: converted.params,
      unsupported: converted.unsupported,
      schemaTruncated: converted.truncated,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      hints,
      risk: assessFromHints(hints),
    };
  });
}

/**
 * What the handshake settled on.
 *
 * The SDK keeps this on the transport rather than the client, and older
 * transports do not carry it at all, so an absent value means "the default was
 * used" rather than "something went wrong".
 */
function transportProtocolVersion(client: Client): string {
  const transport = (client as unknown as { transport?: { protocolVersion?: unknown } }).transport;
  return typeof transport?.protocolVersion === 'string' ? transport.protocolVersion : 'negotiated';
}
