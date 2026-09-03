/**
 * The Northstar Support engine.
 *
 * Design rule that the whole product depends on: **this engine enforces
 * referential integrity, never business policy.**
 *
 * You cannot refund an order that does not exist — that is integrity. You *can*
 * refund $500 with no manager approval, refund the same order twice, or refund
 * an order belonging to someone else — those are policy failures, and if the
 * engine blocked them there would be nothing for RigorRun to catch. Policy
 * lives in the contract and is checked by the verifier against the state the
 * agent left behind.
 *
 * The engine is pure TypeScript with no Node built-ins, so the identical code
 * runs in the CRM UI, in the dashboard, in the CLI and in CI.
 */
import type { ObservedEvent } from '@rigorrun/core';
import { fullWorldSeed, getScenario, type ManagerBehaviour, type Scenario } from './scenarios.ts';
import type {
  AuditEntry,
  ManagerApproval,
  NorthstarState,
  Refund,
  ToolErrorCode,
  ToolName,
  ToolResult,
} from './types.ts';
import { TOOL_NAMES } from './types.ts';

/** Fixed epoch so that two runs of the same case produce identical timestamps. */
const BASE_TIME = Date.UTC(2026, 0, 20, 9, 0, 0);
const TICK_MS = 1000;

export interface EngineOptions {
  /**
   * Scenario mutations applied on top of the seed.
   * Supported: `fail_once:<tool>`, `fail_always:<tool>`, `manager:<behaviour>`.
   */
  mutations?: string[];
  actor?: string;
}

function emptyState(): NorthstarState {
  return {
    customers: [],
    orders: [],
    tickets: [],
    notes: [],
    approvals: [],
    refunds: [],
    audit: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const ok = <T>(data: T): ToolResult<T> => ({ ok: true, data });
const fail = (code: Parameters<typeof errorOf>[0], message: string): ToolResult<never> => ({
  ok: false,
  error: errorOf(code, message),
});
function errorOf(code: ToolErrorCode, message: string) {
  return { code, message };
}

export class NorthstarEngine {
  private state: NorthstarState = emptyState();
  private log: ObservedEvent[] = [];
  private tick = 0;
  private seq = 0;
  private manager: ManagerBehaviour = 'approve';
  private failOnce = new Set<string>();
  private failAlways = new Set<string>();
  private readonly actor: string;
  private scenarioId = 'custom';

  constructor(options: EngineOptions = {}) {
    this.actor = options.actor ?? 'agent.rigorrun';
    this.applyMutations(options.mutations ?? []);
  }

  /** Build an engine seeded from a single scenario — the benchmark entry point. */
  static fromScenario(scenarioId: string, options: EngineOptions = {}): NorthstarEngine {
    const engine = new NorthstarEngine(options);
    engine.seedScenario(getScenario(scenarioId));
    return engine;
  }

  /** Build an engine holding every scenario's data — what the clickable CRM shows. */
  static fullWorld(options: EngineOptions = {}): NorthstarEngine {
    const engine = new NorthstarEngine(options);
    engine.state = { ...clone(fullWorldSeed()), audit: [] };
    engine.scenarioId = 'full-world';
    return engine;
  }

  private applyMutations(mutations: string[]): void {
    for (const mutation of mutations) {
      const [kind, value] = mutation.split(':', 2);
      if (!value) continue;
      if (kind === 'fail_once') this.failOnce.add(value);
      else if (kind === 'fail_always') this.failAlways.add(value);
      else if (kind === 'manager') this.manager = value as ManagerBehaviour;
    }
  }

  /** Replace the world with a scenario's seed. Resets the clock and the log. */
  seedScenario(scenario: Scenario): void {
    this.state = {
      customers: clone(scenario.customers),
      orders: clone(scenario.orders),
      tickets: clone(scenario.tickets),
      notes: clone(scenario.notes),
      approvals: clone(scenario.approvals),
      refunds: clone(scenario.refunds),
      audit: [],
    };
    this.scenarioId = scenario.id;
    // An explicit `manager:` mutation wins over the scenario default.
    if (this.manager === 'approve') this.manager = scenario.manager;
    this.tick = 0;
    this.seq = 0;
    this.log = [];
  }

  /** Restore the engine to the seeded state of its scenario. */
  reset(): void {
    if (this.scenarioId !== 'custom' && this.scenarioId !== 'full-world') {
      const scenario = getScenario(this.scenarioId);
      this.manager = scenario.manager;
      this.seedScenario(scenario);
    }
  }

  get currentScenarioId(): string {
    return this.scenarioId;
  }

  /** A deep copy — callers can never mutate engine state by accident. */
  snapshot(): NorthstarState {
    return clone(this.state);
  }

  /** Live read-only view, used by the CRM UI's render path. */
  peek(): Readonly<NorthstarState> {
    return this.state;
  }

  events(): ObservedEvent[] {
    return clone(this.log);
  }

  private now(): string {
    return new Date(BASE_TIME + this.tick * TICK_MS).toISOString();
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(7000 + this.seq)}`;
  }

  private record(
    type: string,
    payload: Record<string, unknown>,
    ok: boolean,
    error?: string,
  ): void {
    this.log.push({
      type,
      at: this.tick * TICK_MS,
      payload,
      ok,
      ...(error ? { error } : {}),
    });
  }

  /**
   * Single entry point for agents. Never throws: a bad call returns a typed
   * error so an agent's error handling (or lack of it) is itself observable.
   */
  call(tool: string, args: Record<string, unknown> = {}): ToolResult {
    this.tick += 1;

    if (!(TOOL_NAMES as readonly string[]).includes(tool)) {
      const result = fail('UNKNOWN_TOOL', `No such tool: ${tool}`);
      this.record(`tool.${tool}`, args, false, 'UNKNOWN_TOOL');
      return result;
    }
    const name = tool as ToolName;

    if (this.failAlways.has(name) || this.failOnce.has(name)) {
      this.failOnce.delete(name);
      const result = fail('TOOL_UNAVAILABLE', `${name} is temporarily unavailable. Retry.`);
      this.record(`tool.${name}`, args, false, 'TOOL_UNAVAILABLE');
      return result;
    }

    const result = this.dispatch(name, args);
    this.record(`tool.${name}`, args, result.ok, result.ok ? undefined : result.error.code);
    return result;
  }

  private dispatch(name: ToolName, args: Record<string, unknown>): ToolResult {
    switch (name) {
      case 'getCustomer':
        return this.getCustomer(str(args['customerId']));
      case 'listOrders':
        return this.listOrders(str(args['customerId']));
      case 'getOrder':
        return this.getOrder(str(args['orderId']));
      case 'listTickets':
        return this.listTickets(str(args['customerId']));
      case 'getTicket':
        return this.getTicket(str(args['ticketId']));
      case 'readNotes':
        return this.readNotes(str(args['customerId']));
      case 'listRefunds':
        return this.listRefunds(str(args['orderId']));
      case 'requestManagerApproval':
        return this.requestManagerApproval(args);
      case 'getApproval':
        return this.getApproval(str(args['approvalId']));
      case 'createRefund':
        return this.createRefund(args);
      case 'resolveTicket':
        return this.resolveTicket(str(args['ticketId']));
      case 'addAuditNote':
        return this.addAuditNote(args);
    }
  }

  // ---------------------------------------------------------------- reads

  private getCustomer(customerId: string | null): ToolResult {
    if (!customerId) return fail('INVALID_ARGUMENT', 'customerId is required');
    const found = this.state.customers.find((c) => c.id === customerId);
    if (!found) return fail('CUSTOMER_NOT_FOUND', `No customer with id ${customerId}`);
    return ok(clone(found));
  }

  private listOrders(customerId: string | null): ToolResult {
    if (!customerId) return fail('INVALID_ARGUMENT', 'customerId is required');
    return ok(clone(this.state.orders.filter((o) => o.customerId === customerId)));
  }

  private getOrder(orderId: string | null): ToolResult {
    if (!orderId) return fail('INVALID_ARGUMENT', 'orderId is required');
    const found = this.state.orders.find((o) => o.id === orderId);
    if (!found) return fail('ORDER_NOT_FOUND', `No order with id ${orderId}`);
    return ok(clone(found));
  }

  private listTickets(customerId: string | null): ToolResult {
    if (!customerId) return fail('INVALID_ARGUMENT', 'customerId is required');
    return ok(clone(this.state.tickets.filter((t) => t.customerId === customerId)));
  }

  private getTicket(ticketId: string | null): ToolResult {
    if (!ticketId) return fail('INVALID_ARGUMENT', 'ticketId is required');
    const found = this.state.tickets.find((t) => t.id === ticketId);
    if (!found) return fail('TICKET_NOT_FOUND', `No ticket with id ${ticketId}`);
    return ok(clone(found));
  }

  private readNotes(customerId: string | null): ToolResult {
    if (!customerId) return fail('INVALID_ARGUMENT', 'customerId is required');
    // Notes are untrusted customer-authored content. The engine returns them
    // verbatim; treating them as instructions is the agent's mistake to make.
    return ok(clone(this.state.notes.filter((n) => n.customerId === customerId)));
  }

  private listRefunds(orderId: string | null): ToolResult {
    if (!orderId) return fail('INVALID_ARGUMENT', 'orderId is required');
    return ok(clone(this.state.refunds.filter((r) => r.orderId === orderId)));
  }

  private getApproval(approvalId: string | null): ToolResult {
    if (!approvalId) return fail('INVALID_ARGUMENT', 'approvalId is required');
    const found = this.state.approvals.find((a) => a.id === approvalId);
    if (!found) return fail('APPROVAL_NOT_FOUND', `No approval with id ${approvalId}`);
    return ok(clone(found));
  }

  // --------------------------------------------------------------- writes

  private requestManagerApproval(args: Record<string, unknown>): ToolResult {
    const ticketId = str(args['ticketId']);
    const orderId = str(args['orderId']);
    const amount = num(args['amount']);
    const reason = str(args['reason']) ?? '';

    if (!ticketId) return fail('INVALID_ARGUMENT', 'ticketId is required');
    if (!orderId) return fail('INVALID_ARGUMENT', 'orderId is required');
    if (amount === null) return fail('INVALID_AMOUNT', 'amount must be a positive number');
    if (!this.state.tickets.some((t) => t.id === ticketId))
      return fail('TICKET_NOT_FOUND', `No ticket with id ${ticketId}`);
    if (!this.state.orders.some((o) => o.id === orderId))
      return fail('ORDER_NOT_FOUND', `No order with id ${orderId}`);

    const status =
      this.manager === 'approve' ? 'approved' : this.manager === 'reject' ? 'rejected' : 'pending';
    const approval: ManagerApproval = {
      id: this.nextId('APR'),
      ticketId,
      orderId,
      requestedAmount: amount,
      status,
      requestedBy: this.actor,
      decidedBy: status === 'pending' ? null : 'manager.dilnoza',
      reason,
      createdAt: this.now(),
    };
    this.state.approvals.push(approval);
    this.record('approval.requested', { approvalId: approval.id, orderId, amount }, true);
    if (status !== 'pending') {
      this.record(`approval.${status}`, { approvalId: approval.id, orderId, amount }, true);
    }
    return ok(clone(approval));
  }

  /**
   * Issues a refund. Integrity is enforced; policy is not.
   *
   * Deliberately permitted here (and caught by the verifier instead):
   *  - an amount above the self-serve limit with no approval,
   *  - a second refund on an order that already has one,
   *  - a refund whose customer does not own the order,
   *  - a refund on a cancelled order,
   *  - a refund with no ticket linked.
   */
  private createRefund(args: Record<string, unknown>): ToolResult {
    const orderId = str(args['orderId']);
    const customerId = str(args['customerId']);
    const ticketId = str(args['ticketId']);
    const approvalId = str(args['approvalId']);
    const rawAmount = args['amount'];

    if (!orderId) return fail('INVALID_ARGUMENT', 'orderId is required');
    if (!customerId) return fail('INVALID_ARGUMENT', 'customerId is required');

    // Amounts must arrive as real numbers. Free text is rejected rather than
    // guessed at — silently coercing "forty dollars please" is how money moves
    // by accident.
    if (typeof rawAmount !== 'number' || !Number.isFinite(rawAmount) || rawAmount <= 0) {
      return fail(
        'INVALID_AMOUNT',
        `amount must be a positive number, received ${JSON.stringify(rawAmount)}`,
      );
    }
    const amount = Math.round(rawAmount * 100) / 100;

    if (!this.state.orders.some((o) => o.id === orderId))
      return fail('ORDER_NOT_FOUND', `No order with id ${orderId}`);
    if (!this.state.customers.some((c) => c.id === customerId))
      return fail('CUSTOMER_NOT_FOUND', `No customer with id ${customerId}`);
    if (ticketId && !this.state.tickets.some((t) => t.id === ticketId))
      return fail('TICKET_NOT_FOUND', `No ticket with id ${ticketId}`);
    if (approvalId && !this.state.approvals.some((a) => a.id === approvalId))
      return fail('APPROVAL_NOT_FOUND', `No approval with id ${approvalId}`);

    const refund: Refund = {
      id: this.nextId('REF'),
      orderId,
      customerId,
      ticketId: ticketId ?? null,
      amount,
      approvalId: approvalId ?? null,
      issuedBy: this.actor,
      createdAt: this.now(),
    };
    this.state.refunds.push(refund);
    this.record(
      'refund.created',
      {
        refundId: refund.id,
        orderId,
        customerId,
        ticketId: refund.ticketId,
        amount,
        approvalId: refund.approvalId,
      },
      true,
    );
    return ok(clone(refund));
  }

  private resolveTicket(ticketId: string | null): ToolResult {
    if (!ticketId) return fail('INVALID_ARGUMENT', 'ticketId is required');
    const found = this.state.tickets.find((t) => t.id === ticketId);
    if (!found) return fail('TICKET_NOT_FOUND', `No ticket with id ${ticketId}`);
    found.status = 'resolved';
    this.record('ticket.resolved', { ticketId }, true);
    return ok(clone(found));
  }

  private addAuditNote(args: Record<string, unknown>): ToolResult {
    const action = str(args['action']) ?? 'note';
    const details = isRecord(args['details']) ? args['details'] : {};
    const entry: AuditEntry = {
      id: this.nextId('AUD'),
      at: this.now(),
      actor: this.actor,
      action,
      details: clone(details),
    };
    this.state.audit.push(entry);
    this.record('audit.appended', { auditId: entry.id, action, details: entry.details }, true);
    return ok(clone(entry));
  }

  // ------------------------------------------------------------ CRM helpers

  /** Applies a human's refund submission from the CRM form. */
  submitRefundFromUi(input: {
    orderId: string;
    customerId: string;
    ticketId: string | null;
    amount: number;
    approvalId: string | null;
  }): ToolResult {
    return this.call('createRefund', { ...input });
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
