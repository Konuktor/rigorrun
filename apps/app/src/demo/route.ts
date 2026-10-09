import type { Step } from './useDemo.ts';

export const DEMO_WORKFLOW_KEYS = ['refund', 'invoice', 'access'] as const;
const STEPS: readonly Step[] = ['record', 'learned', 'confirm', 'benchmark', 'run', 'verdict'];

/** The URL selects a bundled example, never a saved approval. */
export function demoRoute(hash: string): { workflowKey: string; step: Step } {
  const [path, query] = hash.split('?');
  const workflowKey = new URLSearchParams(query).get('workflow') ?? 'refund';
  if (!(DEMO_WORKFLOW_KEYS as readonly string[]).includes(workflowKey)) {
    return { workflowKey: 'refund', step: 'record' };
  }
  const candidate = /^#\/demo\/([a-z]+)$/.exec(path ?? '')?.[1];
  const step =
    candidate && (STEPS as readonly string[]).includes(candidate) ? (candidate as Step) : 'record';
  return { workflowKey, step };
}

export function demoHash(workflowKey: string, step: Step): string {
  if (!(DEMO_WORKFLOW_KEYS as readonly string[]).includes(workflowKey)) return '#/demo/record';
  return `#/demo/${step}${workflowKey === 'refund' ? '' : `?workflow=${workflowKey}`}`;
}
