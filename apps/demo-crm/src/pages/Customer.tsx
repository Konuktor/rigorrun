import { useEffect } from 'react';
import { Link } from '../router.tsx';
import { observe, useCrm } from '../store.ts';
import { Card, Empty, Field, Status, money } from '../ui.tsx';

export function CustomerPage({ customerId }: { customerId: string }) {
  const state = useCrm();
  const customer = state.customers.find((c) => c.id === customerId);

  useEffect(() => {
    if (customer) observe('customer.viewed', { customerId: customer.id, tier: customer.tier });
  }, [customer]);

  useEffect(() => {
    document.title = customer ? `${customer.name} · Northstar Support` : 'Northstar Support';
  }, [customer]);

  if (!customer) {
    return <Empty>No customer with id {customerId}.</Empty>;
  }

  const tickets = state.tickets.filter((t) => t.customerId === customerId);
  const orders = state.orders.filter((o) => o.customerId === customerId);
  const notes = state.notes.filter((n) => n.customerId === customerId);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{customer.name}</h1>
        <p className="font-mono text-[12px] text-ink-faint">{customer.id}</p>
      </div>

      <Card title="Account">
        <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Field label="Email">{customer.email}</Field>
          <Field label="Tier">
            <Status value={customer.tier} />
          </Field>
          <Field label="Customer since">{customer.since.slice(0, 10)}</Field>
          <Field label="Orders">{orders.length}</Field>
        </dl>
      </Card>

      <Card title="Support tickets">
        {tickets.length === 0 ? (
          <Empty>No tickets for this customer.</Empty>
        ) : (
          <ul>
            {tickets.map((ticket) => (
              <li key={ticket.id} className="border-b border-rule/70 last:border-0">
                <Link
                  to={`/tickets/${ticket.id}`}
                  testId={`ticket-row-${ticket.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-canvas"
                >
                  <span>
                    <span className="font-medium text-ink">{ticket.subject}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-faint">
                      {ticket.id}
                      {ticket.orderId ? ` · order ${ticket.orderId}` : ''}
                    </span>
                  </span>
                  <Status value={ticket.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Orders">
        {orders.length === 0 ? (
          <Empty>No orders for this customer.</Empty>
        ) : (
          <ul>
            {orders.map((order) => (
              <li key={order.id} className="border-b border-rule/70 last:border-0">
                <Link
                  to={`/orders/${order.id}`}
                  testId={`order-link-${order.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-canvas"
                >
                  <span>
                    <span className="font-medium text-ink">
                      {order.items.map((i) => i.title).join(', ')}
                    </span>
                    <span className="ml-2 font-mono text-[11px] text-ink-faint">{order.id}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums text-ink-soft">{money(order.total)}</span>
                    <Status value={order.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Notes">
        {notes.length === 0 ? (
          <Empty>No notes.</Empty>
        ) : (
          <ul className="divide-y divide-rule/70">
            {notes.map((note) => (
              <li key={note.id} className="px-4 py-3" data-testid={`note-${note.id}`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-medium text-ink">{note.author}</span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {note.createdAt.slice(0, 10)}
                  </span>
                </div>
                {/* Customer-authored content, rendered as plain text. */}
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-soft">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
