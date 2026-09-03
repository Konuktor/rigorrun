import { useEffect } from 'react';
import { Link } from '../router.tsx';
import { observe, resolveTicket, useCrm } from '../store.ts';
import { Card, Empty, Field, Status } from '../ui.tsx';

export function TicketPage({ ticketId }: { ticketId: string }) {
  const state = useCrm();
  const ticket = state.tickets.find((t) => t.id === ticketId);

  useEffect(() => {
    if (ticket) {
      observe('ticket.viewed', {
        ticketId: ticket.id,
        status: ticket.status,
        orderId: ticket.orderId,
        customerId: ticket.customerId,
      });
    }
  }, [ticket]);

  useEffect(() => {
    document.title = ticket ? `${ticket.id} · Northstar Support` : 'Northstar Support';
  }, [ticket]);

  if (!ticket) return <Empty>No ticket with id {ticketId}.</Empty>;

  const customer = state.customers.find((c) => c.id === ticket.customerId);
  const order = state.orders.find((o) => o.id === ticket.orderId);
  const notes = state.notes.filter((n) => n.ticketId === ticket.id);
  const isOpen = ticket.status === 'open' || ticket.status === 'pending_customer';

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{ticket.subject}</h1>
          <p className="font-mono text-[12px] text-ink-faint">{ticket.id}</p>
        </div>
        <button
          type="button"
          data-testid="resolve-ticket"
          disabled={!isOpen}
          onClick={() => resolveTicket(ticket.id)}
          className="rounded-md border border-rule bg-surface px-3 py-1.5 text-[13px] font-medium text-ink
                     hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
        >
          Resolve ticket
        </button>
      </div>

      <Card title="Ticket">
        <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Field label="Status">
            <Status value={ticket.status} />
          </Field>
          <Field label="Customer">
            {customer ? (
              <Link to={`/customers/${customer.id}`} className="text-brand hover:underline">
                {customer.name}
              </Link>
            ) : (
              <span className="text-ink-faint">unknown</span>
            )}
          </Field>
          <Field label="Order">
            {order ? (
              <Link
                to={`/orders/${order.id}`}
                testId={`order-link-${order.id}`}
                className="font-mono text-brand hover:underline"
              >
                {order.id}
              </Link>
            ) : (
              <span className="text-ink-faint">none linked</span>
            )}
          </Field>
          <Field label="Opened">{ticket.openedAt.slice(0, 10)}</Field>
        </dl>
      </Card>

      <Card title="Conversation">
        {notes.length === 0 ? (
          <Empty>No notes on this ticket.</Empty>
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
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-soft">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
