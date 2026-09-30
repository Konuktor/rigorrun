/**
 * What to tell a person whose nominated read answered with one page of a
 * longer list, at the moment they nominate it.
 *
 * RigorRun reads which records exist from these reads. A record outside the
 * page is not absent, so checks on that kind of record will say "not checked"
 * rather than guess — which is correct, and which nobody wants to discover
 * from a run of abstentions after doing the whole job. Said here instead.
 */
import { IdentityConflictError, stateFromPayloads, type ReadCall } from '@rigorrun/connector';
import type { EnvironmentSchema } from '@rigorrun/environment';

export function pagedReadAdvice(
  payloads: readonly unknown[],
  calls: readonly ReadCall[],
  schema: EnvironmentSchema,
): string {
  let windowed: Record<string, string> | undefined;
  try {
    windowed = stateFromPayloads(payloads, schema, calls).windowed;
  } catch (error) {
    // Two records under one identity is its own problem, reported where the
    // world is read; it says nothing about pages.
    if (error instanceof IdentityConflictError) return '';
    throw error;
  }
  if (!windowed) return '';
  const kinds = Object.keys(windowed).sort();
  const why = [...new Set(Object.values(windowed))].join('; ');
  return (
    `${why}. RigorRun reads which ${kinds.join(' and ')} records exist from these reads, so records ` +
    'outside that page are invisible to it, and checks on them will say "not checked" rather than guess. ' +
    'Nominate a read that returns every record of that kind — a higher limit, or a filter that returns ' +
    'only what a case touches.'
  );
}
