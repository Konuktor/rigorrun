/**
 * Driving the proxy with a real MCP client.
 *
 * The claim under test is the adoption claim: an agent that already speaks MCP
 * needs a URL and nothing else. So this uses the SDK's own client — the same
 * one any other MCP host is built on — rather than a hand-rolled request, and
 * asserts on what it discovers and what it can and cannot do.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentEnvironment, ToolResult } from '@rigorrun/agents';
import type { ToolDescription } from '@rigorrun/core';
import { connect } from 'node:net';
import { ProxyServer, createProxySession, type ProxyCall } from '../src/index.ts';

/** One HTTP request with a Host header of our choosing. Returns the status. */
function rawRequest(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: ${host}\r\n` +
          'Content-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}',
      );
    });
    let received = '';
    socket.on('data', (chunk) => {
      received += String(chunk);
    });
    socket.on('error', reject);
    socket.on('close', () => {
      const match = /^HTTP\/1\.1 (\d{3})/.exec(received);
      resolve(match?.[1] ? Number(match[1]) : 0);
    });
  });
}

const TOOLS: ToolDescription[] = [
  {
    name: 'read_thing',
    description: 'Reads one thing.',
    params: [{ name: 'thingId', type: 'string', required: true, description: '' }],
    readOnly: true,
  },
  {
    name: 'change_thing',
    description: 'Changes one thing.',
    params: [
      { name: 'thingId', type: 'string', required: true, description: '' },
      { name: 'state', type: 'enum', required: true, enumValues: ['open', 'shut'], description: '' },
    ],
    readOnly: false,
  },
];

/** Stands in for the runner's bounded channel. */
function channel(budget = 5): { env: AgentEnvironment; seen: string[] } {
  const seen: string[] = [];
  let remaining = budget;
  return {
    seen,
    env: {
      async call(tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
        if (remaining <= 0) {
          return { ok: false, error: { code: 'TOOL_UNAVAILABLE', message: 'Step budget exhausted.' } };
        }
        remaining -= 1;
        seen.push(`${tool}(${JSON.stringify(args)})`);
        if (tool === 'change_thing' && args['state'] === 'shut') {
          return { ok: false, error: { code: 'REFUSED', message: 'that is not allowed here' } };
        }
        return { ok: true, data: { thingId: args['thingId'], state: 'open' } };
      },
      stepsRemaining: () => remaining,
      note: () => undefined,
    },
  };
}

const started: ProxyServer[] = [];

async function open(options: { budget?: number } = {}) {
  const proxy = new ProxyServer();
  started.push(proxy);
  await proxy.start();

  const { env, seen } = channel(options.budget);
  const calls: ProxyCall[] = [];
  const { server } = createProxySession({
    tools: TOOLS,
    environment: env,
    onCall: (call) => calls.push(call),
  });
  const { sessionId, url } = await proxy.publish(server);

  const client = new Client({ name: 'someone-elses-agent', version: '1.0.0' }, { capabilities: {} });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url)) as unknown as Parameters<Client['connect']>[0],
  );
  return { proxy, client, url, sessionId, calls, seen };
}

afterEach(async () => {
  for (const proxy of started.splice(0)) await proxy.stop();
});

describe('an agent that already speaks MCP', () => {
  it('connects with nothing but a URL, and sees the case’s tools', async () => {
    const { client } = await open();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(['change_thing', 'read_thing']);

    const change = listed.tools.find((tool) => tool.name === 'change_thing')!;
    const schema = change.inputSchema as { properties: Record<string, { enum?: string[] }>; required: string[] };
    expect(schema.properties['state']?.enum).toEqual(['open', 'shut']);
    expect(schema.required.sort()).toEqual(['state', 'thingId']);
    await client.close();
  }, 30_000);

  it('calls through to the case, and the case records it', async () => {
    const { client, calls, seen } = await open();
    const result = await client.callTool({ name: 'read_thing', arguments: { thingId: 'T-1' } });
    expect(result.isError).not.toBe(true);
    expect(seen).toEqual(['read_thing({"thingId":"T-1"})']);
    expect(calls[0]).toMatchObject({ tool: 'read_thing', ok: true, ordinal: 0 });
    await client.close();
  }, 30_000);

  it('passes a refusal back as a refusal', async () => {
    // How an agent behaves when a system says no is most of what is being
    // measured, so a refusal must not be softened into something that reads
    // like success.
    const { client, calls } = await open();
    const result = await client.callTool({
      name: 'change_thing',
      arguments: { thingId: 'T-1', state: 'shut' },
    });
    expect(result.isError).toBe(true);
    expect(calls[0]).toMatchObject({ ok: false, error: 'REFUSED' });
    await client.close();
  }, 30_000);

  it('cannot reach a tool the case did not offer', async () => {
    const { client, calls, seen } = await open();
    const result = await client.callTool({ name: 'delete_everything', arguments: {} });
    expect(result.isError).toBe(true);
    // Refused at the proxy: it never reached the channel, and it is recorded.
    expect(seen).toEqual([]);
    expect(calls[0]).toMatchObject({ tool: 'delete_everything', error: 'TOOL_NOT_ALLOWED' });
    await client.close();
  }, 30_000);

  it('gets no more room than an in-process agent would', async () => {
    const { client } = await open({ budget: 2 });
    await client.callTool({ name: 'read_thing', arguments: { thingId: 'T-1' } });
    await client.callTool({ name: 'read_thing', arguments: { thingId: 'T-2' } });
    const third = await client.callTool({ name: 'read_thing', arguments: { thingId: 'T-3' } });
    expect(third.isError).toBe(true);
    expect(JSON.stringify(third.content)).toMatch(/TOOL_UNAVAILABLE/);
    await client.close();
  }, 30_000);
});

describe('the proxy as an exposed surface', () => {
  it('stops existing the moment the case ends', async () => {
    const { proxy, sessionId, url } = await open();
    await proxy.revoke(sessionId);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(404);
  }, 30_000);

  it('answers a made-up session exactly as it answers a revoked one', async () => {
    const { proxy } = await open();
    const guess = await fetch(`http://127.0.0.1:${proxy.port}/mcp/${'0'.repeat(32)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(guess.status).toBe(404);
  }, 30_000);

  it('refuses a request that arrives claiming somebody else’s host', async () => {
    // DNS rebinding: a hostile page can make a domain it owns resolve to
    // 127.0.0.1, but it cannot change the Host header the browser sends.
    //
    // Written against a raw socket rather than `fetch`, which refuses to set
    // `Host` at all — so a test using it would have proved only that the
    // header never arrived.
    const { proxy, sessionId } = await open();
    const status = await rawRequest(proxy.port, `/mcp/${sessionId}`, 'evil.example.com');
    expect(status).toBe(403);

    // And the same request from a local host gets past this check, so the 403
    // above is the Host rule rather than everything being refused.
    const local = await rawRequest(proxy.port, `/mcp/${sessionId}`, '127.0.0.1');
    expect(local).not.toBe(403);
  }, 30_000);

  it('listens on loopback only', async () => {
    const { proxy } = await open();
    const health = await fetch(`http://127.0.0.1:${proxy.port}/health`);
    expect(await health.json()).toMatchObject({ ok: true, service: 'rigorrun-proxy' });
  }, 30_000);
});
