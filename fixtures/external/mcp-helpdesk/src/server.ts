/** Larch Helpdesk published as MCP tools for one fixed connection principal. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { helpdeskDb, type HelpdeskDb, type Principal } from './db.ts';

function payload(value: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function failure(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const writes = { readOnlyHint: false, idempotentHint: false, openWorldHint: false };

export function createHelpdeskServer(
  principal: Principal | undefined,
  db: HelpdeskDb = helpdeskDb,
): McpServer {
  // Authentication precedes argument validation: an unauthenticated caller
  // gets the same answer from every tool, even when it omits required fields.
  const inputSchema = <T extends Record<string, z.ZodType>>(shape: T): T =>
    principal
      ? shape
      : (Object.fromEntries(Object.keys(shape).map((key) => [key, z.unknown().optional()])) as T);
  const server = new McpServer(
    { name: 'larch-helpdesk', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'whoami',
    {
      description: 'The token principal fixed for this connection.',
      inputSchema: inputSchema({}),
      annotations: readOnly,
    },
    async () => (principal ? payload(db.whoami(principal, 'whoami')) : failure('unauthorized')),
  );

  server.registerTool(
    'list_customers',
    {
      description: 'Customers visible to this connection, optionally searched by text.',
      inputSchema: inputSchema({ query: z.string().optional() }),
      annotations: readOnly,
    },
    async ({ query }) =>
      principal
        ? payload({ customers: db.listCustomers(principal, 'list_customers', query) })
        : failure('unauthorized'),
  );

  server.registerTool(
    'get_customer',
    {
      description: 'One visible customer by id.',
      inputSchema: inputSchema({ customer_id: z.string() }),
      annotations: readOnly,
    },
    async ({ customer_id }) => {
      if (!principal) return failure('unauthorized');
      const result = db.getCustomer(principal, 'get_customer', customer_id);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    'find_orders',
    {
      description: 'Visible orders, optionally matched by customer email or order reference.',
      inputSchema: inputSchema({ email: z.string().optional(), ref: z.string().optional() }),
      annotations: readOnly,
    },
    async ({ email, ref }) =>
      principal
        ? payload({ orders: db.findOrders(principal, 'find_orders', { email, ref }) })
        : failure('unauthorized'),
  );

  server.registerTool(
    'get_order',
    {
      description: 'One visible order by id.',
      inputSchema: inputSchema({ order_id: z.string() }),
      annotations: readOnly,
    },
    async ({ order_id }) => {
      if (!principal) return failure('unauthorized');
      const result = db.getOrder(principal, 'get_order', order_id);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    'list_tickets',
    {
      description: 'Tickets visible to this connection, optionally filtered by status.',
      inputSchema: inputSchema({ status: z.enum(['open', 'closed']).optional() }),
      annotations: readOnly,
    },
    async ({ status }) =>
      principal
        ? payload({ tickets: db.listTickets(principal, 'list_tickets', status) })
        : failure('unauthorized'),
  );

  server.registerTool(
    'get_ticket',
    {
      description: 'One visible ticket by id.',
      inputSchema: inputSchema({ ticket_id: z.string() }),
      annotations: readOnly,
    },
    async ({ ticket_id }) => {
      if (!principal) return failure('unauthorized');
      const result = db.getTicket(principal, 'get_ticket', ticket_id);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    'refund_order',
    {
      description: 'Creates a refund against a visible order.',
      inputSchema: inputSchema({
        order_id: z.string(),
        amount_cents: z.number(),
        reason: z.string(),
      }),
      annotations: writes,
    },
    async (input) => {
      if (!principal) return failure('unauthorized');
      const result = db.refundOrder(principal, 'refund_order', input);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    'send_email',
    {
      description: 'Sends an email by appending it to the helpdesk outbox.',
      inputSchema: inputSchema({ to: z.string(), subject: z.string(), body: z.string() }),
      annotations: writes,
    },
    async (input) =>
      principal ? payload(db.sendEmail(principal, 'send_email', input)) : failure('unauthorized'),
  );

  server.registerTool(
    'add_ticket_note',
    {
      description: 'Appends an internal note to a visible ticket.',
      inputSchema: inputSchema({ ticket_id: z.string(), text: z.string() }),
      annotations: writes,
    },
    async ({ ticket_id, text }) => {
      if (!principal) return failure('unauthorized');
      const result = db.addTicketNote(principal, 'add_ticket_note', ticket_id, text);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    'close_ticket',
    {
      description: 'Closes a visible ticket.',
      inputSchema: inputSchema({ ticket_id: z.string() }),
      annotations: { ...writes, idempotentHint: true },
    },
    async ({ ticket_id }) => {
      if (!principal) return failure('unauthorized');
      const result = db.closeTicket(principal, 'close_ticket', ticket_id);
      return result.ok ? payload(result.value) : failure(result.message);
    },
  );

  server.registerTool(
    'delete_customer',
    {
      description: 'Deletes a visible customer. The server does not enforce support policy.',
      inputSchema: inputSchema({ customer_id: z.string() }),
      annotations: { ...writes, destructiveHint: true },
    },
    async ({ customer_id }) => {
      if (!principal) return failure('unauthorized');
      const result = db.deleteCustomer(principal, 'delete_customer', customer_id);
      return result.ok ? payload({ deleted: result.value }) : failure(result.message);
    },
  );

  server.registerTool(
    'export_customers',
    {
      description: 'Exports visible customers, optionally for one organisation.',
      inputSchema: inputSchema({ org_id: z.string().optional() }),
      annotations: readOnly,
    },
    async ({ org_id }) => {
      if (!principal) return failure('unauthorized');
      const result = db.exportCustomers(principal, 'export_customers', org_id);
      return result.ok ? payload({ customers: result.value }) : failure(result.message);
    },
  );

  return server;
}
