/**
 * The CRM's data layer.
 *
 * It is the same `NorthstarEngine` the benchmark runs against — the demo app
 * and the agents genuinely share one implementation, so a workflow a human
 * records here is a workflow an agent can be tested on.
 *
 * State is kept in memory and mirrored into localStorage so a page reload does
 * not wipe a recording in progress.
 */
import { NorthstarEngine, type NorthstarState } from '@rigorrun/northstar';
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'northstar.demo.state.v1';

let engine = NorthstarEngine.fullWorld({ actor: 'agent.human' });
let snapshot: NorthstarState = engine.snapshot();
const listeners = new Set<() => void>();

function readStored(): NorthstarState | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NorthstarState) : null;
  } catch {
    // A private window or blocked storage is a normal condition, not an error.
    return null;
  }
}

function persist(state: NorthstarState): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — the demo still works, it just will not survive a reload */
  }
}

function publish(): void {
  snapshot = engine.snapshot();
  persist(snapshot);
  for (const listener of listeners) listener();
}

/** Restores a previous session's refunds and audit entries, if any. */
export function hydrate(): void {
  const stored = readStored();
  if (!stored) return;
  const fresh = NorthstarEngine.fullWorld({ actor: 'agent.human' });
  const base = fresh.snapshot();
  // Only replay what a human could have created; seed records come from code.
  for (const refund of stored.refunds.filter((r) => !base.refunds.some((b) => b.id === r.id))) {
    fresh.call('createRefund', {
      orderId: refund.orderId,
      customerId: refund.customerId,
      ticketId: refund.ticketId ?? undefined,
      amount: refund.amount,
      ...(refund.approvalId ? { approvalId: refund.approvalId } : {}),
    });
  }
  engine = fresh;
  publish();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getSnapshot(): NorthstarState {
  return snapshot;
}

export function useCrm(): NorthstarState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function resetDemo(): void {
  engine = NorthstarEngine.fullWorld({ actor: 'agent.human' });
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  publish();
}

/**
 * Semantic observation, for any recorder that is listening.
 *
 * This is the optional instrumentation hook: an application that emits these
 * gives RigorRun a much better contract than DOM events alone can. Nothing
 * breaks when no recorder is attached, and nothing sensitive is emitted.
 */
export function observe(name: string, data: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('rigorrun:observation', { detail: { name, data } }));
  try {
    window.postMessage({ source: 'rigorrun-app', name, data }, window.location.origin);
  } catch {
    /* ignore */
  }
}

export interface RefundInput {
  orderId: string;
  customerId: string;
  ticketId: string;
  amount: number;
  approvalId: string | null;
  reason: string;
}

export function issueRefund(
  input: RefundInput,
): { ok: true; id: string } | { ok: false; error: string } {
  const result = engine.call('createRefund', {
    orderId: input.orderId,
    customerId: input.customerId,
    ticketId: input.ticketId,
    amount: input.amount,
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
  });
  if (!result.ok) {
    publish();
    return { ok: false, error: result.error.message };
  }

  const refund = result.data as { id: string };
  engine.call('addAuditNote', {
    action: 'refund.issued',
    details: {
      refundId: refund.id,
      orderId: input.orderId,
      ticketId: input.ticketId,
      amount: input.amount,
      approvalId: input.approvalId,
      reason: input.reason,
    },
  });
  publish();

  observe('refund.created', {
    refundId: refund.id,
    orderId: input.orderId,
    customerId: input.customerId,
    ticketId: input.ticketId,
    amount: input.amount,
    approvalId: input.approvalId,
  });
  observe('audit.appended', {
    action: 'refund.issued',
    refundId: refund.id,
    orderId: input.orderId,
  });
  return { ok: true, id: refund.id };
}

export function requestApproval(input: {
  ticketId: string;
  orderId: string;
  amount: number;
  reason: string;
}): { ok: true; id: string; status: string } | { ok: false; error: string } {
  const result = engine.call('requestManagerApproval', input);
  publish();
  if (!result.ok) return { ok: false, error: result.error.message };
  const approval = result.data as { id: string; status: string };
  observe('approval.requested', {
    approvalId: approval.id,
    status: approval.status,
    orderId: input.orderId,
  });
  return { ok: true, id: approval.id, status: approval.status };
}

export function resolveTicket(ticketId: string): void {
  engine.call('resolveTicket', { ticketId });
  publish();
  observe('ticket.resolved', { ticketId });
}
