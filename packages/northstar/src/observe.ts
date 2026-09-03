/**
 * Turns the engine's post-execution state into an `Observation`.
 *
 * `derived` is a *projection* of real state, not a judgement about it: it joins
 * refunds to their orders, tickets and approvals so that assertions can be
 * written declaratively. Every field is mechanically computed from state the
 * agent actually left behind, which is what lets the verifier stay generic
 * while still asking domain-specific questions.
 *
 * Ticket properties are read from the *seed*, not the final state, on purpose.
 * An agent that legitimately refunds and then resolves the ticket must not be
 * punished for the ticket no longer being open at the moment we look.
 */
import type { Observation } from '@rigorrun/core';
import type { NorthstarEngine } from './engine.ts';
import { getScenario } from './scenarios.ts';
import { REFUND_POLICY, type NorthstarState, type Refund } from './types.ts';

export interface DerivedRefund {
  id: string;
  orderId: string;
  customerId: string;
  ticketId: string | null;
  amount: number;
  approvalId: string | null;
  /** `approved` | `rejected` | `pending` | `none` (no approval was attached). */
  approvalStatus: string;
  overSelfServeLimit: boolean;
  /** The refunded order actually belongs to the customer being refunded. */
  ownedByRefundCustomer: boolean;
  /** A ticket is attached AND that ticket belongs to the refunded order. */
  ticketValidForOrder: boolean;
  /** That ticket was open when the work started. */
  ticketOpenAtSeed: boolean;
  orderStatus: string;
  createdDuringRun: boolean;
}

export interface NorthstarDerived {
  selfServeLimit: number;
  refundCount: number;
  createdRefundCount: number;
  refundsForTargetOrder: number;
  totalRefundedForTargetOrder: number;
  refunds: DerivedRefund[];
  createdRefunds: DerivedRefund[];
  auditEntryCount: number;
  auditReferencesCreatedRefund: boolean;
  approvalRequested: boolean;
  approvedApprovalExists: boolean;
  targetOrderStatus: string | null;
  targetTicketStatus: string | null;
  targetTicketId: string | null;
}

export interface ObservationContext {
  scenarioId: string;
  agentReport?: string;
}

export function buildObservation(
  engine: NorthstarEngine,
  context: ObservationContext,
): Observation {
  const scenario = getScenario(context.scenarioId);
  const state = engine.snapshot();
  const seedRefundIds = new Set(scenario.refunds.map((r) => r.id));
  const targetOrderId = scenario.request.orderId;

  const decorate = (refund: Refund): DerivedRefund => {
    const order = state.orders.find((o) => o.id === refund.orderId);
    // Seeded ticket state: what was true when the human/agent started work.
    const seedTicket = scenario.tickets.find((t) => t.id === refund.ticketId);
    const approval = refund.approvalId
      ? state.approvals.find((a) => a.id === refund.approvalId)
      : undefined;

    return {
      id: refund.id,
      orderId: refund.orderId,
      customerId: refund.customerId,
      ticketId: refund.ticketId,
      amount: refund.amount,
      approvalId: refund.approvalId,
      approvalStatus: approval ? approval.status : 'none',
      overSelfServeLimit: refund.amount > REFUND_POLICY.selfServeLimit,
      ownedByRefundCustomer: order ? order.customerId === refund.customerId : false,
      ticketValidForOrder: Boolean(seedTicket && seedTicket.orderId === refund.orderId),
      ticketOpenAtSeed: Boolean(
        seedTicket && (seedTicket.status === 'open' || seedTicket.status === 'pending_customer'),
      ),
      orderStatus: order ? order.status : 'unknown',
      createdDuringRun: !seedRefundIds.has(refund.id),
    };
  };

  const refunds = state.refunds.map(decorate);
  const createdRefunds = refunds.filter((r) => r.createdDuringRun);
  const forTargetOrder = state.refunds.filter((r) => r.orderId === targetOrderId);
  const createdIds = new Set(createdRefunds.map((r) => r.id));
  const seedTicketForOrder = scenario.tickets.find((t) => t.orderId === targetOrderId);

  const derived: NorthstarDerived = {
    selfServeLimit: REFUND_POLICY.selfServeLimit,
    refundCount: state.refunds.length,
    createdRefundCount: createdRefunds.length,
    refundsForTargetOrder: forTargetOrder.length,
    totalRefundedForTargetOrder: round2(forTargetOrder.reduce((sum, r) => sum + r.amount, 0)),
    refunds,
    createdRefunds,
    auditEntryCount: state.audit.length,
    auditReferencesCreatedRefund: state.audit.some((entry) => {
      const blob = JSON.stringify(entry.details);
      return [...createdIds].some((id) => blob.includes(id));
    }),
    approvalRequested: state.approvals.length > scenario.approvals.length,
    approvedApprovalExists: state.approvals.some((a) => a.status === 'approved'),
    targetOrderStatus: state.orders.find((o) => o.id === targetOrderId)?.status ?? null,
    targetTicketStatus: seedTicketForOrder?.status ?? null,
    targetTicketId: seedTicketForOrder?.id ?? null,
  };

  return {
    state,
    events: engine.events(),
    derived,
    ...(context.agentReport === undefined ? {} : { agentReport: context.agentReport }),
  };
}

/** A compact slice of final state for the evidence view. */
export function summariseState(state: NorthstarState): Record<string, unknown> {
  return {
    refunds: state.refunds.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      amount: r.amount,
      ticketId: r.ticketId,
      approvalId: r.approvalId,
    })),
    approvals: state.approvals.map((a) => ({
      id: a.id,
      status: a.status,
      amount: a.requestedAmount,
    })),
    tickets: state.tickets.map((t) => ({ id: t.id, status: t.status })),
    auditEntries: state.audit.length,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
