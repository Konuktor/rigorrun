/**
 * The desk, published over MCP.
 *
 * The annotations below are the ones a reasonable author would write, including
 * one that is quietly wrong: `find_bookings` is annotated `readOnlyHint: true`
 * and is genuinely read-only, but `record_signoff` carries no annotation at all,
 * which is the far more common real-world case. RigorRun has to cope with both
 * without believing either.
 *
 * `find_bookings` also deliberately publishes no `outputSchema`, so anything
 * that wants to know the shape of a booking has to work it out from what comes
 * back rather than from a declaration.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Desk } from './desk.ts';

const venueShape = {
  venueId: z.string(),
  venueName: z.string(),
  capacity: z.number(),
  enquiries: z.number(),
};

const bookingShape = {
  bookingId: z.string(),
  venueId: z.string(),
  organiserId: z.string(),
  depositAmount: z.number(),
  bookingStatus: z.enum(['held', 'confirmed', 'cancelled']),
  signedOffBy: z.string().nullable(),
  note: z.string(),
};

/**
 * How answers are shaped. The default is the well-behaved server: JSON in a
 * text block *and* `structuredContent`. `DESK_RESULT_SHAPE=text-json` is the
 * far more common real server that publishes no output schema and answers with
 * JSON inside a text block only; `prose` answers in sentences, which is a
 * system that can be watched and never verified.
 */
const RESULT_SHAPE = process.env['DESK_RESULT_SHAPE'] ?? 'structured';

/** A server that answers in text alone publishes no output schema either. */
function output<T extends Record<string, unknown>>(schema: T): { outputSchema?: T } {
  return RESULT_SHAPE === 'structured' ? { outputSchema: schema } : {};
}

function payload(value: unknown) {
  if (RESULT_SHAPE === 'text-json') {
    return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
  }
  if (RESULT_SHAPE === 'prose') {
    return { content: [{ type: 'text' as const, text: describeInProse(value) }] };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function describeInProse(value: unknown): string {
  const lines: string[] = [];
  const walk = (entry: unknown, prefix: string) => {
    if (Array.isArray(entry)) {
      lines.push(`${prefix}${entry.length} item(s):`);
      entry.forEach((item, index) => walk(item, `${prefix}  #${index + 1} `));
    } else if (entry && typeof entry === 'object') {
      lines.push(
        `${prefix}${Object.entries(entry as Record<string, unknown>)
          .map(([key, v]) => (v && typeof v === 'object' ? `${key}: (see below)` : `${key} is ${String(v)}`))
          .join(', ')}.`,
      );
      for (const [key, v] of Object.entries(entry as Record<string, unknown>)) {
        if (v && typeof v === 'object') walk(v, `${prefix}${key}: `);
      }
    } else {
      lines.push(`${prefix}${String(entry)}`);
    }
  };
  walk(value, '');
  return lines.join('\n');
}

function failure(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function createDeskServer(desk = new Desk()): McpServer {
  const server = new McpServer(
    { name: 'venue-desk', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'list_venues',
    {
      description: 'Every venue the desk can book, with its capacity.',
      inputSchema: {},
      ...output({ venues: z.array(z.object(venueShape)) }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => payload({ venues: desk.listVenues() }),
  );

  server.registerTool(
    'list_organisers',
    {
      description: 'Everyone who can hold a booking, and whether they are in good standing.',
      inputSchema: {},
      ...output({
        organisers: z.array(
          z.object({
            organiserId: z.string(),
            organiserName: z.string(),
            standing: z.enum(['good', 'flagged']),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => payload({ organisers: desk.listOrganisers() }),
  );

  // No outputSchema on purpose. This is the common case, and the shape has to
  // be induced from the values that come back.
  server.registerTool(
    'find_bookings',
    {
      description: 'Bookings, optionally narrowed to one venue or one status.',
      inputSchema: {
        venueId: z.string().optional(),
        bookingStatus: z.enum(['held', 'confirmed', 'cancelled']).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ venueId, bookingStatus }) =>
      payload({ bookings: desk.findBookings(venueId, bookingStatus) }),
  );

  server.registerTool(
    'check_availability',
    {
      description: 'Whether a venue is free.',
      inputSchema: { venueId: z.string() },
      // Wrong, and not on purpose — see `Desk.checkAvailability`. An enquiry
      // counter was added long after this annotation was written.
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ venueId }) => payload(desk.checkAvailability(venueId)),
  );

  server.registerTool(
    'get_booking',
    {
      description: 'One booking, exactly as the desk has it recorded.',
      inputSchema: { bookingId: z.string() },
      ...output(bookingShape),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ bookingId }) => {
      const result = desk.getBooking(bookingId);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    'create_booking',
    {
      description: 'Holds a venue for an organiser against a deposit.',
      inputSchema: {
        venueId: z.string(),
        organiserId: z.string(),
        depositAmount: z.number(),
        note: z.string().optional(),
      },
      ...output(bookingShape),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      const result = desk.createBooking(input);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  // Annotated with nothing at all — the ordinary case, and the one where a
  // client that guesses from the name would guess wrong.
  server.registerTool(
    'record_signoff',
    {
      description: 'Records who authorised a booking.',
      inputSchema: { bookingId: z.string(), approver: z.string() },
      ...output(bookingShape),
    },
    async ({ bookingId, approver }) => {
      const result = desk.recordSignoff(bookingId, approver);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    'confirm_booking',
    {
      description: 'Moves a held booking to confirmed.',
      inputSchema: { bookingId: z.string() },
      ...output(bookingShape),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ bookingId }) => {
      const result = desk.confirmBooking(bookingId);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    'reset_desk',
    {
      description: 'Restores the desk to its seeded state. Intended for test environments.',
      inputSchema: {},
      ...output({ reset: z.boolean() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async () => {
      desk.reset();
      return payload({ reset: true });
    },
  );

  return server;
}
