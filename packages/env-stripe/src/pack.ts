/**
 * The Stripe pack, as RigorRun ships it.
 *
 * Its schema, how its records are presented, and how a session is opened —
 * against the local twin or Stripe's test mode.
 */
import {
  getPack,
  hasPack,
  registerPack,
  type PackConnectionConfig,
  type PackDefinition,
  type PresentationHints,
} from '@rigorrun/environment';
import { KEY_SECRET, LIVE_URL, STRIPE_PACK_ID, TWIN_URL } from './conventions.ts';
import { stripeSchema } from './schema.ts';
import { openStripeSession } from './session.ts';

export const STRIPE_PRESENTATION: PresentationHints = {
  label: 'Stripe (test mode)',
  tagline: 'Customers, payments, refunds and disputes in a Stripe test account',
  accent: '#635bff',
  mark: 'S',
  navEntities: ['Charge', 'Refund', 'Customer', 'Dispute'],
  navLabels: { Charge: 'Payments', Refund: 'Refunds', Customer: 'Customers', Dispute: 'Disputes' },
  actionLabels: { refund: 'Refund', lookup_charge: 'Look up', list_refunds: 'Refunds' },
  focusEntity: 'Charge',
  layout: 'sidebar',
  density: 'compact',
  statusTones: {
    succeeded: 'positive',
    pending: 'progress',
    requires_action: 'warning',
    failed: 'danger',
    canceled: 'neutral',
    warning_needs_response: 'warning',
    warning_under_review: 'progress',
    warning_closed: 'neutral',
    needs_response: 'danger',
    under_review: 'progress',
    won: 'positive',
    lost: 'danger',
    prevented: 'positive',
  },
  entities: [
    {
      entity: 'Charge',
      plural: 'Payments',
      view: 'table',
      columns: [
        { field: 'id', label: 'Charge', emphasis: true },
        { field: 'customer', label: 'Customer' },
        { field: 'amount', label: 'Amount', align: 'end' },
        { field: 'amount_refunded', label: 'Refunded', align: 'end' },
        { field: 'disputed', label: 'Disputed', width: 'narrow' },
        { field: 'status', label: 'Status', width: 'narrow' },
      ],
      sections: [
        { title: 'Payment', fields: ['amount', 'amount_refunded', 'refunded', 'status'] },
        { title: 'Links', fields: ['customer', 'payment_intent', 'disputed'] },
      ],
      actions: ['refund', 'lookup_charge', 'list_refunds'],
      subtitleField: 'customer',
    },
    {
      entity: 'Refund',
      plural: 'Refunds',
      view: 'table',
      columns: [
        { field: 'id', label: 'Refund', emphasis: true },
        { field: 'charge', label: 'Charge' },
        { field: 'amount', label: 'Amount', align: 'end' },
        { field: 'status', label: 'Status', width: 'narrow' },
        { field: 'reason', label: 'Reason' },
      ],
      sections: [{ title: 'Refund', fields: ['amount', 'status', 'reason', 'charge'] }],
      subtitleField: 'charge',
    },
    {
      entity: 'Customer',
      plural: 'Customers',
      view: 'list',
      columns: [
        { field: 'id', label: 'Customer', emphasis: true },
        { field: 'email', label: 'Email', width: 'wide' },
        { field: 'name', label: 'Name' },
      ],
      sections: [{ title: 'Customer', fields: ['email', 'name'] }],
      subtitleField: 'email',
    },
    {
      entity: 'Dispute',
      plural: 'Disputes',
      view: 'table',
      columns: [
        { field: 'id', label: 'Dispute', emphasis: true },
        { field: 'charge', label: 'Charge' },
        { field: 'status', label: 'Status' },
      ],
      sections: [{ title: 'Dispute', fields: ['charge', 'status'] }],
    },
  ],
};

/**
 * What opening a connection would do, for the confirmation shown before a
 * project is trusted: the address, the secret the key is read from, and that
 * every case creates objects there.
 */
export function describeStripeConnection(config: PackConnectionConfig): string {
  const secret = config.keySecret ?? KEY_SECRET;
  if (config.mode === 'twin') {
    return (
      `Calls the local Stripe twin at ${config.baseUrl ?? TWIN_URL} with the test key stored as ` +
      `"${secret}", and creates each case's customers and payments there.`
    );
  }
  return (
    `Calls Stripe at ${config.baseUrl ?? LIVE_URL} with the key stored as "${secret}", after ` +
    'checking it is a test-mode key, and creates each case’s customers, payments and refunds in ' +
    'that test account.'
  );
}

export const stripePack: PackDefinition = {
  id: STRIPE_PACK_ID,
  name: 'Stripe (test mode)',
  description:
    'Refunds against a Stripe test account, or a local twin of Stripe’s API. Every case creates ' +
    'its own customers and payments, and RigorRun reads them back with its own key.',
  schema: stripeSchema,
  presentation: STRIPE_PRESENTATION,
  open: (options) => openStripeSession(options),
  describeAction: describeStripeConnection,
};

/**
 * Makes the pack available by id. Safe to call any number of times: a second
 * call finds this same definition registered and does nothing.
 */
export function registerStripePack(): PackDefinition {
  if (!hasPack(STRIPE_PACK_ID) || getPack(STRIPE_PACK_ID) !== stripePack) registerPack(stripePack);
  return stripePack;
}
