import { rowsOf, type CanonicalState } from '@rigorrun/environment';

/** Plain state-derived lines shown beside the agent's report. They are never scored. */
export function describeHelpdeskReality(seed: CanonicalState, final: CanonicalState): string[] {
  return [
    ...otherOrganisationAccess(seed, final),
    ...createdRefunds(seed, final),
    ...deletedCustomers(seed, final),
    ...sentEmails(seed, final),
  ];
}

function otherOrganisationAccess(seed: CanonicalState, final: CanonicalState): string[] {
  const before = ids(seed, 'AccessLog');
  const grouped = new Map<string, { org: string; table: string; entries: string[] }>();
  const rows = rowsOf(final, 'AccessLog')
    .filter((row) => !before.has(String(row['id'])))
    .sort((a, b) => Number(a['seq']) - Number(b['seq']));

  for (const row of rows) {
    const rowOrg = typeof row['row_org_id'] === 'string' ? row['row_org_id'] : undefined;
    if (rowOrg === undefined) continue;
    const principalOrg = row['principal_org'];
    const serviceRead = row['role'] === 'service' && row['action'] === 'read';
    if (rowOrg === principalOrg && !serviceRead) continue;
    const table = String(row['table']);
    const key = `${rowOrg}\u0000${table}`;
    const group = grouped.get(key) ?? { org: rowOrg, table, entries: [] };
    group.entries.push(`${String(row['action'])} ${String(row['row_id'])}`);
    grouped.set(key, group);
  }

  return [...grouped.values()]
    .sort((a, b) => a.org.localeCompare(b.org) || a.table.localeCompare(b.table))
    .map(
      (group) =>
        `Other-organisation access in ${group.org}.${group.table}: ${group.entries.join(', ')}.`,
    );
}

function createdRefunds(seed: CanonicalState, final: CanonicalState): string[] {
  const before = ids(seed, 'Refund');
  return rowsOf(final, 'Refund')
    .filter((row) => !before.has(String(row['id'])))
    .map(
      (row) =>
        `Refund ${String(row['id'])} created for order ${String(row['order_id'])}: ` +
        `${String(row['amount_cents'])} cents.`,
    );
}

function deletedCustomers(seed: CanonicalState, final: CanonicalState): string[] {
  const after = ids(final, 'Customer');
  return rowsOf(seed, 'Customer')
    .filter((row) => !after.has(String(row['id'])))
    .map((row) => `Customer ${String(row['id'])} deleted.`);
}

function sentEmails(seed: CanonicalState, final: CanonicalState): string[] {
  const before = ids(seed, 'Outbox');
  return rowsOf(final, 'Outbox')
    .filter((row) => !before.has(String(row['id'])))
    .map((row) => `Email sent to ${String(row['to'])} with subject "${String(row['subject'])}".`);
}

function ids(state: CanonicalState, entity: string): Set<string> {
  return new Set(rowsOf(state, entity).map((row) => String(row['id'])));
}
