import {
  StateReadError,
  emptyState,
  setOwn,
  type CanonicalState,
  type EntityRow,
} from '@rigorrun/environment';
import type { HelpdeskClient } from './client.ts';
import { helpdeskSchema } from './schema.ts';
import type { HelpdeskState } from './twin/seed.ts';

export async function readHelpdeskState(client: HelpdeskClient): Promise<CanonicalState> {
  try {
    return canonicalState(await client.dump());
  } catch (error) {
    if (error instanceof StateReadError) throw error;
    throw new StateReadError('the complete Larch Helpdesk twin state', describe(error));
  }
}

export function canonicalState(world: HelpdeskState): CanonicalState {
  const state = emptyState(helpdeskSchema);
  putAll(state, 'Org', world.orgs);
  putAll(state, 'Customer', world.customers);
  putAll(state, 'Order', world.orders);
  putAll(
    state,
    'Ticket',
    world.tickets.map((ticket) => ({ ...ticket, notes: ticket.notes.join('\n') })),
  );
  putAll(state, 'Refund', world.refunds);
  putAll(state, 'Outbox', world.outbox);
  putAll(
    state,
    'AccessLog',
    world.access_log.map((entry) => ({
      id: `log_${entry.seq}`,
      org_id: entry.row_org_id,
      ...entry,
    })),
  );
  return state;
}

function putAll<T extends { id: string }>(
  state: CanonicalState,
  entity: string,
  rows: readonly T[],
): void {
  const table = state.entities[entity];
  if (!table) throw new Error(`The helpdesk schema has no ${entity} table.`);
  for (const row of rows) setOwn(table, row.id, { ...row } as EntityRow);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
