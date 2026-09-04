/** Small presentational primitives shared across the CRM pages. */
import type { ReactNode } from 'react';

export function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-rule bg-surface">
      {title ? (
        <header className="flex items-center justify-between border-b border-rule px-4 py-2.5">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/*
 * Darker foregrounds than the Tailwind defaults: `text-emerald-700` on
 * `bg-emerald-50` measures 1.08:1, which is unreadable. These pairings are
 * verified in scripts/check-contrast.mjs.
 */
const STATUS_STYLES: Record<string, string> = {
  open: 'bg-emerald-50 text-emerald-800 ring-emerald-700/25',
  pending_customer: 'bg-amber-50 text-amber-900 ring-amber-700/25',
  resolved: 'bg-slate-100 text-slate-700 ring-slate-500/25',
  closed: 'bg-slate-100 text-slate-700 ring-slate-500/25',
  delivered: 'bg-emerald-50 text-emerald-800 ring-emerald-700/25',
  shipped: 'bg-sky-50 text-sky-900 ring-sky-700/25',
  processing: 'bg-amber-50 text-amber-900 ring-amber-700/25',
  cancelled: 'bg-rose-50 text-rose-800 ring-rose-700/25',
  approved: 'bg-emerald-50 text-emerald-800 ring-emerald-700/25',
  rejected: 'bg-rose-50 text-rose-800 ring-rose-700/25',
  pending: 'bg-amber-50 text-amber-900 ring-amber-700/25',
  standard: 'bg-slate-100 text-slate-700 ring-slate-500/25',
  plus: 'bg-sky-50 text-sky-900 ring-sky-700/25',
  enterprise: 'bg-indigo-50 text-indigo-900 ring-indigo-700/25',
};

export function Status({ value }: { value: string }) {
  const style = STATUS_STYLES[value] ?? 'bg-slate-100 text-slate-600 ring-slate-500/20';
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style}`}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-[13px] text-ink-faint">{children}</p>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12px]">{children}</span>;
}
