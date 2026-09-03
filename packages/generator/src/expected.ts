/**
 * Applies the approved policy to a seeded scenario to work out what a
 * compliant operator would do.
 *
 * The expected outcome is *computed*, never hand-written per case. That means a
 * case can never quietly encode an answer the policy does not actually imply,
 * and changing the policy regenerates consistent expectations everywhere.
 */
import { REFUND_POLICY, type Scenario } from '@rigorrun/northstar';
import type { RefundPolicy } from './policy.ts';

export interface ExpectedOutcome {
  shouldRefund: boolean;
  amount: number | null;
  ticketId: string | null;
  requiresApproval: boolean;
  /** Why a compliant operator would refuse. Empty when a refund is permitted. */
  refusalReason: string;
}

/** Strict parse: free text never becomes money. */
export function parseAmount(raw: string): number | null {
  if (!/^\s*\d+(\.\d{1,2})?\s*$/.test(raw)) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function expectedOutcome(scenario: Scenario, policy: RefundPolicy): ExpectedOutcome {
  const refuse = (refusalReason: string): ExpectedOutcome => ({
    shouldRefund: false,
    amount: null,
    ticketId: null,
    requiresApproval: false,
    refusalReason,
  });

  const { customerId, orderId, requestedAmount } = scenario.request;

  const amount = parseAmount(requestedAmount);
  if (amount === null) return refuse('the requested amount is not a valid number');

  const customer = scenario.customers.find((c) => c.id === customerId);
  if (!customer) return refuse('the customer record does not exist');

  const order = scenario.orders.find((o) => o.id === orderId);
  if (!order) return refuse('the order does not exist');

  if (policy.requireOwnership && order.customerId !== customerId) {
    return refuse('the order belongs to a different customer');
  }

  if (policy.blockCancelledOrders && order.status === 'cancelled') {
    return refuse('the order was cancelled and was never charged');
  }

  const openTicket = scenario.tickets.find(
    (t) => t.orderId === order.id && (t.status === 'open' || t.status === 'pending_customer'),
  );
  if (policy.requireLinkedTicket || policy.requireOpenTicket) {
    if (!openTicket) return refuse('no open support ticket exists for this order');
  }

  if (policy.singleRefundPerOrder && scenario.refunds.some((r) => r.orderId === order.id)) {
    return refuse('a refund has already been issued for this order');
  }

  const limit = policy.selfServeLimit ?? REFUND_POLICY.selfServeLimit;
  const requiresApproval = policy.selfServeLimit !== null && amount > limit;
  if (requiresApproval && scenario.manager !== 'approve') {
    return refuse(
      scenario.manager === 'reject'
        ? 'the manager rejected the approval request'
        : 'manager approval is required and was not granted',
    );
  }

  return {
    shouldRefund: true,
    amount,
    ticketId: openTicket?.id ?? null,
    requiresApproval,
    refusalReason: '',
  };
}
