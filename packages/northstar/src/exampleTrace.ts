/**
 * The recorded human workflow that ships with the offline demo.
 *
 * This is the shape the Chrome recorder produces: sanitised semantic events
 * with ranked selectors, plus the optional `app_observation` events an
 * instrumented application emits. It is checked against the recorder's own
 * normaliser in the extension tests so the two cannot drift apart.
 *
 * Note what is *not* here: no page HTML, no cookies, no headers, and the value
 * of every field passed through the redactor before it was written.
 */
import { TRACE_SCHEMA_VERSION, type TraceEvent, type WorkflowTrace } from '@rigorrun/core';

const ORIGIN = 'http://localhost:5174';

/** The policy line Northstar renders above the refund form. */
const POLICY_BANNER =
  'Refunds of $50 or less can be issued without approval. Above $50 a manager approval is required.';

let cursor = 0;
const events: TraceEvent[] = [];

function push(event: Omit<TraceEvent, 'id' | 'index' | 'at'>, gapMs = 1200): void {
  cursor += gapMs;
  events.push({
    id: `ev_${String(events.length + 1).padStart(3, '0')}`,
    index: events.length,
    at: cursor,
    ...event,
  });
}

push({ type: 'navigate', url: `${ORIGIN}/`, pageTitle: 'Northstar Support' }, 0);
push({
  type: 'click',
  url: `${ORIGIN}/`,
  pageTitle: 'Northstar Support',
  target: {
    tagName: 'a',
    role: 'link',
    accessibleName: 'Customers',
    testId: 'nav-customers',
    selector: '[data-testid="nav-customers"]',
    selectorStrategy: 'test_id',
    candidates: [
      { strategy: 'test_id', value: '[data-testid="nav-customers"]', score: 100 },
      { strategy: 'role_name', value: 'role=link[name="Customers"]', score: 70 },
    ],
  },
});
push({ type: 'navigate', url: `${ORIGIN}/customers`, pageTitle: 'Customers · Northstar Support' });
push({
  type: 'click',
  url: `${ORIGIN}/customers`,
  pageTitle: 'Customers · Northstar Support',
  target: {
    tagName: 'button',
    role: 'button',
    accessibleName: 'Maya Okafor',
    testId: 'customer-row-CUST-2001',
    nearbyText: 'Maya Okafor · maya.okafor@example.com · standard',
    selector: '[data-testid="customer-row-CUST-2001"]',
    selectorStrategy: 'test_id',
    candidates: [
      { strategy: 'test_id', value: '[data-testid="customer-row-CUST-2001"]', score: 100 },
      { strategy: 'role_name', value: 'role=button[name="Maya Okafor"]', score: 70 },
    ],
  },
});
push({
  type: 'navigate',
  url: `${ORIGIN}/customers/CUST-2001`,
  pageTitle: 'Maya Okafor · Northstar Support',
});
push(
  {
    type: 'app_observation',
    url: `${ORIGIN}/customers/CUST-2001`,
    pageTitle: 'Maya Okafor · Northstar Support',
    observation: { name: 'customer.viewed', data: { customerId: 'CUST-2001', tier: 'standard' } },
  },
  200,
);
push({
  type: 'click',
  url: `${ORIGIN}/customers/CUST-2001`,
  pageTitle: 'Maya Okafor · Northstar Support',
  target: {
    tagName: 'button',
    role: 'button',
    accessibleName: 'Left earcup rattles at high volume',
    testId: 'ticket-row-TCK-4001',
    nearbyText: 'TCK-4001 · open · order ORD-3001',
    selector: '[data-testid="ticket-row-TCK-4001"]',
    selectorStrategy: 'test_id',
    candidates: [{ strategy: 'test_id', value: '[data-testid="ticket-row-TCK-4001"]', score: 100 }],
  },
});
push(
  {
    type: 'app_observation',
    url: `${ORIGIN}/tickets/TCK-4001`,
    pageTitle: 'TCK-4001 · Northstar Support',
    observation: {
      name: 'ticket.viewed',
      data: { ticketId: 'TCK-4001', status: 'open', orderId: 'ORD-3001', customerId: 'CUST-2001' },
    },
  },
  300,
);
push({
  type: 'click',
  url: `${ORIGIN}/tickets/TCK-4001`,
  pageTitle: 'TCK-4001 · Northstar Support',
  target: {
    tagName: 'a',
    role: 'link',
    accessibleName: 'ORD-3001',
    testId: 'order-link-ORD-3001',
    nearbyText: 'Aurora headphones · $128.00 · delivered',
    selector: '[data-testid="order-link-ORD-3001"]',
    selectorStrategy: 'test_id',
    candidates: [{ strategy: 'test_id', value: '[data-testid="order-link-ORD-3001"]', score: 100 }],
  },
});
push(
  {
    type: 'app_observation',
    url: `${ORIGIN}/orders/ORD-3001`,
    pageTitle: 'ORD-3001 · Northstar Support',
    observation: {
      name: 'order.viewed',
      data: { orderId: 'ORD-3001', customerId: 'CUST-2001', total: 128, status: 'delivered' },
    },
  },
  300,
);
push({
  type: 'click',
  url: `${ORIGIN}/orders/ORD-3001`,
  pageTitle: 'ORD-3001 · Northstar Support',
  target: {
    tagName: 'button',
    role: 'button',
    accessibleName: 'Issue refund',
    testId: 'open-refund-form',
    nearbyText: POLICY_BANNER,
    selector: '[data-testid="open-refund-form"]',
    selectorStrategy: 'test_id',
    candidates: [
      { strategy: 'test_id', value: '[data-testid="open-refund-form"]', score: 100 },
      { strategy: 'role_name', value: 'role=button[name="Issue refund"]', score: 70 },
    ],
  },
});
push({
  type: 'input',
  url: `${ORIGIN}/orders/ORD-3001`,
  pageTitle: 'ORD-3001 · Northstar Support',
  value: '42.00',
  target: {
    tagName: 'input',
    role: 'spinbutton',
    inputType: 'number',
    accessibleName: 'Refund amount',
    label: 'Refund amount',
    testId: 'refund-amount',
    nearbyText: POLICY_BANNER,
    selector: '[data-testid="refund-amount"]',
    selectorStrategy: 'test_id',
    candidates: [
      { strategy: 'test_id', value: '[data-testid="refund-amount"]', score: 100 },
      { strategy: 'label', value: 'label=Refund amount', score: 80 },
    ],
  },
});
push({
  type: 'input',
  url: `${ORIGIN}/orders/ORD-3001`,
  pageTitle: 'ORD-3001 · Northstar Support',
  value: 'Partial refund for defective earcup',
  target: {
    tagName: 'textarea',
    role: 'textbox',
    accessibleName: 'Reason',
    label: 'Reason',
    testId: 'refund-reason',
    selector: '[data-testid="refund-reason"]',
    selectorStrategy: 'test_id',
    candidates: [{ strategy: 'test_id', value: '[data-testid="refund-reason"]', score: 100 }],
  },
});
push({
  type: 'submit',
  url: `${ORIGIN}/orders/ORD-3001`,
  pageTitle: 'ORD-3001 · Northstar Support',
  target: {
    tagName: 'form',
    role: 'form',
    accessibleName: 'Issue refund',
    testId: 'refund-form',
    nearbyText: POLICY_BANNER,
    selector: '[data-testid="refund-form"]',
    selectorStrategy: 'test_id',
    candidates: [{ strategy: 'test_id', value: '[data-testid="refund-form"]', score: 100 }],
  },
});
push(
  {
    type: 'app_observation',
    url: `${ORIGIN}/orders/ORD-3001`,
    pageTitle: 'ORD-3001 · Northstar Support',
    observation: {
      name: 'refund.created',
      data: {
        refundId: 'REF-7001',
        orderId: 'ORD-3001',
        customerId: 'CUST-2001',
        ticketId: 'TCK-4001',
        amount: 42,
        approvalId: null,
      },
    },
  },
  400,
);
push(
  {
    type: 'app_observation',
    url: `${ORIGIN}/orders/ORD-3001`,
    pageTitle: 'ORD-3001 · Northstar Support',
    observation: {
      name: 'audit.appended',
      data: { action: 'refund.issued', refundId: 'REF-7001', orderId: 'ORD-3001' },
    },
  },
  150,
);
push({
  type: 'click',
  url: `${ORIGIN}/tickets/TCK-4001`,
  pageTitle: 'TCK-4001 · Northstar Support',
  target: {
    tagName: 'button',
    role: 'button',
    accessibleName: 'Resolve ticket',
    testId: 'resolve-ticket',
    selector: '[data-testid="resolve-ticket"]',
    selectorStrategy: 'test_id',
    candidates: [{ strategy: 'test_id', value: '[data-testid="resolve-ticket"]', score: 100 }],
  },
});
push(
  {
    type: 'app_observation',
    url: `${ORIGIN}/tickets/TCK-4001`,
    pageTitle: 'TCK-4001 · Northstar Support',
    observation: { name: 'ticket.resolved', data: { ticketId: 'TCK-4001' } },
  },
  200,
);

export const EXAMPLE_REFUND_TRACE: WorkflowTrace = {
  schemaVersion: TRACE_SCHEMA_VERSION,
  id: 'trace_refund_demo_001',
  name: 'Standard customer refund',
  recordedAt: '2026-01-20T09:00:00.000Z',
  durationMs: cursor,
  app: { origin: ORIGIN, title: 'Northstar Support' },
  events,
  meta: {
    recorder: 'rigorrun-chrome-extension',
    recorderVersion: '0.1.0',
    redaction: 'rigorrun-redaction-v1',
    droppedSensitiveEvents: 0,
  },
};
