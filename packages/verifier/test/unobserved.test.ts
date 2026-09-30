/**
 * Evidence that exists but was not observed.
 *
 * A black-box agent works on the system directly, so RigorRun never sees its
 * calls. Checks about the order of those calls cannot be made — but that is a
 * fact about how the agent was connected, known before the case ran, not a
 * world RigorRun failed to read. Such checks are UNVERIFIABLE and listed, and
 * they do not make every case abstain: the verdict rests on the checks that
 * read the system, which a black-box run still makes in full.
 */
import { describe, expect, it } from 'vitest';
import { AssertionSchema, type Assertion, type Observation } from '@rigorrun/core';
import { verify } from '@rigorrun/verifier';

const assertion = (partial: Partial<Assertion> & Pick<Assertion, 'id' | 'kind' | 'target'>) =>
  AssertionSchema.parse({ description: partial.id, ...partial });

const observation: Observation = {
  state: {},
  derived: { created: [{ id: 'R-1' }] },
  events: [],
  agentReport: 'Done.',
};

const checks = [
  assertion({ id: 'done', kind: 'state_exists', target: 'derived.created[id=R-1]', severity: 'success' }),
  assertion({
    id: 'order',
    kind: 'event_occurred',
    target: 'events[type=lookup]',
    severity: 'policy',
    verificationSource: 'EVENT',
  }),
];

describe('unobserved evidence', () => {
  it('marks the checks resting on it UNVERIFIABLE, never blocking, with the reason', () => {
    const summary = verify(checks, observation, {
      unobservedSources: ['EVENT'],
      unobservedReason: 'black-box: RigorRun did not see the agent’s calls',
    });
    const order = summary.results.find((result) => result.assertionId === 'order');
    expect(order?.status).toBe('UNVERIFIABLE');
    expect(order?.blocking).toBe(false);
    expect(order?.message).toMatch(/did not see the agent/);
    expect(summary.blockingUnverifiable).toBe(0);
    expect(summary.unverifiable).toBe(1);
  });

  it('still decides the case on what the system shows', () => {
    const passed = verify(checks, observation, { unobservedSources: ['EVENT'] });
    expect(passed.taskSuccess).toBe(true);
    expect(passed.policyCompliant).toBe(true);

    const missing = verify(checks, { ...observation, derived: { created: [] } }, { unobservedSources: ['EVENT'] });
    expect(missing.taskSuccess).toBe(false);
  });

  it('leaves a missing source blocking, as before', () => {
    const summary = verify(checks, observation, { unverifiableSources: ['EVENT'] });
    expect(summary.blockingUnverifiable).toBe(1);
  });
});
