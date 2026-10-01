/**
 * The flagship recording, replayed: two variants, one headline, every case.
 *
 * Everything below is SYNTHETIC — a RunResult built in this file, not a
 * recording of anything. It exists to hold `printReplay` to the flagship
 * pre-registration (reports/flagship-demo-2026-10/PREREGISTRATION.md, "How it
 * is shown"): the headline is the first FAIL of `minimal` in a fixed order of
 * cases, else the first FAIL of `careful`, else there is none and the replay
 * says so; the verdict's strength is read from the result, never typed in; the
 * provenance names the temperature and says "simulated" when it was.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashValue, type Benchmark, type CaseResult, type RunResult } from '@rigorrun/core';
import {
  REPLAY_FORMAT,
  bundledReplay,
  hashRun,
  headlineCase,
  printReplay,
  readReplayFile,
  verifyReplay,
  type Replay,
} from '../src/replay.ts';
import { main } from '../src/main.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The pre-registered headline order, as the recorder writes it into the recording. */
const ORDER = [
  'units',
  'prompt_injection',
  'other_customer',
  'already_refunded',
  'disputed',
  'partial',
  'full_refund',
];
/** The suite's own order, which the matrix lists cases in. */
const SUITE_ORDER = [
  'full_refund',
  'units',
  'partial',
  'already_refunded',
  'disputed',
  'other_customer',
  'prompt_injection',
];

const AGENTS = { careful: 'a_c4re', minimal: 'a_m1n1' } as const;
type Variant = keyof typeof AGENTS;

/** A synthetic case: a ticket with an amount, and words that cite an order by its binding. */
function syntheticCase(id: string): Benchmark['cases'][number] {
  return {
    id,
    name: `Synthetic ${id}`,
    category: 'happy_path',
    description: '',
    seed: { scenarioId: id, mutations: [], config: {}, request: {} },
    task: {
      instruction: 'A synthetic instruction.',
      inputs: {
        order_ref: '{{bind:order_ref}}',
        amount: '$49.99',
        message: `Synthetic words about order {{bind:order_ref}}\n\nfor case ${id}.`,
      },
      allowedTools: [],
      tools: [],
      policyBrief: '',
    },
    checks: [
      {
        id: `${id}.check`,
        kind: 'state_exists',
        description: 'A synthetic check',
        target: 'derived.created.Thing[order={{bind:order_ref}}]',
        severity: 'success',
        evaluator: 'deterministic',
        unsafeIfFailed: false,
        verificationSource: 'STATE',
        failureSeverity: 'MAJOR',
        blocking: true,
      },
    ],
    referencePlan: [],
    maxSteps: 24,
    timeoutMs: 60_000,
  } as unknown as Benchmark['cases'][number];
}

const benchmark = {
  schemaVersion: 'synthetic',
  id: 'bm_synthetic',
  name: 'A synthetic suite',
  cases: SUITE_ORDER.map(syntheticCase),
} as unknown as Benchmark;

function result(variant: Variant, caseId: string, outcome: string): CaseResult {
  const failed = outcome === 'FAIL';
  return {
    runId: 'run_synthetic',
    caseId,
    caseName: `Synthetic ${caseId}`,
    category: 'happy_path',
    agentId: AGENTS[variant],
    correlationId: `${variant}.${caseId}`,
    attempt: 0,
    startedAt: '2026-10-01T00:00:00.000Z',
    finishedAt: '2026-10-01T00:00:01.000Z',
    durationMs: 1000,
    steps: [],
    actions: [],
    assertions: failed
      ? [
          {
            assertionId: `${caseId}.check`,
            kind: 'state_exists',
            description: `the synthetic check of ${caseId}`,
            status: 'FAIL',
            unsafe: false,
            message: 'found nothing',
            blocking: true,
          },
        ]
      : [],
    taskSuccess: !failed,
    policyCompliant: true,
    unsafeActions: 0,
    errored: false,
    outcome,
    outcomeReason: '',
    missingEvidence: [],
    verification: 'PARTIAL',
    evidenceIndependence: 'INDEPENDENT',
    baseline: 'MATERIALIZED',
    initialStateHash: '',
    materialized: { order_ref: `ORD_${variant}_${caseId}` },
    readScope: 'Only the synthetic records this case made.',
    reality: {
      system: 'The synthetic twin',
      lines: [`Synthetic line for ${variant} ${caseId}.`],
    },
    observation: 'state-only',
    agentReport: `Synthetic sentence from ${variant} on ${caseId}.`,
    costUsd: null,
    costNote: 'cost unavailable',
    finalStateHash: '',
    finalStateSummary: {},
  } as unknown as CaseResult;
}

/** Outcomes per variant, by case id; every case not named passes. */
async function recording(
  fails: Partial<Record<Variant, string[]>>,
  over: Partial<Replay> = {},
): Promise<Replay> {
  const run = {
    schemaVersion: 'synthetic',
    runId: 'run_synthetic',
    benchmarkId: benchmark.id,
    benchmarkName: benchmark.name,
    benchmarkHash: await hashValue(benchmark),
    contractHash: '',
    environment: 'p_synthetic',
    startedAt: '2026-10-01T00:00:00.000Z',
    finishedAt: '2026-10-01T00:10:00.000Z',
    agents: [
      { id: AGENTS.careful, name: 'careful', kind: 'blackbox' },
      { id: AGENTS.minimal, name: 'minimal', kind: 'blackbox' },
    ],
    caseResults: (['careful', 'minimal'] as const).flatMap((variant) =>
      SUITE_ORDER.map((caseId) =>
        result(variant, caseId, fails[variant]?.includes(caseId) ? 'FAIL' : 'PASS'),
      ),
    ),
    scores: [],
    verdict: { winnerAgentId: null, summary: '', rationale: [] },
    verification: 'PARTIAL',
    isolation: 'FRESH_OBJECTS',
    limits: [{ id: 'simulated', limit: 'Synthetic.', remedy: '' }],
    notTestable: [],
    resultHash: '',
    rigorrunVersion: '0.0.0',
  } as unknown as RunResult;
  const variant = (name: Variant) => ({
    agentId: AGENTS[name],
    description: `the synthetic ${name} variant`,
    promptSha256: 'p'.repeat(64),
    toolsSha256: 't'.repeat(64),
    runId: `run_${name}`,
    runResultHash: 'sha256:synthetic',
  });
  return {
    format: REPLAY_FORMAT,
    recordedAt: '2026-10-02T03:04:05.000Z',
    model: 'synthetic-model-1',
    provider: 'a synthetic provider',
    commit: 'abcdef0123456789abcdef0123456789abcdef01',
    system: 'a synthetic twin',
    temperature: 1,
    temperatureSource: 'https://example.com/synthetic-docs',
    simulated: true,
    variants: { careful: variant('careful'), minimal: variant('minimal') },
    discarded: [],
    benchmark,
    presentation: {
      headline: {
        variants: ['minimal', 'careful'],
        cases: ORDER,
        source: 'a synthetic rule',
      },
      task: { label: 'The work', inputs: ['amount', 'message'] },
      next: ['npx rigorrun synthetic-next-step', 'https://example.com/synthetic-next'],
    },
    resultHash: hashRun(run),
    run,
    ...over,
  };
}

function captured(): { text: () => string } {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return { text: () => chunks.join('') };
}

afterEach(() => vi.restoreAllMocks());

describe('the headline rule', () => {
  it('takes the first FAIL of minimal in the pre-registered order, not in the suite’s', async () => {
    // In the suite's order `partial` comes first; in the headline order `disputed` does.
    const replay = await recording({ minimal: ['partial', 'disputed'], careful: ['units'] });
    const headline = headlineCase(replay)!;
    expect(headline.variant).toBe('minimal');
    expect(headline.result.caseId).toBe('disputed');
  });

  it('puts units before every other case', async () => {
    const replay = await recording({ minimal: ['full_refund', 'prompt_injection', 'units'] });
    expect(headlineCase(replay)?.result.caseId).toBe('units');
  });

  it('falls back to the first FAIL of careful when minimal failed nothing', async () => {
    const replay = await recording({ careful: ['full_refund', 'other_customer'] });
    const headline = headlineCase(replay)!;
    expect(headline.variant).toBe('careful');
    expect(headline.result.caseId).toBe('other_customer');
    expect(headline.result.agentId).toBe(AGENTS.careful);
  });

  it('has no headline when nothing failed, and says so plainly', async () => {
    const replay = await recording({});
    expect(headlineCase(replay)).toBeUndefined();
    const out = captured();
    printReplay(replay);
    expect(out.text()).toContain('Neither variant failed a case in this recording.');
    expect(out.text()).not.toContain('The headline');
  });

  it('never counts an outcome that is not FAIL as the headline', async () => {
    const replay = await recording({ minimal: ['partial'] });
    const harness = replay.run.caseResults.find(
      (entry) => entry.agentId === AGENTS.minimal && entry.caseId === 'units',
    )!;
    (harness as { outcome: string }).outcome = 'HARNESS_FAILURE';
    replay.resultHash = hashRun(replay.run);
    expect(headlineCase(replay)?.result.caseId).toBe('partial');
  });
});

describe('the replay as printed', () => {
  it('shows the headline: the work, the agent’s words, the system, and the verdict as recorded', async () => {
    const replay = await recording({ minimal: ['units'] });
    // The strength is the result's own: change it there, and the printout follows.
    const units = replay.run.caseResults.find(
      (entry) => entry.agentId === AGENTS.minimal && entry.caseId === 'units',
    )!;
    (units as { verification: string }).verification = 'OBSERVATIONAL';
    (units as { evidenceIndependence: string }).evidenceIndependence = 'SELF_REPORTED';
    replay.resultHash = hashRun(replay.run);

    const out = captured();
    printReplay(replay);
    const text = out.text();
    expect(text).toContain('RigorRun — a recorded run, replayed');
    expect(text).toContain('The headline  minimal · Synthetic units');
    // The work, bound to the records this attempt made, on one line.
    expect(text).toMatch(
      /The work\s+\$49\.99 · "Synthetic words about order ORD_minimal_units for case units\."/,
    );
    expect(text).toMatch(/The agent said\s+"Synthetic sentence from minimal on units\."/);
    expect(text).toMatch(/The synthetic twin shows\s+Synthetic line for minimal units\./);
    expect(text).toMatch(/Verdict\s+FAIL · OBSERVATIONAL · SELF_REPORTED/);
    expect(text).toContain('the synthetic check of units — found nothing');
    // Its order: work, words, system, verdict.
    const order = ['The work', 'The agent said', 'The synthetic twin shows', 'Verdict'].map(
      (label) => text.indexOf(label),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('shows every case for both variants, and the counts', async () => {
    const replay = await recording({ minimal: ['units', 'partial'], careful: ['disputed'] });
    const out = captured();
    printReplay(replay);
    const text = out.text();
    for (const caseId of SUITE_ORDER) expect(text).toContain(`Synthetic ${caseId}`);
    expect(text).toMatch(/› Synthetic units\s+PASS\s+FAIL/);
    expect(text).toMatch(/ {2}Synthetic disputed\s+FAIL\s+PASS/);
    expect(text).toMatch(/careful\s+7 cases\s+6 passed\s+1 failed/);
    expect(text).toMatch(/minimal\s+7 cases\s+5 passed\s+2 failed/);
    expect(text).toContain('npx rigorrun synthetic-next-step');
    expect(text).toContain('https://example.com/synthetic-next');
  });

  it('names the model, its temperature, the provider, the date and the commit, and says simulated', async () => {
    const replay = await recording({ minimal: ['units'] });
    const out = captured();
    printReplay(replay);
    const text = out.text();
    expect(text).toContain('synthetic-model-1, temperature 1, through a synthetic provider');
    expect(text).toContain('Against a synthetic twin (simulated)');
    expect(text).toContain('recorded 2026-10-02 at abcdef0');
    // Each variant is described in the recording's own words.
    expect(text).toContain('the synthetic minimal variant');
  });

  it('does not say simulated twice when the system already says it, nor at all when it was not', async () => {
    const said = await recording({}, { system: 'a synthetic twin (simulated)' });
    let out = captured();
    printReplay(said);
    expect(out.text().match(/simulated/g)).toHaveLength(1);
    vi.restoreAllMocks();

    const real = await recording({}, { system: 'the real synthetic system', simulated: false });
    out = captured();
    printReplay(real);
    expect(out.text()).not.toContain('simulated');
  });

  it('wraps what the agent said and what the system shows rather than cutting them off', async () => {
    const replay = await recording({ minimal: ['units'] });
    const units = replay.run.caseResults.find(
      (entry) => entry.agentId === AGENTS.minimal && entry.caseId === 'units',
    )!;
    const said = `Synthetic ${'long '.repeat(30)}sentence ending here.`;
    (units as { agentReport: string }).agentReport = said;
    units.reality!.lines = [`Synthetic ${'wide '.repeat(25)}system line ending here.`];
    replay.resultHash = hashRun(replay.run);
    const out = captured();
    printReplay(replay);
    const flat = out.text().replace(/\n\s+/g, ' ');
    expect(flat).toContain('sentence ending here."');
    expect(flat).toContain('system line ending here.');
  });

  it('says a pilot is a pilot, and not evidence', async () => {
    const out = captured();
    printReplay(await recording({ minimal: ['units'] }, { pilot: true }));
    expect(out.text()).toContain(
      'A pilot run, made to find harness faults: not the recording, and not evidence.',
    );
  });

  it('fits in 100 columns and uses no colour when the output is not a terminal', async () => {
    const replay = await recording(
      { minimal: ['units', 'prompt_injection'] },
      { model: `synthetic-${'very-long-'.repeat(8)}model` },
    );
    const out = captured();
    printReplay(replay);
    const text = out.text();
    expect(text).not.toContain(String.fromCharCode(27));
    for (const row of text.split('\n')) expect(row.length).toBeLessThanOrEqual(100);
  });

  it('renders in well under five seconds', async () => {
    const replay = await recording({ minimal: ['units'] });
    captured();
    const started = performance.now();
    printReplay(replay);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe('what is refused', () => {
  it('refuses a recording whose run does not match its hash', async () => {
    const replay = await recording({ minimal: ['units'] });
    const edited = { ...replay, run: { ...replay.run, verification: 'AUTHORITATIVE' } } as Replay;
    expect(() => verifyReplay(edited)).toThrow(/does not match/);
    expect(() => printReplay(edited)).toThrow(/does not match/);
  });

  it('refuses a recording whose suite is not the one its run ran', async () => {
    const replay = await recording({ minimal: ['units'] });
    const other = {
      ...benchmark,
      cases: benchmark.cases.map((entry) =>
        entry.id === 'units'
          ? { ...entry, task: { ...entry.task, inputs: { ...entry.task.inputs, amount: '$1.00' } } }
          : entry,
      ),
    } as Benchmark;
    expect(() => verifyReplay({ ...replay, benchmark: other })).toThrow(/suite in this recording/);
  });

  it('refuses a headline rule that names a variant the recording does not have', async () => {
    const replay = await recording({});
    const presentation = {
      ...replay.presentation!,
      headline: { ...replay.presentation!.headline, variants: ['nonexistent'] },
    };
    expect(() => verifyReplay({ ...replay, presentation })).toThrow(/headline rule/);
  });
});

describe('rigorrun demo, choosing a recording', () => {
  it('replays a recording from a file with --replay, and --northstar the bundled example', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rigorrun-replay-'));
    try {
      const path = join(dir, 'synthetic.json');
      await writeFile(path, JSON.stringify(await recording({ minimal: ['units'] })));
      let out = captured();
      expect(await main(['demo', '--replay', path])).toBe(0);
      expect(out.text()).toContain('The headline  minimal · Synthetic units');
      vi.restoreAllMocks();

      out = captured();
      expect(await main(['demo', '--northstar'])).toBe(0);
      expect(out.text()).toContain(bundledReplay().model);
      expect(out.text()).not.toContain('The headline');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses an edited recording from a file rather than showing it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rigorrun-replay-'));
    try {
      const path = join(dir, 'edited.json');
      const replay = await recording({ minimal: ['units'] });
      await writeFile(path, JSON.stringify({ ...replay, resultHash: 'f'.repeat(64) }));
      await expect(readReplayFile(path)).resolves.toBeDefined();
      const err: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        err.push(String(chunk));
        return true;
      });
      captured();
      expect(await main(['demo', '--replay', path])).toBe(2);
      expect(err.join('')).toMatch(/does not match/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('will not choose between a file and the bundled example', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await main(['demo', '--replay', 'x.json', '--northstar'])).toBe(2);
  });
});
