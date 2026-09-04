/**
 * The five demo workflows.
 *
 * Five materially different jobs, one pipeline. Everything that differs
 * between them lives in this directory — a schema, some fixture rows, and a
 * recording of somebody doing the work. Nothing in `core`, `compiler`,
 * `generator`, `verifier` or `runner` knows any of them exist.
 */
import { registerEnvironment } from '@rigorrun/environment';
import { invoiceEnvironment, invoiceDemonstration } from './invoice.ts';
import type { WorkflowDefinition } from './pipeline.ts';

export const WORKFLOWS: WorkflowDefinition[] = [
  {
    key: 'invoice',
    title: 'Invoice approval',
    discipline: 'Finance',
    registration: invoiceEnvironment,
    fixtureId: 'standard',
    demonstration: invoiceDemonstration,
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

export { invoiceEnvironment } from './invoice.ts';
