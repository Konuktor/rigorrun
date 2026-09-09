/**
 * Presentational primitives.
 *
 * Every component here consumes semantic tokens (`text-muted`, `border-line`)
 * rather than raw colours or ad-hoc pixel sizes, so the type scale and palette
 * are decided once in styles.css instead of being re-decided per screen.
 */
import type { ReactNode } from 'react';

/**
 * The mark, and the same one the site and the docs use.
 *
 * It used to be the letters "RR" in the system monospace font inside a 1.5px
 * rounded square, re-created here in CSS while `index.html` carried a second
 * copy as a data URI — and the two had already drifted, `#e7eaee` against a
 * token of `#e9ecf1`. This is the source in `packages/design/logo/mark.svg`,
 * inlined so it takes `currentColor` and needs no request.
 *
 * The shape is a double turnstile with unequal arms. `A ⊢ B` is "derivable
 * from what was written down"; `A ⊨ B` is "true in the thing itself". An
 * agent's transcript is the first and RigorRun reports the second, and the
 * arms are unequal because "19 of 37, with the rest itemised" is the other
 * half of the idea.
 */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const text = size === 'lg' ? 'text-title' : size === 'sm' ? 'text-support' : 'text-section';
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`${box} shrink-0 text-accent`}>
        <path d="M5.5 4.25V19.75" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M5.5 9H12.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M5.5 15H19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
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
  as: Tag = 'section',
  labelledBy,
}: {
  title?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  as?: 'section' | 'div';
  labelledBy?: string;
}) {
  return (
    <Tag
      className={`rounded-panel border border-line bg-surface ${className}`}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
    >
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id={labelledBy} className="text-section font-semibold">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-meta text-muted">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}

export type Tone = 'neutral' | 'pass' | 'fail' | 'warn' | 'info';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-line text-muted',
  pass: 'border-pass-line bg-pass-bg text-pass',
  fail: 'border-fail-line bg-fail-bg text-fail',
  warn: 'border-warn-line bg-warn-bg text-warn',
  info: 'border-info-line bg-info-bg text-info',
};

export function Tag({
  tone = 'neutral',
  children,
  mono,
}: {
  tone?: Tone;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-pill border px-2 py-px text-meta font-medium ${
        mono ? 'font-mono' : ''
      } ${TONE_CLASS[tone]}`}
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
  if (evaluator === 'deterministic') return <Tag tone="info">Deterministic</Tag>;
  if (evaluator === 'model_judged') return <Tag tone="warn">Model-judged</Tag>;
  return <Tag tone="neutral">Human review</Tag>;
}

/**
 * Pass / fail / unsafe, carried by shape and text as well as colour so the
 * distinction survives a colour-blind reader and a greyscale print.
 */
export function StatusMark({
  status,
  size = 'md',
}: {
  status: 'pass' | 'fail' | 'unsafe';
  size?: 'sm' | 'md';
}) {
  const box = size === 'sm' ? 'h-5 w-5 text-[11px]' : 'h-6 w-6 text-meta';
  const style =
    status === 'pass'
      ? 'bg-pass-bg text-pass'
      : status === 'unsafe'
        ? 'bg-fail-bg text-fail ring-1 ring-fail-line'
        : 'bg-fail-bg text-fail';
  const glyph = status === 'pass' ? '✓' : status === 'unsafe' ? '!' : '✕';
  return (
    <span
      className={`grid ${box} shrink-0 place-items-center rounded-[6px] font-bold ${style}`}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

export const STATUS_LABEL: Record<'pass' | 'fail' | 'unsafe', string> = {
  pass: 'passed',
  fail: 'failed',
  unsafe: 'unsafe action taken',
};

export function Metric({
  label,
  value,
  sub,
  tone,
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'pass' | 'fail' | 'neutral';
  size?: 'md' | 'lg';
}) {
  const color = tone === 'pass' ? 'text-pass' : tone === 'fail' ? 'text-fail' : 'text-fg';
  return (
    <div>
      <div className="text-micro font-medium uppercase text-muted">{label}</div>
      <div
        data-numeric
        className={`mt-1 font-semibold ${size === 'lg' ? 'text-metric' : 'text-metric-sm'} ${color}`}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-meta text-muted">{sub}</div> : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  busy,
  testId,
  type = 'button',
  size = 'md',
  ariaLabel,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  testId?: string;
  type?: 'button' | 'submit';
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
  className?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-control font-medium ' +
    'transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  // The 13px step is `text-support`, not `text-secondary`. It used to be the
  // latter, which collided with `--color-secondary`: Tailwind generated a
  // `text-secondary` utility for each and the colour won, so every
  // default-size primary button rendered #b4bdcb on #e9ecf1 — 1.6:1, well
  // under the 4.5:1 this project gates on. Renaming the size removed the
  // ambiguity rather than working around it.
  const sizing =
    size === 'sm'
      ? 'h-8 px-2.5 text-meta'
      : size === 'lg'
        ? 'h-10 px-4 text-body'
        : 'h-9 px-3.5 text-support';
  const variants = {
    primary: 'bg-accent text-accent-fg hover:brightness-110',
    secondary: 'border border-line bg-raised text-fg hover:border-line-strong',
    ghost: 'text-muted hover:bg-raised hover:text-fg',
    danger: 'border border-fail-line bg-fail-bg text-fail hover:brightness-125',
  } as const;

  return (
    <button
      type={type}
      data-testid={testId}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`${base} ${sizing} ${variants[variant]} ${className}`}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${className}`}
    />
  );
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-meta ${className}`}>{children}</span>;
}

/** A long identifier, truncated with the full value available on hover. */
export function Truncated({ value, className = '' }: { value: string; className?: string }) {
  return (
    <span title={value} className={`block truncate font-mono text-meta ${className}`}>
      {value}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-micro font-semibold uppercase text-muted">{children}</h2>;
}

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  return `${(ms * 1000).toFixed(0)}µs`;
}

export function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Percentages that land on a whole number read better without the decimal. */
export function pctCompact(value: number): string {
  const scaled = value * 100;
  return Number.isInteger(scaled) ? `${scaled}%` : `${scaled.toFixed(1)}%`;
}
