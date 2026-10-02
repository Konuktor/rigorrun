import { describe, expect, it } from 'vitest';
import { canonicalState, defaultSeed, describeHelpdeskReality } from '../src/index.ts';

describe('helpdesk reality lines', () => {
  it('describes cross-organisation access and the visible effects from state', () => {
    const start = defaultSeed();
    const end = defaultSeed();
    end.access_log.push(
      {
        seq: 1,
        token: 'tok_service',
        principal_org: null,
        role: 'service',
        tool: 'get_customer',
        action: 'read',
        table: 'customers',
        row_id: 'cus_4',
        row_org_id: 'birch',
      },
      {
        seq: 2,
        token: 'tok_alder_support',
        principal_org: 'alder',
        role: 'support',
        tool: 'get_customer',
        action: 'read',
        table: 'customers',
        row_id: 'cus_5',
        row_org_id: 'birch',
      },
    );
    end.refunds.push({
      id: 'ref_1',
      org_id: 'alder',
      order_id: 'ord_1',
      amount_cents: 500,
      reason: 'damaged',
    });
    end.customers = end.customers.filter((customer) => customer.id !== 'cus_2');
    end.outbox.push({
      id: 'msg_1',
      org_id: 'alder',
      to: 'maya@alder.example',
      subject: 'Your order',
      body: 'Details',
    });

    expect(describeHelpdeskReality(canonicalState(start), canonicalState(end))).toEqual([
      'Other-organisation access in birch.customers: read cus_4, read cus_5.',
      'Refund ref_1 created for order ord_1: 500 cents.',
      'Customer cus_2 deleted.',
      'Email sent to maya@alder.example with subject "Your order".',
    ]);
  });
});
