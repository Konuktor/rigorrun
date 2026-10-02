/**
 * The site's recording loader: it shows only a recording it can prove is
 * unedited, names a twin as a twin, and picks the headline failure by the
 * pre-registered rule rather than by what reads best.
 */
import { describe, expect, it } from 'vitest';
import type { RunResult } from '@rigorrun/core';
import stripeFile from '../../../fixtures/replays/stripe-replay.json';
import {
  HEADLINE_ORDER,
  demoReplay,
  flagshipReplays,
  hashRun,
  helpdeskReplay,
  isSimulated,
  permissionMatrix,
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

  it("uses a flagship recording's agent ids instead of matching names", () => {
    const variants = {
      scoped: {
        agentId: 'agent-a',
        description: 'scoped description',
        promptSha256: 'prompt',
        toolsSha256: 'tools',
        runId: 'run-a',
        runResultHash: 'hash-a',
      },
    };
    expect(variantOf({ id: 'agent-a', name: 'unlabelled agent' }, variants)).toBe('scoped');
    expect(variantOf({ id: 'careful', name: 'careful' }, variants)).toBeNull();
  });
});

describe('a recording on the twin', () => {
  it('is simulated when the run carries the simulated limit', () => {
    const run = runOf({ limits: [{ id: 'simulated', limit: 'twin', remedy: '' }] });
    expect(isSimulated(run)).toBe(true);
    expect(isSimulated(runOf({}))).toBe(false);
  });

  it('is named from the recording as a twin, in its system and in every reality line', () => {
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
    const shown = siteReplay(
      { ...fileOf(run), system: 'the Stripe staging twin (simulated)', simulated: true },
      'stripe',
      'stripe-replay.json',
    );
    expect(shown.simulated).toBe(true);
    expect(shown.system).toBe('the Stripe staging twin');
    expect(shown.cases[0]?.realitySystem).toBe('The Stripe staging twin');
    expect(shown.cases[0]?.said).toBe('I refunded the order.');
  });
});

function assertion(
  status: 'PASS' | 'FAIL' | 'ERROR' | 'UNVERIFIABLE' | 'INAPPLICABLE',
  dimension: 'tenant' | 'role' | 'tool' | 'sink',
) {
  return {
    assertionId: `${dimension}-${status}`,
    kind: 'equals',
    description: `${dimension} check`,
    status,
    severity: 'MUST',
    evaluator: 'deterministic',
    unsafe: status === 'FAIL' || status === 'ERROR',
    message: `${status} ${dimension}`,
    dimension,
  };
}

function caseResult(
  agentId: string,
  caseId: string,
  outcome: 'PASS' | 'FAIL',
  assertions: ReturnType<typeof assertion>[] = [],
) {
  return {
    caseId,
    caseName: caseId.replaceAll('_', ' '),
    category: 'boundary',
    agentId,
    attempt: 0,
    outcome,
    taskSuccess: outcome === 'PASS',
    policyCompliant: outcome === 'PASS',
    unsafeActions: outcome === 'FAIL' ? 1 : 0,
    errored: false,
    assertions,
    agentReport: `${agentId} reported ${caseId}`,
    reality: { system: 'Larch Helpdesk', lines: [`the twin recorded ${caseId}`] },
  };
}

function helpdeskFile(): ReplayFile {
  const run = runOf({
    limits: [{ id: 'simulated', limit: 'The helpdesk is a twin.', remedy: '' }],
    agents: [
      { id: 'agent-scoped-id', name: 'Alder support', kind: 'blackbox' },
      { id: 'agent-service-id', name: 'Helpdesk support', kind: 'blackbox' },
    ],
    caseResults: [
      caseResult('agent-scoped-id', 'email_copy', 'PASS'),
      caseResult('agent-scoped-id', 'other_org_order', 'FAIL', [
        assertion('FAIL', 'tenant'),
        assertion('ERROR', 'role'),
      ]),
      caseResult('agent-scoped-id', 'own_refund', 'PASS', [assertion('PASS', 'tenant')]),
      caseResult('agent-service-id', 'own_refund', 'FAIL'),
      caseResult('agent-service-id', 'email_copy', 'FAIL', [
        assertion('FAIL', 'sink'),
        assertion('INAPPLICABLE', 'sink'),
      ]),
      caseResult('agent-service-id', 'other_org_order', 'PASS', [
        assertion('PASS', 'tenant'),
        assertion('UNVERIFIABLE', 'tool'),
      ]),
    ],
  });
  return {
    ...fileOf(run),
    recordedAt: '2026-10-02T06:00:00.000Z',
    system: 'the Larch Helpdesk twin (simulated)',
    simulated: true,
    variants: {
      scoped: {
        agentId: 'agent-scoped-id',
        description: "the support agent, connected with Alder Outdoor's own support token.",
        promptSha256: 'prompt',
        toolsSha256: 'tools',
        runId: 'run-scoped',
        runResultHash: 'hash-scoped',
      },
      service: {
        agentId: 'agent-service-id',
        description: "the same agent, connected with the helpdesk's service token.",
        promptSha256: 'prompt',
        toolsSha256: 'tools',
        runId: 'run-service',
        runResultHash: 'hash-service',
      },
    },
    benchmark: {
      cases: [{ id: 'own_refund' }, { id: 'other_org_order' }, { id: 'email_copy' }],
    } as NonNullable<ReplayFile['benchmark']>,
    presentation: {
      headline: {
        variants: ['service', 'scoped'],
        cases: ['other_org_order', 'email_copy', 'own_refund'],
        source: 'reports/permissions-demo-2026-10/PREREGISTRATION.md',
      },
      task: { label: 'The ticket', inputs: ['message'] },
      next: ['npx rigorrun helpdesk try'],
    },
  };
}

function withOutcomes(
  file: ReplayFile,
  outcome: (agentId: string, caseId: string) => 'PASS' | 'FAIL',
): ReplayFile {
  const run = {
    ...file.run,
    caseResults: file.run.caseResults.map((entry) => ({
      ...entry,
      outcome: outcome(entry.agentId, entry.caseId),
    })),
  };
  return { ...file, run, resultHash: hashRun(run) };
}

describe('a helpdesk-shaped flagship recording', () => {
  it('uses recording variants, headline rule, suite order and system name', () => {
    const shown = siteReplay(helpdeskFile(), 'helpdesk', 'helpdesk-replay.json');

    expect(shown.agents.map((agent) => agent.variant)).toEqual(['scoped', 'service']);
    expect(shown.agents[0]?.cases.map((entry) => entry.caseId)).toEqual([
      'own_refund',
      'other_org_order',
      'email_copy',
    ]);
    expect(shown.headline?.variant).toBe('service');
    expect(shown.headline?.caseId).toBe('email_copy');
    expect(shown.system).toBe('the Larch Helpdesk twin');
    expect(shown.headline?.realitySystem).toBe('The Larch Helpdesk twin');
    expect(shown.variantDescriptions.scoped).toContain("Alder Outdoor's own support token");
  });

  it('falls back to the next variant and has no headline when neither failed', () => {
    const file = helpdeskFile();
    const scopedOnly = withOutcomes(file, (agentId, caseId) =>
      agentId === 'agent-scoped-id' && caseId === 'other_org_order' ? 'FAIL' : 'PASS',
    );
    expect(siteReplay(scopedOnly, 'helpdesk', 'scoped.json').headline?.variant).toBe('scoped');

    const allPass = withOutcomes(file, () => 'PASS');
    expect(siteReplay(allPass, 'helpdesk', 'passing.json').headline).toBeNull();
  });

  it('counts each variant and boundary in the permission matrix', () => {
    const matrix = permissionMatrix(helpdeskFile());
    expect(matrix?.variants.map((variant) => variant.name)).toEqual(['scoped', 'service']);
    expect(matrix?.rows.map((row) => row.label)).toEqual([
      "Another tenant's data",
      'Outside its role',
      'A tool it must not use',
      'Data leaving',
    ]);
    expect(matrix?.rows[0]?.cells).toMatchObject([
      { variant: 'scoped', failed: 1, held: 1, notChecked: 0 },
      { variant: 'service', failed: 0, held: 1, notChecked: 0 },
    ]);
    expect(matrix?.rows[3]?.cells[1]).toMatchObject({
      variant: 'service',
      failed: 1,
      held: 0,
      notChecked: 1,
    });
  });
});

describe('the real Stripe flagship recording', () => {
  it("keeps today's headline and agent order from the recording", () => {
    const shown = siteReplay(
      stripeFile as unknown as ReplayFile,
      'stripe',
      'fixtures/replays/stripe-replay.json',
    );
    expect(shown.headline).toMatchObject({ variant: 'minimal', caseId: 'other_customer' });
    expect(shown.agents.map((agent) => agent.variant)).toEqual(['careful', 'minimal']);
    expect(shown.agents[0]?.cases.map((entry) => entry.caseId)).toEqual(
      stripeFile.benchmark.cases.map((entry) => entry.id),
    );
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
    expect(flagshipReplays.stripe).toBe(stripeReplay ?? undefined);
    expect(flagshipReplays.helpdesk ?? null).toBe(helpdeskReplay);
  });
});
