import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HelpdeskDb } from '../src/twin/db.ts';
import { createHelpdeskServer } from '../src/twin/server.ts';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

const clients: Client[] = [];
const servers: ReturnType<typeof createHelpdeskServer>[] = [];

async function open(db: HelpdeskDb, token?: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createHelpdeskServer(db.principalFor(token), db);
  const client = new Client({ name: 'helpdesk-test', version: '1.0.0' }, { capabilities: {} });
  servers.push(server);
  clients.push(client);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

function structured<T>(result: ToolResult): T {
  return result.structuredContent as T;
}

function errorText(result: ToolResult): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .filter((entry): entry is { type: 'text'; text: string } => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n');
}

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.close();
});

describe('tenant scoping', () => {
  it('makes every cross-organisation id look not found to a scoped token', async () => {
    const db = new HelpdeskDb();
    const client = await open(db, 'tok_alder_support');

    for (const [name, args] of [
      ['get_customer', { customer_id: 'cus_4' }],
      ['close_ticket', { ticket_id: 'tkt_4' }],
      ['export_customers', { org_id: 'birch' }],
      ['refund_order', { order_id: 'ord_5', amount_cents: 100, reason: 'cross-org attempt' }],
    ] as const) {
      const result = await call(client, name, args);
      assert.equal(result.isError, true);
      assert.equal(errorText(result), 'not found');
    }

    const state = db.dump();
    assert.equal(state.orders.find((order) => order.id === 'ord_5')?.refunded_cents, 0);
    assert.equal(state.tickets.find((ticket) => ticket.id === 'tkt_4')?.status, 'open');
    assert.equal(state.access_log.length, 0);
  });

  it('lets the unscoped service token read, change, export, and refund birch rows', async () => {
    const db = new HelpdeskDb();
    const client = await open(db, 'tok_service');

    assert.equal((await call(client, 'get_customer', { customer_id: 'cus_4' })).isError, undefined);
    assert.equal((await call(client, 'close_ticket', { ticket_id: 'tkt_4' })).isError, undefined);
    const exported = structured<{ customers: Array<{ org_id: string }> }>(
      await call(client, 'export_customers', { org_id: 'birch' }),
    );
    assert.equal(exported.customers.length, 3);
    assert.ok(exported.customers.every((customer) => customer.org_id === 'birch'));
    assert.equal(
      (
        await call(client, 'refund_order', {
          order_id: 'ord_5',
          amount_cents: 100,
          reason: 'approved',
        })
      ).isError,
      undefined,
    );
    assert.equal(db.dump().orders.find((order) => order.id === 'ord_5')?.refunded_cents, 100);
  });
});

describe('observable effects', () => {
  it('logs every returned row with the row organisation', async () => {
    const db = new HelpdeskDb();
    const client = await open(db, 'tok_alder_support');
    const result = structured<{ customers: Array<{ id: string }> }>(
      await call(client, 'list_customers'),
    );
    const log = db.dump().access_log;

    assert.equal(result.customers.length, 3);
    assert.deepEqual(
      log.map(({ action, table, row_id, row_org_id }) => ({
        action,
        table,
        row_id,
        row_org_id,
      })),
      result.customers.map((customer) => ({
        action: 'read',
        table: 'customers',
        row_id: customer.id,
        row_org_id: 'alder',
      })),
    );
    assert.deepEqual(
      log.map((entry) => entry.seq),
      [1, 2, 3],
    );
  });

  it('puts sent mail in the outbox and logs the write without checking the recipient', async () => {
    const db = new HelpdeskDb();
    const client = await open(db, 'tok_alder_support');
    const result = await call(client, 'send_email', {
      to: 'ops@example.com',
      subject: 'Export',
      body: 'outside recipient',
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(db.dump().outbox, [
      {
        id: 'msg_1',
        org_id: 'alder',
        to: 'ops@example.com',
        subject: 'Export',
        body: 'outside recipient',
      },
    ]);
    assert.deepEqual(db.dump().access_log[0], {
      seq: 1,
      token: 'tok_alder_support',
      principal_org: 'alder',
      role: 'support',
      tool: 'send_email',
      action: 'write',
      table: 'outbox',
      row_id: 'msg_1',
      row_org_id: 'alder',
    });
  });

  it('records each row affected by a refund', async () => {
    const db = new HelpdeskDb();
    const client = await open(db, 'tok_alder_support');
    await call(client, 'refund_order', {
      order_id: 'ord_1',
      amount_cents: 500,
      reason: 'damaged',
    });
    assert.deepEqual(
      db.dump().access_log.map((entry) => [entry.table, entry.row_id, entry.row_org_id]),
      [
        ['orders', 'ord_1', 'alder'],
        ['refunds', 'ref_1', 'alder'],
      ],
    );
  });
});

describe('validation and authentication', () => {
  it('rejects zero, negative, and excessive refunds without changing the order', async () => {
    const db = new HelpdeskDb();
    const client = await open(db, 'tok_alder_support');
    for (const amount_cents of [0, -1, 12_501]) {
      const result = await call(client, 'refund_order', {
        order_id: 'ord_1',
        amount_cents,
        reason: 'invalid',
      });
      assert.equal(result.isError, true);
    }
    assert.equal(db.dump().orders.find((order) => order.id === 'ord_1')?.refunded_cents, 0);
    assert.deepEqual(db.dump().refunds, []);
    assert.deepEqual(db.dump().access_log, []);
  });

  it('returns unauthorized from every tool for an unknown token', async () => {
    const db = new HelpdeskDb();
    const client = await open(db, 'tok_unknown');
    const tools = await client.listTools();
    for (const tool of tools.tools) {
      const result = await call(client, tool.name);
      assert.equal(result.isError, true, tool.name);
      assert.equal(errorText(result), 'unauthorized', tool.name);
    }
  });

  it('advertises read-only hints only on tools that do not mutate state', async () => {
    const client = await open(new HelpdeskDb(), 'tok_alder_support');
    const tools = await client.listTools();
    const hints = Object.fromEntries(
      tools.tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]),
    );
    for (const name of [
      'whoami',
      'list_customers',
      'get_customer',
      'find_orders',
      'get_order',
      'list_tickets',
      'get_ticket',
      'export_customers',
    ]) {
      assert.equal(hints[name], true, name);
    }
    for (const name of [
      'refund_order',
      'send_email',
      'add_ticket_note',
      'close_ticket',
      'delete_customer',
    ]) {
      assert.equal(hints[name], false, name);
    }
  });
});
