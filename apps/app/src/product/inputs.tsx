/**
 * The form controls this product needed and did not have.
 *
 * There were previously zero `<input>` elements in the entire application,
 * which was the clearest single sign that nothing here could be pointed at
 * anybody's own system: there was nowhere to type a URL.
 *
 * Every field is labelled rather than placeholder-only. A placeholder
 * disappears the moment somebody starts typing, which is exactly when they
 * most need to know what the box was for, and it is invisible to a screen
 * reader in most implementations. Where a field needs explaining, the hint sits
 * under it and is wired to the input with `aria-describedby` so it is read out
 * rather than merely seen.
 */
import type { ReactNode } from 'react';
import { useId } from 'react';

const CONTROL =
  'w-full rounded-control border border-line bg-inset px-3 py-2 text-body text-fg ' +
  'placeholder:text-disabled focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-accent/70 focus-visible:border-line-strong disabled:opacity-60';

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: ReactNode;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
  error?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-meta font-medium text-secondary">
        {label}
      </label>
      {children({ id, describedBy })}
      {hint ? (
        <p id={hintId} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-meta text-fail" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  id,
  describedBy,
  placeholder,
  type = 'text',
  testId,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  describedBy?: string | undefined;
  placeholder?: string;
  type?: 'text' | 'number';
  testId?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      className={CONTROL}
      value={value}
      placeholder={placeholder}
      aria-describedby={describedBy}
      data-testid={testId}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  id,
  describedBy,
  rows = 3,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  describedBy?: string | undefined;
  rows?: number;
  testId?: string;
}) {
  return (
    <textarea
      id={id}
      rows={rows}
      className={`${CONTROL} font-mono text-secondary`}
      value={value}
      aria-describedby={describedBy}
      data-testid={testId}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  id,
  describedBy,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  id?: string;
  describedBy?: string | undefined;
  testId?: string;
}) {
  return (
    <select
      id={id}
      className={CONTROL}
      value={value}
      aria-describedby={describedBy}
      data-testid={testId}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <label htmlFor={id} className="text-body text-fg">
        {label}
        {hint ? <span className="mt-0.5 block text-meta text-muted">{hint}</span> : null}
      </label>
    </div>
  );
}

/**
 * A problem, shown where it happened.
 *
 * Never a toast. Something that failed while a person was doing a thing has to
 * stay on screen next to that thing until they have dealt with it, and it
 * should say what to do rather than what went wrong.
 */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-panel border border-fail-line bg-fail-bg px-3 py-2.5 text-body text-fg"
    >
      {children}
    </div>
  );
}
