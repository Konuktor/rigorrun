/**
 * The five demo workflows.
 *
 * Five materially different jobs, one pipeline. Everything that differs
 * between them lives in this directory — a schema, some fixture rows, and a
 * recording of somebody doing the work. Nothing in `core`, `compiler`,
 * `generator`, `verifier` or `runner` knows any of them exist.
 */
import { registerEnvironment } from '@rigorrun/environment';
import { refundEnvironment, refundDemonstration } from './refund.ts';
import { invoiceEnvironment, invoiceDemonstration } from './invoice.ts';
import { leadEnvironment, leadDemonstration } from './lead.ts';
import { accessEnvironment, accessDemonstration } from './access.ts';
import { fulfillmentEnvironment, fulfillmentDemonstration } from './fulfillment.ts';
import type { WorkflowDefinition } from './pipeline.ts';

export const WORKFLOWS: WorkflowDefinition[] = [
  {
    key: 'refund',
    title: 'Refund processing',
    discipline: 'Customer support',
    registration: refundEnvironment,
    fixtureId: 'standard',
    demonstration: refundDemonstration,
  },
  {
    key: 'invoice',
    title: 'Invoice approval',
    discipline: 'Finance',
    registration: invoiceEnvironment,
    fixtureId: 'standard',
    demonstration: invoiceDemonstration,
  },
  {
    key: 'lead',
    title: 'Lead qualification',
    discipline: 'Sales',
    registration: leadEnvironment,
    fixtureId: 'standard',
    demonstration: leadDemonstration,
  },
  {
    key: 'access',
    title: 'Access provisioning',
    discipline: 'IT',
    registration: accessEnvironment,
    fixtureId: 'standard',
    demonstration: accessDemonstration,
  },
  {
    key: 'fulfillment',
    title: 'Order fulfilment',
    discipline: 'Operations',
    registration: fulfillmentEnvironment,
    fixtureId: 'standard',
    demonstration: fulfillmentDemonstration,
  },
];

for (const workflow of WORKFLOWS) registerEnvironment(workflow.registration);

export function workflowByKey(key: string): WorkflowDefinition {
  const found = WORKFLOWS.find((workflow) => workflow.key === key);
  if (!found) {
    throw new Error(
      `Unknown workflow "${key}". Available: ${WORKFLOWS.map((w) => w.key).join(', ')}.`,
    );
  }
  return found;
}

export { refundEnvironment } from './refund.ts';
export { invoiceEnvironment } from './invoice.ts';
export { leadEnvironment } from './lead.ts';
export { accessEnvironment } from './access.ts';
export { fulfillmentEnvironment } from './fulfillment.ts';
