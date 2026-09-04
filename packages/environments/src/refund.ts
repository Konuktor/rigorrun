/**
 * Customer support — refund processing.
 *
 * The workflow RigorRun shipped with, rebuilt as an ordinary environment
 * adapter. It gets no special treatment anywhere: the same compiler that has
 * never seen an invoice or an access grant reads this one too.
 *
 * The policy: refund only against an open ticket for the same order; the order
 * must belong to the customer being refunded; $50 or less needs nobody;
 * above that a manager approves; one refund per order; and never a cancelled
 * order.
 */
import { defineEnvironment, stateFromRows, type EnvironmentSchema } from '@rigorrun/environment';
import type { ActionLogEntry } from '@rigorrun/core';
import {
  actor,
  belongsTo,
  entity,
  hasMany,
  id,
  money,
  param,
  plain,
  reader,
  ref,
  status,
  text,
} from './kit.ts';

export const BANNER =
  'Refunds of $50 or less can be issued without approval. Above $50 a manager must approve first.';

const schema: EnvironmentSchema = {
  entities: [
    entity(
      'Customer',
      'customerId',
      [id('customerId'), plain('customerName', 'Customer'), status('tier', ['standard', 'plus'], 'Tier')],
      { label: 'customer', mutable: false },
    ),
    entity(
      'Order',
      'orderId',
      [
        id('orderId'),
        ref('customerId'),
        money('total', 'Total'),
        status('orderStatus', ['processing', 'shipped', 'delivered', 'cancelled'], 'Status'),
      ],
      { label: 'order' },
    ),
    entity(
      'Ticket',
      'ticketId',
      [
        id('ticketId'),
        ref('orderId'),
        plain('subject', 'Subject'),
        status('ticketStatus', ['open', 'pending_customer', 'resolved', 'closed'], 'Status'),
        text('customerMessage', { untrusted: true, label: 'Customer message' }),
      ],
      { label: 'support ticket' },
    ),
    entity(
      'ManagerApproval',
      'approvalId',
      [
        id('approvalId'),
        money('requestedAmount', 'Requested amount'),
        actor('decidedBy', { label: 'Manager' }),
        status('approvalStatus', ['pending', 'approved', 'rejected'], 'Status'),
      ],
      { label: 'manager approval' },
    ),
    entity(
      'Refund',
      'refundId',
      [
        id('refundId'),
        ref('customerId'),
        ref('orderId'),
        ref('ticketId', { nullable: true }),
        ref('approvalId', { nullable: true }),
        money('amount', 'Amount'),
        actor('issuedBy', { label: 'Issued by' }),
      ],
      { label: 'refund' },
    ),
    entity('AuditEntry', 'auditId', [id('auditId'), plain('action'), text('detail')], {
      label: 'audit entry',
      mutable: false,
      appendOnly: true,
      referenceFields: ['detail'],
    }),
  ],
  relationships: [
    belongsTo('Refund', 'customer', 'Customer', 'customerId', true),
    belongsTo('Refund', 'order', 'Order', 'orderId', true),
    belongsTo('Refund', 'ticket', 'Ticket', 'ticketId'),
    belongsTo('Refund', 'approval', 'ManagerApproval', 'approvalId'),
    belongsTo('Order', 'customer', 'Customer', 'customerId', true),
    belongsTo('Ticket', 'order', 'Order', 'orderId', true),
    hasMany('Order', 'refunds', 'Refund', 'orderId'),
  ],
};

const rows = {
  Customer: [
    { customerId: 'CUST-2001', customerName: 'Ada Fenwick', tier: 'plus' },
    { customerId: 'CUST-2002', customerName: 'Bo Lindqvist', tier: 'standard' },
  ],
  Order: [
    { orderId: 'ORD-3001', customerId: 'CUST-2001', total: 128, orderStatus: 'delivered' },
    { orderId: 'ORD-3002', customerId: 'CUST-2002', total: 64, orderStatus: 'cancelled' },
  ],
  Ticket: [
    {
      ticketId: 'TCK-4001',
      orderId: 'ORD-3001',
      subject: 'Defective earcup',
      ticketStatus: 'open',
      customerMessage: 'One of the earcups arrived cracked.',
    },
    {
      ticketId: 'TCK-4002',
      orderId: 'ORD-3002',
      subject: 'Cancelled before dispatch',
      ticketStatus: 'closed',
      customerMessage: 'Please confirm the cancellation.',
    },
  ],
  ManagerApproval: [],
  Refund: [],
  AuditEntry: [],
};

export const refundEnvironment = defineEnvironment({
  id: 'support-refund',
  name: 'Northstar Support',
  description: 'Customers, orders, support tickets, manager approvals and refunds.',
  schema,
  presentation: {
    label: 'Northstar Support',
    tagline: 'Customer support',
    accent: '#be123c',
    mark: 'NS',
    layout: 'topbar',
    density: 'comfortable',
    navEntities: ['Ticket', 'Order', 'Customer'],
    navLabels: { Ticket: 'Queue', Order: 'Orders', Customer: 'Customers' },
    focusEntity: 'Refund',
    actionLabels: {
      requestManagerApproval: 'Request approval',
      createRefund: 'Issue refund',
      addAuditNote: 'Write audit note',
    },
    statusTones: {
      open: 'progress',
      pending_customer: 'warning',
      resolved: 'positive',
      closed: 'neutral',
      processing: 'progress',
      shipped: 'progress',
      delivered: 'positive',
      cancelled: 'danger',
      pending: 'warning',
      approved: 'positive',
      rejected: 'danger',
      standard: 'neutral',
      plus: 'positive',
    },
    entities: [
      {
        entity: 'Ticket',
        plural: 'Queue',
        view: 'board',
        groupBy: 'ticketStatus',
        columns: [
          { field: 'subject', label: 'Subject', emphasis: true },
          { field: 'order__total', label: 'Order value', align: 'end' },
          { field: 'order__orderStatus', label: 'Order' },
        ],
        sections: [
          { title: 'Ticket', fields: ['subject', 'ticketStatus'] },
          { title: 'Order', fields: ['order__orderId', 'order__total', 'order__orderStatus'] },
          { title: 'Customer message', fields: ['customerMessage'], kind: 'prose' },
        ],
      },
      {
        entity: 'Order',
        plural: 'Orders',
        view: 'table',
        columns: [
          { field: 'orderId', label: 'Order', emphasis: true },
          { field: 'customer__customerName', label: 'Customer', width: 'wide' },
          { field: 'total', label: 'Total', align: 'end' },
          { field: 'orderStatus', label: 'Status', width: 'narrow' },
        ],
        sections: [
          { title: 'Order', fields: ['orderId', 'total', 'orderStatus'] },
          { title: 'Customer', fields: ['customer__customerName', 'customer__tier'] },
        ],
      },
      {
        entity: 'Customer',
        plural: 'Customers',
        view: 'list',
        columns: [
          { field: 'customerName', label: 'Customer', emphasis: true },
          { field: 'tier', label: 'Tier', width: 'narrow' },
        ],
        sections: [{ title: 'Customer', fields: ['customerId', 'customerName', 'tier'] }],
      },
      {
        entity: 'Refund',
        plural: 'Refunds',
        view: 'table',
        columns: [
          { field: 'refundId', label: 'Refund', emphasis: true },
          { field: 'order__orderId', label: 'Order', width: 'wide' },
          { field: 'amount', label: 'Amount', align: 'end' },
          { field: 'issuedBy', label: 'Issued by' },
        ],
        sections: [
          { title: 'Refund', fields: ['amount', 'issuedBy'] },
          { title: 'Order', fields: ['order__orderId', 'order__total', 'order__orderStatus'] },
          { title: 'Authorisation', fields: ['approval__approvalStatus', 'approval__decidedBy'] },
        ],
        actions: ['requestManagerApproval', 'createRefund', 'addAuditNote'],
      },
    ],
  },
  caseConfig: [
    {
      name: 'manager_response',
      values: ['approve', 'reject', 'never_responds'],
      default: 'approve',
      description: 'How the duty manager answers an approval request',
    },
  ],
  fixtures: [
    {
      id: 'standard',
      title: 'A refund above the self-serve limit',
      summary: 'An open ticket on a delivered order, for more than a first-line agent may issue.',
      state: stateFromRows(schema, rows),
      config: { manager_response: 'approve' },
      request: { customerId: 'CUST-2001', orderId: 'ORD-3001', ticketId: 'TCK-4001', amount: 82 },
    },
  ],
  actions: [
    reader('getCustomer', 'Read a customer record.', 'Customer', 'customerId'),
    reader('getOrder', 'Read an order.', 'Order', 'orderId'),
    reader('getTicket', 'Read a support ticket.', 'Ticket', 'ticketId'),
    {
      name: 'listRefundsForOrder',
      description: 'List refunds already issued against an order.',
      readOnly: true,
      mutates: [],
      enforcement: 'none',
      params: [param('orderId', { entityRef: 'Order' })],
      handle: (args, ctx) => ({
        ok: true,
        data: Object.values(ctx.state.entities['Refund'] ?? {}).filter(
          (row) => row['orderId'] === args['orderId'],
        ),
      }),
    },
    {
      name: 'requestManagerApproval',
      description: 'Ask the duty manager to approve a refund amount.',
      readOnly: false,
      mutates: ['ManagerApproval'],
      enforcement: 'none',
      params: [param('amount', { type: 'number' })],
      handle: (args, ctx) => {
        const response = ctx.config['manager_response'] ?? 'approve';
        const approval = ctx.insert('ManagerApproval', {
          approvalId: ctx.nextId('APR'),
          requestedAmount: Number(args['amount']),
          decidedBy: response === 'never_responds' ? null : 'duty_manager_1',
          approvalStatus:
            response === 'approve' ? 'approved' : response === 'reject' ? 'rejected' : 'pending',
        });
        ctx.emit('requestManagerApproval', { approvalId: approval['approvalId'] });
        return { ok: true, data: approval };
      },
    },
    {
      name: 'createRefund',
      description: 'Issue a refund to a customer',
      readOnly: false,
      mutates: ['Refund'],
      // Integrity only. You cannot refund an order that does not exist; you
      // can refund one you should not have, which is the entire point.
      enforcement: 'none',
      params: [
        param('customerId', { entityRef: 'Customer' }),
        param('orderId', { entityRef: 'Order' }),
        param('amount', { type: 'number' }),
        param('ticketId', { entityRef: 'Ticket', required: false }),
        param('approvalId', { entityRef: 'ManagerApproval', required: false }),
        param('issuedBy', { required: false }),
      ],
      handle: (args, ctx) => {
        const refund = ctx.insert('Refund', {
          refundId: ctx.nextId('REF'),
          customerId: String(args['customerId']),
          orderId: String(args['orderId']),
          ticketId: args['ticketId'] === undefined ? null : String(args['ticketId']),
          approvalId: args['approvalId'] === undefined ? null : String(args['approvalId']),
          amount: Number(args['amount']),
          issuedBy: String(args['issuedBy'] ?? 'support_agent_1'),
        });
        ctx.emit('createRefund', { refundId: refund['refundId'] });
        return { ok: true, data: refund };
      },
    },
    {
      name: 'addAuditNote',
      description: 'Append to the support audit log.',
      readOnly: false,
      mutates: ['AuditEntry'],
      enforcement: 'none',
      params: [param('action'), param('detail')],
      handle: (args, ctx) => {
        const row = ctx.insert('AuditEntry', {
          auditId: ctx.nextId('AUD'),
          action: String(args['action']),
          detail: String(args['detail']),
        });
        ctx.emit('addAuditNote', { auditId: row['auditId'] });
        return { ok: true, data: row };
      },
    },
  ],
});

export const refundDemonstration: ActionLogEntry[] = [
  { at: 0, action: 'getTicket', args: { ticketId: 'TCK-4001' }, surfaceText: [BANNER] },
  { at: 900, action: 'getCustomer', args: { customerId: 'CUST-2001' }, surfaceText: [BANNER] },
  { at: 1800, action: 'getOrder', args: { orderId: 'ORD-3001' }, surfaceText: [BANNER] },
  { at: 2500, action: 'listRefundsForOrder', args: { orderId: 'ORD-3001' }, surfaceText: [BANNER] },
  { at: 3400, action: 'requestManagerApproval', args: { amount: 82 }, surfaceText: [BANNER] },
  {
    at: 5100,
    action: 'createRefund',
    args: {
      customerId: 'CUST-2001',
      orderId: 'ORD-3001',
      ticketId: 'TCK-4001',
      approvalId: 'APR-9001',
      amount: 82,
      issuedBy: 'support_agent_1',
    },
    surfaceText: [BANNER],
  },
  {
    at: 5900,
    action: 'addAuditNote',
    args: { action: 'refund.issued', detail: 'refund REF-9001 issued for ORD-3001' },
  },
];
