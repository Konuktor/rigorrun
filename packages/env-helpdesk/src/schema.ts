import type {
  EntitySchema,
  EnvironmentSchema,
  FieldSchema,
  RelationshipSchema,
} from '@rigorrun/environment';

function id(name = 'id', label = 'ID', nullable = false): FieldSchema {
  return { name, type: 'string', nullable, role: 'identifier', label };
}

function text(
  name: string,
  label: string,
  options: { nullable?: boolean; free?: boolean; untrusted?: boolean } = {},
): FieldSchema {
  return {
    name,
    type: 'string',
    nullable: options.nullable ?? false,
    ...(options.free ? { role: 'freetext' as const } : {}),
    ...(options.untrusted ? { untrusted: true } : {}),
    label,
  };
}

function amount(name: string, label: string): FieldSchema {
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

function status(name: string, values: readonly string[], label = 'Status'): FieldSchema {
  return { name, type: 'enum', nullable: false, role: 'status', enumValues: values, label };
}

function entity(
  name: string,
  label: string,
  fields: FieldSchema[],
  options: { mutable?: boolean; appendOnly?: boolean } = {},
): EntitySchema {
  return {
    name,
    idField: 'id',
    fields,
    mutable: options.mutable ?? true,
    appendOnly: options.appendOnly ?? false,
    label,
  };
}

function belongsTo(from: string, name: string, to: string, field: string): RelationshipSchema {
  return { name, from, to, via: { kind: 'fk', field }, cardinality: 'one', required: true };
}

const orgId = (nullable = false): FieldSchema => id('org_id', 'Organisation', nullable);

export const helpdeskSchema: EnvironmentSchema = {
  entities: [
    entity('Org', 'organisation', [id(), orgId(), text('name', 'Name')], { mutable: false }),
    entity('Customer', 'customer', [
      id(),
      orgId(),
      text('name', 'Name'),
      text('email', 'Email'),
      text('notes', 'Notes', { free: true, untrusted: true }),
    ]),
    entity('Order', 'order', [
      id(),
      orgId(),
      id('customer_id', 'Customer'),
      text('ref', 'Reference'),
      amount('amount_cents', 'Amount'),
      amount('refunded_cents', 'Refunded'),
      status('status', ['paid', 'partially_refunded', 'refunded']),
    ]),
    entity('Ticket', 'ticket', [
      id(),
      orgId(),
      id('customer_id', 'Customer'),
      text('subject', 'Subject'),
      text('body', 'Body', { free: true, untrusted: true }),
      status('status', ['open', 'closed']),
      text('notes', 'Internal notes', { free: true }),
    ]),
    entity(
      'Refund',
      'refund',
      [
        id(),
        orgId(),
        id('order_id', 'Order'),
        amount('amount_cents', 'Amount'),
        text('reason', 'Reason', { free: true }),
      ],
      { mutable: false, appendOnly: true },
    ),
    entity(
      'Outbox',
      'outbox message',
      [
        id(),
        orgId(true),
        text('to', 'Recipient'),
        text('subject', 'Subject'),
        text('body', 'Body', { free: true, untrusted: true }),
      ],
      { mutable: false, appendOnly: true },
    ),
    entity(
      'AccessLog',
      'access log entry',
      [
        id(),
        orgId(true),
        {
          name: 'seq',
          type: 'number',
          nullable: false,
          role: 'quantity',
          unit: 'count',
          precision: 1,
          label: 'Sequence',
        },
        text('token', 'Token'),
        id('principal_org', 'Principal organisation', true),
        status('role', ['support', 'service'], 'Role'),
        text('tool', 'Tool'),
        status('action', ['read', 'write'], 'Action'),
        text('table', 'Table'),
        id('row_id', 'Row'),
        id('row_org_id', 'Row organisation', true),
      ],
      { mutable: false, appendOnly: true },
    ),
  ],
  relationships: [
    belongsTo('Order', 'customer', 'Customer', 'customer_id'),
    belongsTo('Ticket', 'customer', 'Customer', 'customer_id'),
    belongsTo('Refund', 'order', 'Order', 'order_id'),
  ],
};
