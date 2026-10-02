import {
  getPack,
  hasPack,
  registerPack,
  type PackConnectionConfig,
  type PackDefinition,
  type PresentationHints,
  type SafetyMode,
} from '@rigorrun/environment';
import { z } from 'zod';
import { HELPDESK_PACK_ID, TWIN_URL } from './conventions.ts';
import { helpdeskSchema } from './schema.ts';
import { openHelpdeskSession } from './session.ts';
import { helpdeskSuiteFromParams } from './suite.ts';

const HelpdeskOptionsSchema = z
  .object({ safety: z.enum(['production', 'staging', 'local', 'ephemeral']).optional() })
  .strict();

export const HELPDESK_PRESENTATION: PresentationHints = {
  label: 'Larch Helpdesk',
  tagline: 'Customers, orders, tickets, refunds, sent mail, and access records in a local twin',
  accent: '#257a5a',
  mark: 'L',
  navEntities: ['Customer', 'Order', 'Ticket', 'Refund', 'Outbox', 'AccessLog'],
  navLabels: { Outbox: 'Sent mail', AccessLog: 'Access log' },
  focusEntity: 'Ticket',
  layout: 'sidebar',
  density: 'compact',
  statusTones: {
    open: 'warning',
    closed: 'neutral',
    paid: 'positive',
    partially_refunded: 'warning',
    refunded: 'neutral',
    read: 'progress',
    write: 'warning',
  },
  entities: [
    table('Customer', 'Customers', ['id', 'org_id', 'name', 'email']),
    table('Order', 'Orders', ['id', 'org_id', 'customer_id', 'ref', 'amount_cents', 'status']),
    table('Ticket', 'Tickets', ['id', 'org_id', 'customer_id', 'subject', 'status']),
    table('Refund', 'Refunds', ['id', 'org_id', 'order_id', 'amount_cents', 'reason']),
    table('Outbox', 'Sent mail', ['id', 'org_id', 'to', 'subject']),
    table('AccessLog', 'Access log', [
      'id',
      'principal_org',
      'action',
      'table',
      'row_id',
      'row_org_id',
    ]),
  ],
};

function table(entity: string, plural: string, fields: string[]) {
  return {
    entity,
    plural,
    view: 'table' as const,
    columns: fields.map((field, index) => ({ field, ...(index === 0 ? { emphasis: true } : {}) })),
    sections: [{ title: plural, fields }],
  };
}

export function describeHelpdeskConnection(config: PackConnectionConfig): string {
  if (config.mode === 'live') {
    return 'Refuses a live Larch Helpdesk connection; this pack supports its local twin only.';
  }
  return (
    `Calls the local Larch Helpdesk twin at ${config.baseUrl ?? TWIN_URL} and replaces its whole ` +
    "world with each case's state before the agent starts."
  );
}

export const helpdeskPack: PackDefinition = {
  id: HELPDESK_PACK_ID,
  name: 'Larch Helpdesk',
  description:
    'Permission and scope cases against the local Larch Helpdesk twin, read back from its complete state.',
  schema: helpdeskSchema,
  presentation: HELPDESK_PRESENTATION,
  open: async (options) => {
    const parsed = HelpdeskOptionsSchema.parse(options.options ?? {});
    return openHelpdeskSession({
      mode: options.mode,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(parsed.safety === undefined ? {} : { safety: parsed.safety as SafetyMode }),
    });
  },
  describeAction: describeHelpdeskConnection,
  suite: (params) => helpdeskSuiteFromParams(params),
  cli: async (argv) => (await import('./cli/index.ts')).helpdeskCli(argv),
};

export function registerHelpdeskPack(): PackDefinition {
  if (!hasPack(HELPDESK_PACK_ID) || getPack(HELPDESK_PACK_ID) !== helpdeskPack) {
    registerPack(helpdeskPack);
  }
  return helpdeskPack;
}
