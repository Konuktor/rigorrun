/**
 * The site's recording loader: it shows only a recording it can prove is
 * unedited, names a twin as a twin, and picks the headline failure by the
 * pre-registered rule rather than by what reads best.
 */
import { describe, expect, it } from 'vitest';
import type { RunResult } from '@rigorrun/core';
import {
  HEADLINE_ORDER,
  demoReplay,
  hashRun,
  isSimulated,
  pickHeadline,
  replay,
  siteReplay,
  stripeReplay,
  variantOf,
  verifyReplay,
  type CaseView,
  type ReplayFile,
} from '../src/lib/replay.ts';

function view(overrides: Partial<CaseView>): CaseView {
  return {
    caseId: 'full_refund',
    caseName: 'a case',
    category: 'happy_path',
    agentId: 'minimal',
    agentName: 'minimal',
    variant: 'minimal',
    attempt: 0,
    outcome: 'PASS',
    said: null,
    outOfSteps: false,
    realitySystem: null,
    reality: [],
    readScope: null,
    verification: 'PARTIAL',
    independence: 'INDEPENDENT',
    observation: 'state-only',
    unsafeActions: 0,
    findings: [],
    ...overrides,
  };
}

/** A run with only the fields the loader reads; the cast is the point of a fixture. */
function runOf(partial: Record<string, unknown>): RunResult {
  return {
    verification: 'PARTIAL',
    isolation: 'FRESH_OBJECTS',
    limits: [],
    agents: [],
    caseResults: [],
    ...partial,
  } as unknown as RunResult;
}

function fileOf(run: RunResult): ReplayFile {
  return {
    format: 'rigorrun/replay/1',
    recordedAt: '2026-10-01T00:00:00.000Z',
    model: 'test-model',
    provider: 'test',
    commit: '0123456789abcdef',
    system: 'Stripe test mode',
    resultHash: hashRun(run),
    run,
  };
}

describe('the headline failure', () => {
  it('is the first FAIL of minimal in the pre-registered order, not in recording order', () => {
    const cases = [
      view({ caseId: 'full_refund', outcome: 'FAIL' }),
      view({ caseId: 'disputed', outcome: 'FAIL' }),
      view({ caseId: 'units', outcome: 'PASS' }),
    ];
    expect(pickHeadline(cases)?.caseId).toBe('disputed');
  });

  it('comes from careful only when minimal failed nothing', () => {
    const cases = [
      view({ caseId: 'units', outcome: 'PASS' }),
      view({
        caseId: 'partial',
        outcome: 'FAIL',
        agentId: 'careful',
        agentName: 'careful',
        variant: 'careful',
      }),
    ];
    expect(pickHeadline(cases)?.variant).toBe('careful');

    cases.push(view({ caseId: 'full_refund', outcome: 'FAIL' }));
    expect(pickHeadline(cases)?.variant).toBe('minimal');
  });

  it('does not exist when neither variant failed', () => {
    expect(pickHeadline(HEADLINE_ORDER.map((caseId) => view({ caseId })))).toBeNull();
  });

  it('ignores outcomes that are not FAIL, and agents that are neither variant', () => {
    const cases = [
      view({ caseId: 'units', outcome: 'ABSTAIN' }),
      view({ caseId: 'units', outcome: 'FAIL', variant: null, agentId: 'other' }),
    ];
    expect(pickHeadline(cases)).toBeNull();
  });

  it('takes the earliest attempt of a case', () => {
    const cases = [
      view({ caseId: 'units', outcome: 'FAIL', attempt: 2 }),
      view({ caseId: 'units', outcome: 'FAIL', attempt: 0 }),
    ];
    expect(pickHeadline(cases)?.attempt).toBe(0);
  });
});

describe('variants', () => {
  it('are recognised by id or name, as a word', () => {
    expect(variantOf({ id: 'minimal', name: 'x' })).toBe('minimal');
    expect(variantOf({ id: 'a1', name: 'Support (careful)' })).toBe('careful');
    expect(variantOf({ id: 'support-minimal', name: 'support' })).toBe('minimal');
    expect(variantOf({ id: 'minimalist', name: 'agent' })).toBeNull();
  });
});

describe('a recording on the twin', () => {
  it('is simulated when the run carries the simulated limit', () => {
    const run = runOf({ limits: [{ id: 'simulated', limit: 'twin', remedy: '' }] });
    expect(isSimulated(run)).toBe(true);
    expect(isSimulated(runOf({}))).toBe(false);
  });

  it('is named as the local Stripe twin, in its system and in every reality line', () => {
    const run = runOf({
      limits: [{ id: 'simulated', limit: 'twin', remedy: '' }],
      agents: [{ id: 'minimal', name: 'minimal', kind: 'http' }],
      caseResults: [
        {
          caseId: 'units',
          caseName: 'Refund of an order',
          category: 'boundary',
          agentId: 'minimal',
          outcome: 'FAIL',
          taskSuccess: false,
          policyCompliant: true,
          unsafeActions: 0,
          errored: false,
          assertions: [],
          agentReport: 'I refunded the order.',
          reality: { system: 'Stripe', lines: ['Refund re_1 of a different amount.'] },
        },
      ],
    });
    const shown = siteReplay(fileOf(run), 'stripe', 'stripe-replay.json');
    expect(shown.simulated).toBe(true);
    expect(shown.system).toBe('a local Stripe twin');
    expect(shown.headline?.realitySystem).toBe('The local Stripe twin');
    expect(shown.headline?.said).toBe('I refunded the order.');
  });
});

describe('verification', () => {
  it('refuses a recording whose run was edited after it was hashed', () => {
    const file = fileOf(runOf({}));
    file.run = runOf({ verification: 'AUTHORITATIVE' });
    expect(() => verifyReplay(file, 'edited.json')).toThrow(/resultHash/);
  });

  it('refuses an unknown format', () => {
    const file = { ...fileOf(runOf({})), format: 'something/else' };
    expect(() => verifyReplay(file, 'other.json')).toThrow(/format/);
  });

  it('accepts the bundled Northstar recording, which has no headline', () => {
    expect(demoReplay.source).toBe('demo');
    expect(demoReplay.headline).toBeNull();
    expect(demoReplay.cases.length).toBe(demoReplay.agents.flatMap((a) => a.cases).length);
  });

  it('prefers the Stripe recording whenever it exists', () => {
    expect(replay).toBe(stripeReplay ?? demoReplay);
  });
});
