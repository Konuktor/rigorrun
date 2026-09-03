import { useEffect, useState } from 'react';
import { REFUND_POLICY } from '@rigorrun/northstar';
import { Link } from '../router.tsx';
import { issueRefund, observe, requestApproval, useCrm } from '../store.ts';
import { Card, Empty, Field, Mono, Status, money } from '../ui.tsx';

/** The exact sentence the recorder captures and the compiler later reads. */
export const POLICY_BANNER =
  `Refunds of $${REFUND_POLICY.selfServeLimit} or less can be issued without approval. ` +
  `Above $${REFUND_POLICY.selfServeLimit} a manager approval is required.`;

export function OrderPage({ orderId }: { orderId: string }) {
  const state = useCrm();
  const order = state.orders.find((o) => o.id === orderId);

  const [formOpen, setFormOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (order) {
      observe('order.viewed', {
        orderId: order.id,
        customerId: order.customerId,
        total: order.total,
        status: order.status,
      });
    }
  }, [order]);

  useEffect(() => {
    document.title = order ? `${order.id} · Northstar Support` : 'Northstar Support';
  }, [order]);

  if (!order) return <Empty>No order with id {orderId}.</Empty>;

  const customer = state.customers.find((c) => c.id === order.customerId);
  const ticket = state.tickets.find(
    (t) => t.orderId === order.id && (t.status === 'open' || t.status === 'pending_customer'),
  );
  const refunds = state.refunds.filter((r) => r.orderId === order.id);
  const parsed = /^\s*\d+(\.\d{1,2})?\s*$/.test(amount) ? Number(amount) : null;
  const needsApproval = parsed !== null && parsed > REFUND_POLICY.selfServeLimit;
  const approval = approvalId ? state.approvals.find((a) => a.id === approvalId) : undefined;
  const canSubmit =
    parsed !== null && ticket !== undefined && (!needsApproval || approval?.status === 'approved');

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          {order.items.map((i) => i.title).join(', ')}
        </h1>
        <p className="font-mono text-[12px] text-ink-faint">{order.id}</p>
      </div>

      <Card title="Order">
        <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Field label="Customer">
            {customer ? (
              <Link to={`/customers/${customer.id}`} className="text-brand hover:underline">
                {customer.name}
              </Link>
            ) : (
              <span className="text-ink-faint">unknown</span>
            )}
          </Field>
          <Field label="Status">
            <Status value={order.status} />
          </Field>
          <Field label="Total">
            <span className="tabular-nums">{money(order.total)}</span>
          </Field>
          <Field label="Placed">{order.placedAt.slice(0, 10)}</Field>
        </dl>
        <table className="w-full border-t border-rule text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">SKU</th>
              <th className="px-4 py-2 text-right font-medium">Qty</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.sku} className="border-t border-rule/70">
                <td className="px-4 py-2">{item.title}</td>
                <td className="px-4 py-2">
                  <Mono>{item.sku}</Mono>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{item.quantity}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(item.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Refunds"
        action={
          !formOpen ? (
            <button
              type="button"
              data-testid="open-refund-form"
              onClick={() => setFormOpen(true)}
              className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:bg-blue-800"
            >
              Issue refund
            </button>
          ) : null
        }
      >
        {refunds.length > 0 ? (
          <ul className="divide-y divide-rule/70 border-b border-rule">
            {refunds.map((refund) => (
              <li key={refund.id} className="flex items-center justify-between px-4 py-2.5">
                <span>
                  <Mono>{refund.id}</Mono>
                  <span className="ml-3 text-ink-soft">
                    ticket {refund.ticketId ?? 'none'} ·{' '}
                    {refund.approvalId ? `approval ${refund.approvalId}` : 'no approval'}
                  </span>
                </span>
                <span className="tabular-nums font-medium">{money(refund.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="px-4 py-3">
          {/* The policy line the recorder captures as nearby text. */}
          <p
            data-testid="refund-policy"
            className="rounded-md bg-brand-soft px-3 py-2 text-[12.5px] text-blue-900"
          >
            {POLICY_BANNER}
          </p>
        </div>

        {formOpen ? (
          <form
            data-testid="refund-form"
            aria-label="Issue refund"
            className="space-y-3 border-t border-rule px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!ticket || parsed === null) return;
              const result = issueRefund({
                orderId: order.id,
                customerId: order.customerId,
                ticketId: ticket.id,
                amount: parsed,
                approvalId,
                reason,
              });
              if (result.ok) {
                setMessage({
                  kind: 'ok',
                  text: `Refund ${result.id} issued for ${money(parsed)}.`,
                });
                setFormOpen(false);
                setAmount('');
                setReason('');
                setApprovalId(null);
              } else {
                setMessage({ kind: 'error', text: result.error });
              }
            }}
          >
            {!ticket ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                No open support ticket exists for this order, so a refund cannot be linked to one.
              </p>
            ) : (
              <p className="text-[12.5px] text-ink-soft">
                Will be linked to ticket{' '}
                <Link to={`/tickets/${ticket.id}`} className="font-mono text-brand hover:underline">
                  {ticket.id}
                </Link>
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink">Refund amount</span>
                <input
                  data-testid="refund-amount"
                  name="refundAmount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setApprovalId(null);
                  }}
                  placeholder="0.00"
                  className="w-full rounded-md border border-rule bg-surface px-3 py-1.5 text-[13px] tabular-nums"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink">Reason</span>
                <textarea
                  data-testid="refund-reason"
                  name="refundReason"
                  rows={1}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is this refund being issued?"
                  className="w-full rounded-md border border-rule bg-surface px-3 py-1.5 text-[13px]"
                />
              </label>
            </div>

            {needsApproval ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-[12.5px] text-amber-900">
                  {money(parsed)} is above the {money(REFUND_POLICY.selfServeLimit)} self-serve
                  limit. A manager approval is required.
                </p>
                {approval ? (
                  <p className="mt-1.5 text-[12.5px]">
                    Approval <Mono>{approval.id}</Mono> is <Status value={approval.status} />
                  </p>
                ) : (
                  <button
                    type="button"
                    data-testid="request-approval"
                    disabled={!ticket}
                    onClick={() => {
                      if (!ticket || parsed === null) return;
                      const result = requestApproval({
                        ticketId: ticket.id,
                        orderId: order.id,
                        amount: parsed,
                        reason,
                      });
                      if (result.ok) setApprovalId(result.id);
                      else setMessage({ kind: 'error', text: result.error });
                    }}
                    className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-[13px]
                               font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                  >
                    Request manager approval
                  </button>
                )}
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                data-testid="submit-refund"
                disabled={!canSubmit}
                className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-medium text-white
                           hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Issue refund
              </button>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-md border border-rule px-3 py-1.5 text-[13px] text-ink hover:bg-canvas"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {message ? (
          <p
            data-testid="refund-message"
            className={`border-t border-rule px-4 py-2.5 text-[12.5px] ${
              message.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
