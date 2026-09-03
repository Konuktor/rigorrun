import { Link } from '../router.tsx';
import { useCrm } from '../store.ts';
import { Card, Status } from '../ui.tsx';

export function CustomersPage() {
  const state = useCrm();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Customers</h1>
        <p className="text-[13px] text-ink-soft">{state.customers.length} accounts</p>
      </div>

      <Card>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-rule text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2 font-medium">Customer</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Tier</th>
              <th className="px-4 py-2 font-medium">Open tickets</th>
            </tr>
          </thead>
          <tbody>
            {state.customers.map((customer) => {
              const open = state.tickets.filter(
                (t) =>
                  t.customerId === customer.id &&
                  (t.status === 'open' || t.status === 'pending_customer'),
              ).length;
              return (
                <tr
                  key={customer.id}
                  className="border-b border-rule/70 last:border-0 hover:bg-canvas"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/customers/${customer.id}`}
                      testId={`customer-row-${customer.id}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {customer.name}
                    </Link>
                    <div className="font-mono text-[11px] text-ink-faint">{customer.id}</div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">{customer.email}</td>
                  <td className="px-4 py-2.5">
                    <Status value={customer.tier} />
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-soft">{open}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
