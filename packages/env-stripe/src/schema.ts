/**
 * The part of a Stripe account a refund desk works in, as RigorRun reads it.
 *
 * Four kinds of record and the links between them, with only the fields a
 * check or a reality line needs. Everything else Stripe returns is dropped when
 * the pack reads, so nothing here can drift into being judged by accident.
 *
 * Amounts are `currency_minor`: Stripe's own integers, 2500 where a person
 * would write $25.00, never converted. Converting would put a rounding step
 * between what the agent did and what is checked, and the most common way an
 * agent gets a refund wrong is exactly that conversion.
 *
 * What the projection derives from this, and the suite's checks rely on, on
 * every Refund row (see the test that pins them):
 *
 *  - `charge__exists`   — the refund names a charge the read actually found;
 *  - `charge__customer` — whose payment it was refunded against;
 *  - `charge__disputed` — whether that payment was under dispute;
 *  - `charge__amount`, `charge__amount_refunded`, `charge__status`, and the
 *    same for the starting world as `seed__charge__…`.
 *
 * A Charge row also carries `order_ref`, from the charge's metadata, so that a
 * check can see the reference a ticket is looked up by rewritten or removed.
 */
import type {
  EntitySchema,
  EnvironmentSchema,
  FieldSchema,
  RelationshipSchema,
} from '@rigorrun/environment';

/** Stripe's object id. Every record is named by one. */
function id(): FieldSchema {
  return { name: 'id', type: 'string', nullable: false, role: 'identifier', label: 'ID' };
}

/** The id of another object, which Stripe leaves null when there is none. */
function ref(name: string, label: string, nullable = true): FieldSchema {
  return { name, type: 'string', nullable, role: 'identifier', label };
}

/** Whole minor units, as Stripe sends them. */
function minorUnits(name: string, label: string): FieldSchema {
  return {
    name,
    type: 'number',
    nullable: false,
    role: 'quantity',
    unit: 'currency_minor',
    precision: 1,
    label,
  };
}

function flag(name: string, label: string): FieldSchema {
  return { name, type: 'boolean', nullable: false, role: 'flag', label };
}

function status(values: readonly string[], label = 'Status'): FieldSchema {
  return {
    name: 'status',
    type: 'enum',
    nullable: false,
    role: 'status',
    enumValues: values,
    label,
  };
}

function entity(name: string, label: string, fields: FieldSchema[]): EntitySchema {
  return { name, idField: 'id', fields, mutable: true, appendOnly: false, label };
}

function belongsTo(from: string, name: string, to: string, required: boolean): RelationshipSchema {
  return { name, from, to, via: { kind: 'fk', field: name }, cardinality: 'one', required };
}

function hasMany(from: string, name: string, to: string, field: string): RelationshipSchema {
  return { name, from, to, via: { kind: 'fk', field }, cardinality: 'many', required: false };
}

/** Stripe's Charge statuses. */
export const CHARGE_STATUSES = ['succeeded', 'pending', 'failed'] as const;
/**
 * Stripe's Refund statuses. Every one but `failed` and `canceled` is a refund
 * the agent made: one still settling has still been issued.
 */
export const REFUND_STATUSES = [
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
] as const;
export const REFUND_REASONS = [
  'duplicate',
  'fraudulent',
  'requested_by_customer',
  'expired_uncaptured_charge',
] as const;
export const DISPUTE_STATUSES = [
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented',
] as const;

export const stripeSchema: EnvironmentSchema = {
  entities: [
    entity('Customer', 'customer', [
      id(),
      // Neither is ever compared or hoisted onto another record. The email is
      // how an agent finds the customer; the name is written by the customer,
      // which makes it somewhere an instruction could be smuggled in.
      { name: 'email', type: 'string', nullable: true, label: 'Email' },
      {
        name: 'name',
        type: 'string',
        nullable: true,
        role: 'freetext',
        untrusted: true,
        label: 'Name',
      },
    ]),
    entity('Charge', 'charge', [
      id(),
      ref('customer', 'Customer'),
      ref('payment_intent', 'Payment intent'),
      minorUnits('amount', 'Amount'),
      minorUnits('amount_refunded', 'Amount refunded'),
      flag('refunded', 'Fully refunded'),
      flag('disputed', 'Disputed'),
      status(CHARGE_STATUSES),
      // The order reference a ticket cites, as `metadata[order_ref]` holds it.
      // Read so that rewriting or removing it is seen; never hoisted onto
      // another record or compared with one, only checked against the
      // reference the case made.
      { name: 'order_ref', type: 'string', nullable: true, label: 'Order reference' },
    ]),
    entity('Refund', 'refund', [
      id(),
      ref('charge', 'Charge'),
      ref('payment_intent', 'Payment intent'),
      minorUnits('amount', 'Amount'),
      status(REFUND_STATUSES),
      { name: 'reason', type: 'enum', nullable: true, enumValues: REFUND_REASONS, label: 'Reason' },
    ]),
    entity('Dispute', 'dispute', [id(), ref('charge', 'Charge', false), status(DISPUTE_STATUSES)]),
  ],
  relationships: [
    belongsTo('Charge', 'customer', 'Customer', false),
    belongsTo('Refund', 'charge', 'Charge', false),
    belongsTo('Dispute', 'charge', 'Charge', true),
    hasMany('Charge', 'refunds', 'Refund', 'charge'),
    hasMany('Charge', 'disputes', 'Dispute', 'charge'),
  ],
};
