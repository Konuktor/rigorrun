/**
 * Accessible dialog, used for both the evidence drawer and the publish modal.
 *
 * The audit found the previous drawer had no dialog role, no accessible name,
 * no focus management, no scroll lock and no Escape handling — so a keyboard or
 * screen-reader user could not reach the screen that carries the product's
 * whole argument. This component is the single place that behaviour lives.
 */
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './primitives.tsx';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Rendered under the title, e.g. an identifier. */
  subtitle?: ReactNode;
  /** Shown at the top right, before the close control. */
  badge?: ReactNode;
  children: ReactNode;
  /** `drawer` slides in from the right; `modal` is centred. */
  variant?: 'drawer' | 'modal';
  footer?: ReactNode;
  testId?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  variant = 'drawer',
  footer,
  testId,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Focus moves in on open and returns to the opener on close, so a keyboard
  // user never loses their place in the page behind.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // The page behind must not scroll while a dialog is over it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Trap: Tab cycles within the dialog in both directions.
      const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  const panelClass =
    variant === 'drawer'
      ? 'rr-slide-in ml-auto h-full w-full max-w-2xl border-l border-line bg-canvas shadow-overlay'
      : 'rr-enter m-auto max-h-full w-full max-w-2xl rounded-panel border border-line bg-canvas shadow-overlay';

  return (
    <div
      className={`fixed inset-0 flex bg-black/65 ${variant === 'modal' ? 'p-4 sm:p-6' : ''}`}
      style={{ zIndex: 'var(--z-scrim)' }}
      onMouseDown={(event) => {
        // Only a click on the scrim itself dismisses, not a drag out of the panel.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={onKeyDown}
        style={{ zIndex: 'var(--z-dialog)' }}
        className={`flex flex-col overflow-hidden outline-none ${panelClass}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-canvas px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-section font-semibold">
              {title}
            </h2>
            {subtitle ? (
              <div className="mt-0.5 min-w-0 text-meta text-muted">{subtitle}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {badge}
            <Button variant="ghost" size="sm" onClick={onClose} testId="close-evidence">
              Close
            </Button>
          </div>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
          tabIndex={0}
          role="region"
          aria-label={`${title} details, scrollable`}
        >
          {children}
        </div>

        {footer ? (
          <footer className="shrink-0 border-t border-line px-4 py-3 sm:px-5">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
