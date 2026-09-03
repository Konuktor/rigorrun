import { useCrm } from '../store.ts';
import { Card, Empty, Mono, money } from '../ui.tsx';

export function AuditPage() {
  const state = useCrm();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Audit log</h1>
        <p className="text-[13px] text-ink-soft">
          Every refund must leave an audit entry. This is what RigorRun checks, rather than what an
          operator says they did.
        </p>
      </div>

      <Card title="Refunds">
        {state.refunds.length === 0 ? (
          <Empty>No refunds have been issued yet.</Empty>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-rule text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2 font-medium">Refund</th>
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Ticket</th>
                <th className="px-4 py-2 font-medium">Approval</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {state.refunds.map((refund) => (
                <tr key={refund.id} className="border-b border-rule/70 last:border-0">
                  <td className="px-4 py-2">
                    <Mono>{refund.id}</Mono>
                  </td>
                  <td className="px-4 py-2">
                    <Mono>{refund.orderId}</Mono>
                  </td>
                  <td className="px-4 py-2">
                    <Mono>{refund.ticketId ?? '—'}</Mono>
                  </td>
                  <td className="px-4 py-2">
                    <Mono>{refund.approvalId ?? '—'}</Mono>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(refund.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Audit entries">
        {state.audit.length === 0 ? (
          <Empty>No audit entries yet.</Empty>
        ) : (
          <ul className="divide-y divide-rule/70">
            {state.audit.map((entry) => (
              <li key={entry.id} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between">
                  <Mono>{entry.action}</Mono>
                  <span className="font-mono text-[11px] text-ink-faint">{entry.at}</span>
                </div>
                <pre className="mt-1 overflow-x-auto rounded bg-canvas px-2 py-1 font-mono text-[11px] text-ink-soft">
                  {JSON.stringify(entry.details, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
