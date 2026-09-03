/** Shared presentational primitives for the dashboard. */
import type { ReactNode } from 'react';

export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box =
    size === 'lg'
      ? 'h-9 w-9 text-[14px]'
      : size === 'sm'
        ? 'h-6 w-6 text-[10px]'
        : 'h-7 w-7 text-[12px]';
  const text = size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-[13px]' : 'text-[15px]';
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`grid ${box} place-items-center rounded-lg border-[1.5px] border-fg font-mono font-bold tracking-tighter`}
      >
        RR
      </span>
      <span className={`${text} font-semibold tracking-tight`}>RigorRun</span>
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'pass' | 'fail' | 'warn' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'border-line text-muted',
  pass: 'border-pass/35 bg-pass/10 text-pass',
  fail: 'border-fail/35 bg-fail/10 text-fail',
  warn: 'border-warn/35 bg-warn/10 text-warn',
  accent: 'border-accent/35 bg-accent/10 text-accent',
};

export function Tag({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-[1px] text-[11px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * How a verdict was reached. Rendered distinctly on purpose: a deterministic
 * check and a model's opinion must never look alike.
 */
export function EvaluatorTag({ evaluator }: { evaluator: string }) {
  if (evaluator === 'deterministic') return <Tag tone="accent">DETERMINISTIC</Tag>;
  if (evaluator === 'model_judged') return <Tag tone="warn">MODEL-JUDGED</Tag>;
  return <Tag tone="neutral">HUMAN-REVIEW</Tag>;
}

export function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'pass' | 'fail' | 'neutral';
}) {
  const color = tone === 'pass' ? 'text-pass' : tone === 'fail' ? 'text-fail' : 'text-fg';
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.07em] text-muted">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold tabular-nums tracking-tight ${color}`}>
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-dim">{sub}</div> : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  testId,
  type = 'button',
  size = 'md',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  testId?: string;
  type?: 'button' | 'submit';
  size?: 'sm' | 'md';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
    'disabled:cursor-not-allowed disabled:opacity-40';
  const sizing = size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-2 text-[13px]';
  const variants = {
    primary: 'bg-fg text-canvas hover:bg-white',
    secondary: 'border border-line bg-panel-2 text-fg hover:border-dim',
    ghost: 'text-muted hover:text-fg',
    danger: 'border border-fail/40 bg-fail/10 text-fail hover:bg-fail/20',
  } as const;

  return (
    <button
      type={type}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${sizing} ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[12px] ${className}`}>{children}</span>;
}

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  return `${(ms * 1000).toFixed(0)}µs`;
}

export function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
