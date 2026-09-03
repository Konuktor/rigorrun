import { Link } from '../router.tsx';
import { useCrm } from '../store.ts';
import { Card, Status, money } from '../ui.tsx';
import { POLICY_BANNER } from './Order.tsx';

export function OverviewPage() {
  const state = useCrm();
  const openTickets = state.tickets.filter(
    (t) => t.status === 'open' || t.status === 'pending_customer',
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Support queue</h1>
        <p className="text-[13px] text-ink-soft">
          {openTickets.length} open tickets across {state.customers.length} customers
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open tickets" value={String(openTickets.length)} />
        <Stat label="Orders" value={String(state.orders.length)} />
        <Stat label="Refunds issued" value={String(state.refunds.length)} />
        <Stat label="Refunded" value={money(state.refunds.reduce((sum, r) => sum + r.amount, 0))} />
      </div>

      <p className="rounded-md bg-brand-soft px-3 py-2 text-[12.5px] text-blue-900">
        {POLICY_BANNER}
      </p>

      <Card title="Open tickets">
        <ul>
          {openTickets.map((ticket) => {
            const customer = state.customers.find((c) => c.id === ticket.customerId);
            return (
              <li key={ticket.id} className="border-b border-rule/70 last:border-0">
                <Link
                  to={`/tickets/${ticket.id}`}
                  testId={`ticket-row-${ticket.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-canvas"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{ticket.subject}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-faint">{ticket.id}</span>
                    <div className="text-[12px] text-ink-soft">
                      {customer?.name ?? ticket.customerId}
                    </div>
                  </span>
                  <Status value={ticket.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-rule bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}
