import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callJson, openSide, sideConfig } from '../src/connection.ts';
import { draftMatrix } from '../src/draft.ts';
import type { McpConnection } from '@rigorrun/mcp';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const entry = fileURLToPath(
  new URL('../../../fixtures/external/mcp-venue-desk/src/stdio.ts', import.meta.url),
);

describe('credential-aware MCP connections', () => {
  it('builds a stdio config with only the selected side credential added to its environment', () => {
    const matrix = draftMatrix(
      [],
      { transport: 'stdio', command: 'node', args: ['server.js'], env: { MODE: 'test' } },
      {
        agent: { secret: 'A_KEY', apply: { env: 'SIDE_KEY' } },
        observer: { secret: 'B_KEY', apply: { env: 'SIDE_KEY' } },
      },
    );
    expect(sideConfig(matrix, 'observer', 'observer-value')).toEqual({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { MODE: 'test', SIDE_KEY: 'observer-value' },
    });
  });

  it('builds an HTTP config with the selected side credential and prefix in its header', () => {
    const matrix = draftMatrix(
      [],
      { transport: 'http', url: 'https://example.test/mcp' },
      {
        agent: {
          secret: 'A_KEY',
          apply: { header: 'Authorization', prefix: 'Bearer ' },
        },
        observer: { secret: 'B_KEY', apply: { header: 'X-Observer-Key' } },
      },
    );
    expect(sideConfig(matrix, 'agent', 'agent-value')).toEqual({
      transport: 'http',
      url: 'https://example.test/mcp',
      headers: { Authorization: 'Bearer agent-value' },
    });
  });

  it('rejects applying the wrong credential kind for the transport', () => {
    const matrix = draftMatrix(
      [],
      { transport: 'stdio', command: 'node', args: [] },
      {
        agent: { secret: 'A_KEY', apply: { header: 'Authorization' } },
        observer: { secret: 'B_KEY', apply: { env: 'SIDE_KEY' } },
      },
    );
    expect(() => sideConfig(matrix, 'agent', 'value')).toThrow(/header.*stdio.*agent/i);
  });

  it('prefers structured content, parses text JSON, and names failures', async () => {
    const fake = (result: unknown) =>
      ({ call: async () => result }) as unknown as McpConnection;
    await expect(
      callJson(fake({ ok: true, structured: { answer: 1 }, durationMs: 0 }), 'read_one', {}),
    ).resolves.toEqual({ answer: 1 });
    await expect(
      callJson(
        fake({
          ok: true,
          content: [{ type: 'image' }, { type: 'text', text: '{"answer":2}' }],
          durationMs: 0,
        }),
        'read_two',
        {},
      ),
    ).resolves.toEqual({ answer: 2 });
    await expect(
      callJson(fake({ ok: false, error: { code: 'bad', message: 'refused' }, durationMs: 0 }), 'bad_tool', {}),
    ).rejects.toThrow(/bad_tool.*refused/);
    await expect(
      callJson(
        fake({ ok: true, content: [{ type: 'text', text: 'not json' }], durationMs: 0 }),
        'prose_tool',
        {},
      ),
    ).rejects.toThrow(/prose_tool.*non-JSON/);
  });

  it('opens a live stdio server and reads a JSON tool result', async () => {
    const matrix = draftMatrix(
      [],
      { transport: 'stdio', command: tsx, args: [entry] },
      {
        agent: { secret: 'A_KEY', apply: { env: 'SIDE_KEY' } },
        observer: { secret: 'B_KEY', apply: { env: 'SIDE_KEY' } },
      },
    );
    const connection = await openSide(matrix, 'agent', 'agent-value');
    try {
      expect(connection.discovery.serverName).toBe('venue-desk');
      await expect(callJson(connection, 'list_venues', {})).resolves.toMatchObject({
        venues: expect.any(Array),
      });
    } finally {
      await connection.close();
    }
  }, 30_000);
});
