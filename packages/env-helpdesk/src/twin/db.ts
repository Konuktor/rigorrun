import { z } from 'zod';
import {
  defaultSeed,
  type AccessLogEntry,
  type Customer,
  type HelpdeskState,
  type Order,
  type OutboxMessage,
  type Refund,
  type Ticket,
} from './seed.ts';

const orgSchema = z.object({ id: z.string(), org_id: z.string(), name: z.string() }).strict();
const customerSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    name: z.string(),
    email: z.string(),
    notes: z.string(),
  })
  .strict();
const orderSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    customer_id: z.string(),
    ref: z.string(),
    amount_cents: z.number().int().nonnegative(),
    refunded_cents: z.number().int().nonnegative(),
    status: z.enum(['paid', 'partially_refunded', 'refunded']),
  })
  .strict();
const ticketSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    customer_id: z.string(),
    subject: z.string(),
    body: z.string(),
    status: z.enum(['open', 'closed']),
    notes: z.array(z.string()),
  })
  .strict();
const refundSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    order_id: z.string(),
    amount_cents: z.number().int().positive(),
    reason: z.string(),
  })
  .strict();
const outboxSchema = z
  .object({
    id: z.string(),
    org_id: z.string().nullable(),
    to: z.string(),
    subject: z.string(),
    body: z.string(),
  })
  .strict();
const accessLogSchema = z
  .object({
    seq: z.number().int().positive(),
    token: z.string(),
    principal_org: z.string().nullable(),
    role: z.enum(['support', 'service']),
    tool: z.string(),
    action: z.enum(['read', 'write']),
    table: z.string(),
    row_id: z.string(),
    row_org_id: z.string().nullable(),
  })
  .strict();
const tokenSchema = z
  .object({
    token: z.string(),
    org_id: z.string().nullable(),
    role: z.enum(['support', 'service']),
  })
  .strict();

/** The exact JSON accepted by POST /_twin/seed. */
export const helpdeskStateSchema = z
  .object({
    orgs: z.array(orgSchema),
    customers: z.array(customerSchema),
    orders: z.array(orderSchema),
    tickets: z.array(ticketSchema),
    refunds: z.array(refundSchema),
    outbox: z.array(outboxSchema),
    access_log: z.array(accessLogSchema),
    tokens: z.array(tokenSchema),
  })
  .strict();

export interface Principal {
  token: string;
  org_id: string | null;
  role: 'support' | 'service';
}

type OrgRow = { org_id: string | null };
type Result<T> = { ok: true; value: T } | { ok: false; message: string };

/** The sole tenant boundary used by all database operations. */
export function scoped<T extends OrgRow>(principal: Principal, rows: T[]): T[] {
  return principal.role === 'service'
    ? rows
    : rows.filter((row) => row.org_id === principal.org_id);
}

function nextId(rows: Array<{ id: string }>, prefix: string): number {
  return (
    rows.reduce((largest, row) => {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(row.id);
      return match?.[1] ? Math.max(largest, Number(match[1])) : largest;
    }, 0) + 1
  );
}

export class HelpdeskDb {
  private state: HelpdeskState;
  private counters = { customer: 1, order: 1, ticket: 1, refund: 1, message: 1, access: 1 };

  constructor(seed: HelpdeskState = defaultSeed()) {
    this.state = structuredClone(seed);
    this.recalculateCounters();
  }

  reset(): void {
    this.state = defaultSeed();
    this.recalculateCounters();
  }

  replace(next: HelpdeskState): void {
    this.state = structuredClone(next);
    this.recalculateCounters();
  }

  dump(): HelpdeskState {
    return structuredClone(this.state);
  }

  principalFor(token: string | undefined): Principal | undefined {
    if (!token) return undefined;
    const record = this.state.tokens.find((entry) => entry.token === token);
    return record ? { ...record } : undefined;
  }

  whoami(principal: Principal, tool: string): Principal {
    this.log(principal, tool, 'read', 'tokens', principal.token, principal.org_id);
    return { ...principal };
  }

  listCustomers(principal: Principal, tool: string, query?: string): Customer[] {
    const needle = query?.trim().toLowerCase();
    const rows = scoped(principal, this.state.customers).filter((customer) =>
      needle
        ? [customer.id, customer.name, customer.email, customer.notes].some((value) =>
            value.toLowerCase().includes(needle),
          )
        : true,
    );
    return this.readRows(principal, tool, 'customers', rows);
  }

  getCustomer(principal: Principal, tool: string, customerId: string): Result<Customer> {
    const row = scoped(principal, this.state.customers).find((entry) => entry.id === customerId);
    return row
      ? { ok: true, value: this.readRows(principal, tool, 'customers', [row])[0]! }
      : { ok: false, message: 'not found' };
  }

  findOrders(
    principal: Principal,
    tool: string,
    filters: { email?: string; ref?: string },
  ): Order[] {
    let rows = scoped(principal, this.state.orders);
    if (filters.ref) rows = rows.filter((order) => order.ref === filters.ref);
    if (filters.email) {
      const customerIds = new Set(
        scoped(principal, this.state.customers)
          .filter((customer) => customer.email === filters.email)
          .map((customer) => customer.id),
      );
      rows = rows.filter((order) => customerIds.has(order.customer_id));
    }
    return this.readRows(principal, tool, 'orders', rows);
  }

  getOrder(principal: Principal, tool: string, orderId: string): Result<Order> {
    const row = scoped(principal, this.state.orders).find((entry) => entry.id === orderId);
    return row
      ? { ok: true, value: this.readRows(principal, tool, 'orders', [row])[0]! }
      : { ok: false, message: 'not found' };
  }

  listTickets(principal: Principal, tool: string, status?: 'open' | 'closed'): Ticket[] {
    const rows = scoped(principal, this.state.tickets).filter((ticket) =>
      status ? ticket.status === status : true,
    );
    return this.readRows(principal, tool, 'tickets', rows);
  }

  getTicket(principal: Principal, tool: string, ticketId: string): Result<Ticket> {
    const row = scoped(principal, this.state.tickets).find((entry) => entry.id === ticketId);
    return row
      ? { ok: true, value: this.readRows(principal, tool, 'tickets', [row])[0]! }
      : { ok: false, message: 'not found' };
  }

  refundOrder(
    principal: Principal,
    tool: string,
    input: { order_id: string; amount_cents: number; reason: string },
  ): Result<{ order: Order; refund: Refund }> {
    const order = scoped(principal, this.state.orders).find((entry) => entry.id === input.order_id);
    if (!order) return { ok: false, message: 'not found' };
    const remaining = order.amount_cents - order.refunded_cents;
    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
      return { ok: false, message: 'amount_cents must be greater than zero' };
    }
    if (input.amount_cents > remaining) {
      return { ok: false, message: `amount_cents exceeds refundable amount (${remaining})` };
    }

    order.refunded_cents += input.amount_cents;
    order.status = order.refunded_cents === order.amount_cents ? 'refunded' : 'partially_refunded';
    const refund: Refund = {
      id: `ref_${this.counters.refund++}`,
      org_id: order.org_id,
      order_id: order.id,
      amount_cents: input.amount_cents,
      reason: input.reason,
    };
    this.state.refunds.push(refund);
    this.log(principal, tool, 'write', 'orders', order.id, order.org_id);
    this.log(principal, tool, 'write', 'refunds', refund.id, refund.org_id);
    return { ok: true, value: structuredClone({ order, refund }) };
  }

  sendEmail(
    principal: Principal,
    tool: string,
    input: { to: string; subject: string; body: string },
  ): OutboxMessage {
    const message: OutboxMessage = {
      id: `msg_${this.counters.message++}`,
      org_id: principal.org_id,
      ...input,
    };
    // New rows still pass through the same boundary before being written.
    const visible = scoped(principal, [message])[0];
    if (!visible) throw new Error('not found');
    this.state.outbox.push(message);
    this.log(principal, tool, 'write', 'outbox', message.id, message.org_id);
    return structuredClone(message);
  }

  addTicketNote(
    principal: Principal,
    tool: string,
    ticketId: string,
    text: string,
  ): Result<Ticket> {
    const ticket = scoped(principal, this.state.tickets).find((entry) => entry.id === ticketId);
    if (!ticket) return { ok: false, message: 'not found' };
    ticket.notes.push(text);
    this.log(principal, tool, 'write', 'tickets', ticket.id, ticket.org_id);
    return { ok: true, value: structuredClone(ticket) };
  }

  closeTicket(principal: Principal, tool: string, ticketId: string): Result<Ticket> {
    const ticket = scoped(principal, this.state.tickets).find((entry) => entry.id === ticketId);
    if (!ticket) return { ok: false, message: 'not found' };
    ticket.status = 'closed';
    this.log(principal, tool, 'write', 'tickets', ticket.id, ticket.org_id);
    return { ok: true, value: structuredClone(ticket) };
  }

  deleteCustomer(principal: Principal, tool: string, customerId: string): Result<Customer> {
    const customer = scoped(principal, this.state.customers).find(
      (entry) => entry.id === customerId,
    );
    if (!customer) return { ok: false, message: 'not found' };
    this.state.customers = this.state.customers.filter((entry) => entry !== customer);
    this.log(principal, tool, 'write', 'customers', customer.id, customer.org_id);
    return { ok: true, value: structuredClone(customer) };
  }

  exportCustomers(principal: Principal, tool: string, orgId?: string): Result<Customer[]> {
    if (orgId) {
      const org = scoped(principal, this.state.orgs).find((entry) => entry.id === orgId);
      if (!org) return { ok: false, message: 'not found' };
    }
    const rows = scoped(principal, this.state.customers).filter((customer) =>
      orgId ? customer.org_id === orgId : true,
    );
    return { ok: true, value: this.readRows(principal, tool, 'customers', rows) };
  }

  private readRows<T extends { id: string; org_id: string | null }>(
    principal: Principal,
    tool: string,
    table: string,
    rows: T[],
  ): T[] {
    for (const row of rows) this.log(principal, tool, 'read', table, row.id, row.org_id);
    return structuredClone(rows);
  }

  private log(
    principal: Principal,
    tool: string,
    action: 'read' | 'write',
    table: string,
    rowId: string,
    rowOrgId: string | null,
  ): void {
    const entry: AccessLogEntry = {
      seq: this.counters.access++,
      token: principal.token,
      principal_org: principal.org_id,
      role: principal.role,
      tool,
      action,
      table,
      row_id: rowId,
      row_org_id: rowOrgId,
    };
    this.state.access_log.push(entry);
  }

  private recalculateCounters(): void {
    this.counters = {
      customer: nextId(this.state.customers, 'cus_'),
      order: nextId(this.state.orders, 'ord_'),
      ticket: nextId(this.state.tickets, 'tkt_'),
      refund: nextId(this.state.refunds, 'ref_'),
      message: nextId(this.state.outbox, 'msg_'),
      access: this.state.access_log.reduce((largest, entry) => Math.max(largest, entry.seq), 0) + 1,
    };
  }
}

/** Shared process state used by both HTTP hooks and MCP requests. */
export const helpdeskDb = new HelpdeskDb();
