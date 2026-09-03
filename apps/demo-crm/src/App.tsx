import { useEffect } from 'react';
import { Link, matchPath, usePath } from './router.tsx';
import { hydrate, resetDemo } from './store.ts';
import { OverviewPage } from './pages/Overview.tsx';
import { CustomersPage } from './pages/Customers.tsx';
import { CustomerPage } from './pages/Customer.tsx';
import { TicketPage } from './pages/Ticket.tsx';
import { OrderPage } from './pages/Order.tsx';
import { AuditPage } from './pages/Audit.tsx';

const NAV = [
  { to: '/', label: 'Queue', testId: 'nav-queue' },
  { to: '/customers', label: 'Customers', testId: 'nav-customers' },
  { to: '/audit', label: 'Audit log', testId: 'nav-audit' },
];

export function App() {
  const path = usePath();

  useEffect(() => {
    hydrate();
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <div className="bg-amber-100 px-4 py-1.5 text-center text-[12px] text-amber-900">
        Demo environment — every customer, order and refund below is synthetic.
      </div>

      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2" testId="nav-home">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-brand text-[12px] font-bold text-white">
              N
            </span>
            <span className="text-[14px] font-semibold tracking-tight">Northstar Support</span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = item.to === '/' ? path === '/' : path.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  testId={item.testId}
                  className={`rounded-md px-2.5 py-1 text-[13px] ${
                    active
                      ? 'bg-brand-soft font-medium text-brand'
                      : 'text-ink-soft hover:bg-canvas'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            data-testid="reset-demo"
            onClick={resetDemo}
            className="rounded-md border border-rule px-2.5 py-1 text-[12px] text-ink-soft hover:bg-canvas"
          >
            Reset demo data
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 py-6">
        <Route path={path} />
      </main>

      <footer className="border-t border-rule bg-surface px-4 py-3 text-center text-[12px] text-ink-faint">
        Northstar Support is a synthetic application built for the RigorRun demo. It is not a real
        product and holds no real data.
      </footer>
    </div>
  );
}

function Route({ path }: { path: string }) {
  const customer = matchPath('/customers/:id', path);
  if (customer) return <CustomerPage customerId={customer['id']!} />;

  const ticket = matchPath('/tickets/:id', path);
  if (ticket) return <TicketPage ticketId={ticket['id']!} />;

  const order = matchPath('/orders/:id', path);
  if (order) return <OrderPage orderId={order['id']!} />;

  if (matchPath('/customers', path)) return <CustomersPage />;
  if (matchPath('/audit', path)) return <AuditPage />;
  if (matchPath('/', path)) return <OverviewPage />;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-1 text-[13px] text-ink-soft">
        Nothing is routed at <code className="font-mono">{path}</code>.
      </p>
      <Link to="/" className="mt-3 inline-block text-brand hover:underline">
        Back to the queue
      </Link>
    </div>
  );
}
