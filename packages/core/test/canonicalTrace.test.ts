import { describe, expect, it } from 'vitest';
import {
  actionSteps,
  fromActionLog,
  fromStructuredImport,
  fromWorkflowTrace,
  parseCanonicalTrace,
  primaryAction,
  surfaceText,
  type WorkflowTrace,
} from '@rigorrun/core';

const BROWSER_TRACE: WorkflowTrace = {
  schemaVersion: 1,
  id: 'trace_demo',
  name: 'A demonstration',
  recordedAt: '2026-01-20T09:00:00.000Z',
  durationMs: 9000,
  app: { origin: 'http://localhost:5174', title: 'Demo app' },
  events: [
    {
      id: 'ev_1',
      index: 0,
      type: 'navigate',
      at: 0,
      url: 'http://localhost:5174/items/ITM-1',
      pageTitle: 'Item',
    },
    {
      id: 'ev_2',
      index: 1,
      type: 'input',
      at: 3000,
      url: 'http://localhost:5174/items/ITM-1',
      pageTitle: 'Item',
      value: '30.00',
      target: {
        tagName: 'input',
        role: 'spinbutton',
        accessibleName: 'Amount',
        label: 'Amount',
        nearbyText: 'Claims of $50 or less need no approval.',
        selector: '[data-testid="amount"]',
        selectorStrategy: 'test_id',
        candidates: [],
      },
    },
    {
      id: 'ev_3',
      index: 2,
      type: 'app_observation',
      at: 8000,
      url: 'http://localhost:5174/items/ITM-1',
      pageTitle: 'Item',
      observation: { name: 'claim.filed', data: { claimId: 'CLM-1', amount: 30 } },
    },
  ],
  meta: {
    recorder: 'rigorrun-chrome-extension',
    recorderVersion: '0.1.0',
    redaction: 'rigorrun-redaction-v1',
    droppedSensitiveEvents: 0,
  },
};

describe('canonical trace normalisation', () => {
  it('turns a browser recording into a canonical trace', () => {
    const trace = fromWorkflowTrace(BROWSER_TRACE, {
      environmentId: 'demo',
      observationToAction: { 'claim.filed': 'fileClaim' },
    });
    expect(trace.source).toBe('browser_recorder');
    expect(trace.environmentId).toBe('demo');
    expect(trace.steps.map((step) => step.kind)).toEqual(['navigation', 'input', 'observation']);
    expect(actionSteps(trace).map((step) => step.action?.name)).toEqual(['fileClaim']);
  });

  it('keeps text the operator could see, the only source for a stated threshold', () => {
    const trace = fromWorkflowTrace(BROWSER_TRACE, { environmentId: 'demo' });
    expect(surfaceText(trace).map((entry) => entry.text)).toContain(
      'Claims of $50 or less need no approval.',
    );
  });

  it('turns an action log into the same shape, with no DOM anywhere', () => {
    const trace = fromActionLog(
      [
        { at: 0, action: 'getItem', args: { itemId: 'ITM-1' } },
        { at: 1200, action: 'fileClaim', args: { itemId: 'ITM-1', amount: 30 } },
      ],
      { environmentId: 'demo', id: 'trace_api', name: 'Via the API' },
    );
    expect(trace.source).toBe('action_log');
    expect(trace.steps.every((step) => step.ui === undefined)).toBe(true);
    expect(primaryAction(trace)?.action?.name).toBe('fileClaim');
  });

  it('round-trips a structured import', () => {
    const original = fromActionLog([{ at: 0, action: 'fileClaim' }], {
      environmentId: 'demo',
      id: 'trace_manual',
      name: 'Hand written',
    });
    expect(fromStructuredImport(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it('refuses a trace that names no environment', () => {
    expect(() =>
      parseCanonicalTrace({ ...BROWSER_TRACE, schemaVersion: 1, steps: [] }),
    ).toThrow();
  });

  it('carries authoritative state before and after when the producer has it', () => {
    const trace = fromActionLog([{ at: 0, action: 'fileClaim' }], {
      environmentId: 'demo',
      id: 't',
      name: 'n',
      before: { entities: { Claim: {} } },
      after: { entities: { Claim: { 'CLM-1': { claimId: 'CLM-1' } } } },
    });
    expect(Object.keys(trace.after?.entities['Claim'] ?? {})).toEqual(['CLM-1']);
  });
});
