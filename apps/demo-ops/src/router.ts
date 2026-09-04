/**
 * Hash routing over `#/<environment>/<entity>/<id>`.
 *
 * Deliberately tiny. The app has three shapes of page and no need for a
 * router library, and a deep link has to survive a reload because the
 * recorder and the browser lane both use them.
 */
import { useEffect, useState } from 'react';

export interface Route {
  environmentId: string | null;
  entity: string | null;
  recordId: string | null;
}

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return {
    environmentId: parts[0] ?? null,
    entity: parts[1] ?? null,
    recordId: parts[2] ?? null,
  };
}

export function hrefFor(environmentId: string, entity?: string, recordId?: string): string {
  const parts = [environmentId, entity, recordId]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .map((part) => encodeURIComponent(part));
  return `#/${parts.join('/')}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
