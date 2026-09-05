/**
 * The same handshake, over the other transport.
 *
 * Streamable HTTP has been claimed since the MCP client landed and was only
 * ever exercised against RigorRun's own guards — the URL checks in
 * `safety.test.ts` never open a socket. This connects to a real MCP server
 * over real HTTP, so "stdio and HTTP" stops being a claim about a switch
 * statement.
 *
 * The server is `fixtures/external/mcp-venue-desk` on its HTTP entry point,
 * which builds the *same* `createDeskServer()` the stdio entry point does. If
 * they diverged, this would be a test about a second fixture rather than about
 * the transport, so the assertions below are deliberately the ones
 * `connect.test.ts` makes over stdio.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { McpConnection, type McpHttpConfig } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const entry = join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'http.ts');

/** A port nothing else in this repository uses. */
const PORT = 8934;
const DESK: McpHttpConfig = { transport: 'http', url: `http://127.0.0.1:${PORT}/mcp` };

let server: ChildProcess;

beforeAll(async () => {
  server = spawn(tsx, [entry], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the fixture never said it was listening')), 30_000);
    server.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('error', reject);
  });
}, 40_000);

afterAll(() => {
  server?.kill('SIGTERM');
});

describe('connecting to somebody else’s MCP server over HTTP', () => {
  it('completes a handshake and reports who answered', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      expect(connection.discovery.serverName).toBe('venue-desk');
      expect(connection.discovery.serverVersion).toBe('1.0.0');
      expect(connection.discovery.protocolVersion).not.toBe('');
    } finally {
      await connection.close();
    }
  }, 30_000);

  it('discovers the same tools the stdio transport does', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      expect(connection.discovery.tools.map((tool) => tool.name).sort()).toEqual([
        'check_availability',
        'confirm_booking',
        'create_booking',
        'find_bookings',
        'get_booking',
        'list_organisers',
        'list_venues',
        'record_signoff',
        'reset_desk',
      ]);
    } finally {
      await connection.close();
    }
  }, 30_000);

  it('calls a tool and reads the structured result back', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      const result = await connection.call('list_venues', {});
      expect(result.ok).toBe(true);
      // The shape is the server's, not ours: the assertion is that something
      // structured survived the round trip, not that it says a particular word.
      expect(result.structured ?? result.content).toBeTruthy();
    } finally {
      await connection.close();
    }
  }, 30_000);
});
