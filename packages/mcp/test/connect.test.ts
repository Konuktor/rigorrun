/**
 * A real MCP handshake against a server RigorRun did not write.
 *
 * This spawns `fixtures/external/mcp-venue-desk` over stdio exactly the way a
 * customer's local connector would, and asserts on what actually comes back
 * rather than on a fixture. If the SDK changes, if the protocol moves, or if
 * the converter starts guessing, this is what notices.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { McpConnection, isConfirmedReadOnly, mayMutate, type McpStdioConfig } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const entry = join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts');

const DESK: McpStdioConfig = { transport: 'stdio', command: tsx, args: [entry] };

describe('connecting to somebody else’s MCP server', () => {
  it('completes a handshake and reports who answered', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      expect(connection.discovery.serverName).toBe('venue-desk');
      expect(connection.discovery.serverVersion).toBe('1.0.0');
      expect(connection.discovery.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await connection.close();
    }
  }, 30_000);

  it('discovers the tools the server publishes, and their arguments', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      const names = connection.discovery.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        'confirm_booking',
        'create_booking',
        'find_bookings',
        'get_booking',
        'list_organisers',
        'list_venues',
        'record_signoff',
        'reset_desk',
      ]);

      const create = connection.discovery.tools.find((tool) => tool.name === 'create_booking')!;
      const byName = Object.fromEntries(create.params.map((param) => [param.name, param]));
      expect(byName['venueId']).toMatchObject({ type: 'string', required: true });
      expect(byName['depositAmount']).toMatchObject({ type: 'number', required: true });
      expect(byName['note']).toMatchObject({ type: 'string', required: false });
      expect(create.unsupported).toEqual([]);
      expect(create.schemaTruncated).toBe(false);
    } finally {
      await connection.close();
    }
  }, 30_000);

  it('reads a closed set of values as an enum, from its structure alone', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      const find = connection.discovery.tools.find((tool) => tool.name === 'find_bookings')!;
      const status = find.params.find((param) => param.name === 'bookingStatus')!;
      expect(status.type).toBe('enum');
      expect(status.enumValues).toEqual(['held', 'confirmed', 'cancelled']);
      expect(status.required).toBe(false);
    } finally {
      await connection.close();
    }
  }, 30_000);

  it('treats a server’s annotations as a claim, never as permission', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      const list = connection.discovery.tools.find((tool) => tool.name === 'list_venues')!;
      // The server said read-only, and RigorRun records that it said so...
      expect(list.hints.readOnly).toBe(true);
      expect(list.risk).toMatchObject({ level: 'read', source: 'server-hint' });
      // ...and still will not treat it as established, because a server's word
      // about its own safety is exactly the thing that cannot be trusted.
      expect(isConfirmedReadOnly(list.risk)).toBe(false);
      expect(mayMutate(list.risk)).toBe(true);

      const destructive = connection.discovery.tools.find((tool) => tool.name === 'reset_desk')!;
      expect(destructive.risk.level).toBe('destructive');

      // An unannotated tool is assumed to write. Silence buys caution, not trust.
      const signoff = connection.discovery.tools.find((tool) => tool.name === 'record_signoff')!;
      expect(signoff.hints).toEqual({});
      expect(signoff.risk).toMatchObject({ level: 'unknown', source: 'default' });
      expect(mayMutate(signoff.risk)).toBe(true);
    } finally {
      await connection.close();
    }
  }, 30_000);

  it('keeps the output schema where the server publishes one, and notes where it does not', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      const get = connection.discovery.tools.find((tool) => tool.name === 'get_booking')!;
      const find = connection.discovery.tools.find((tool) => tool.name === 'find_bookings')!;
      expect(get.outputSchema).toBeDefined();
      expect(find.outputSchema).toBeUndefined();
    } finally {
      await connection.close();
    }
  }, 30_000);

  it('calls a tool and gets the server’s own structured answer back', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      const before = await connection.call('get_booking', { bookingId: 'BKG-4002' });
      expect(before.ok).toBe(true);
      expect(before.structured).toMatchObject({
        bookingId: 'BKG-4002',
        bookingStatus: 'held',
        depositAmount: 250,
      });

      const confirmed = await connection.call('confirm_booking', { bookingId: 'BKG-4002' });
      expect(confirmed.ok).toBe(true);

      const after = await connection.call('get_booking', { bookingId: 'BKG-4002' });
      expect(after.structured).toMatchObject({ bookingStatus: 'confirmed' });
    } finally {
      await connection.close();
    }
  }, 30_000);

  it('reports a tool error as a failed call rather than throwing', async () => {
    const connection = await McpConnection.open(DESK);
    try {
      const missing = await connection.call('get_booking', { bookingId: 'BKG-9999' });
      expect(missing.ok).toBe(false);
    } finally {
      await connection.close();
    }
  }, 30_000);
});
