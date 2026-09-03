/**
 * A ~40-line router.
 *
 * Real paths (not hash fragments) so recorded navigation events look like a
 * real application's, which is what the recorder and the compiler expect.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onChange);
    window.addEventListener('rigorrun:navigate', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('rigorrun:navigate', onChange);
    };
  }, []);

  return path;
}

export function navigate(to: string): void {
  if (window.location.pathname === to) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event('rigorrun:navigate'));
}

export function useNavigate(): (to: string) => void {
  return useCallback((to: string) => navigate(to), []);
}

/** Matches `/customers/:id` style patterns and returns the captured segments. */
export function useMatch(pattern: string): Record<string, string> | null {
  const path = usePath();
  return useMemo(() => matchPath(pattern, path), [pattern, path]);
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i]!;
    const actual = pathParts[i]!;
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

export interface LinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  testId?: string;
  title?: string;
}

export function Link({ to, children, className, testId, title }: LinkProps) {
  return (
    <a
      href={to}
      className={className}
      data-testid={testId}
      title={title}
      onClick={(event) => {
        // Let modified clicks open a new tab the way any link would.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
