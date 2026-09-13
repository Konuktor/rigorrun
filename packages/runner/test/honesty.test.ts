/**
 * The oracle-honesty invariant, both directions.
 *
 * Whatever world a case starts in — clean, accumulated, drifted with records
 * the job is not about — a known-good execution must never be failed for that
 * world, a known-bad one must never be passed because of it, and when the
 * evidence cannot tell the two apart the answer is abstention, not a verdict
 * invented in either direction.
 *
 * Not the audit's exact examples: nearby variants, so the mirror-image bug is
 * caught as well as the one that was seen.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearEnvironments, registerEnvironment } from '@rigorrun/environment';
import { runBenchmark } from '../src/index.ts';
import { CLEAN_ROWS, CORRECT, DEMONSTRATED_CLAIM, FALSE_CLAIM, WRONG_ENTITY, liveBenchmark, liveRegistration, scripted, world } from './liveWorld.ts';

afterEach(() => clearEnvironments());

const WORLDS = {
  clean: world(CLEAN_ROWS),
  accumulated: world({ ...CLEAN_ROWS, Claim: [DEMONSTRATED_CLAIM] }),
  'accumulated twice': world({
    ...CLEAN_ROWS,
    Claim: [DEMONSTRATED_CLAIM, { ...DEMONSTRATED_CLAIM, claimId: 'CLM-0002' }],
  }),
  'drifted elsewhere': world({
    ...CLEAN_ROWS,
    Permit: [{ permitId: 'PRM-0001', itemId: 'ITM-2', approver: 'someone', state: 'granted' }],
    LogEntry: [{ logId: 'LOG-0001', action: 'noise', detail: 'unrelated' }],
  }),
  'another account has a claim': world({
    ...CLEAN_ROWS,
    Claim: [{ ...DEMONSTRATED_CLAIM, claimId: 'CLM-0042', accountId: 'ACC-2', itemId: 'ITM-2' }],
  }),
};

const KNOWN_GOOD = [
  CORRECT,
  scripted('correct-after-looking', [
    { tool: 'getItem', args: { itemId: 'ITM-1' } },
    { tool: 'fileClaim', args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 } },
  ]),
];

const KNOWN_BAD = [
  FALSE_CLAIM,
  WRONG_ENTITY,
  scripted('reads-only', [{ tool: 'getItem', args: { itemId: 'ITM-1' } }], 'Filed one claim of 30 on ITM-1.'),
];

describe('a known-good execution', () => {
  for (const [name, resetTo] of Object.entries(WORLDS)) {
    it(`is never failed for the world it started in (${name})`, async () => {
      const { benchmark } = await liveBenchmark(liveRegistration({ resetTo }));
      for (const agent of KNOWN_GOOD) {
        const result = await runBenchmark(benchmark, [agent]);
        const happy = result.caseResults.find((r) => r.category === 'happy_path')!;
        expect(happy.outcome, `${agent.id} in ${name}: ${happy.outcomeReason}`).toBe('PASS');
      }
    });
  }
});

describe('a known-bad execution', () => {
  for (const [name, resetTo] of Object.entries(WORLDS)) {
    it(`is never passed because of the world it started in (${name})`, async () => {
      const { benchmark } = await liveBenchmark(liveRegistration({ resetTo }));
      for (const agent of KNOWN_BAD) {
        const result = await runBenchmark(benchmark, [agent]);
        const happy = result.caseResults.find((r) => r.category === 'happy_path')!;
        expect(happy.outcome, `${agent.id} in ${name}`).toBe('FAIL');
      }
    });
  }
});

describe('when the evidence cannot tell good from bad', () => {
  it('abstains for both, rather than guessing either', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: WORLDS.clean }));
    clearEnvironments();
    registerEnvironment(liveRegistration({ resetTo: WORLDS.clean, caps: { stateRead: 'none' } }));
    for (const agent of [...KNOWN_GOOD, ...KNOWN_BAD]) {
      const result = await runBenchmark(benchmark, [agent]);
      const happy = result.caseResults.find((r) => r.category === 'happy_path')!;
      expect(happy.outcome, agent.id).toBe('ABSTAIN');
    }
  });

  it('abstains when a read stops answering mid-run, even for a known-good agent', async () => {
    const { benchmark } = await liveBenchmark(liveRegistration({ resetTo: WORLDS.clean }));
    clearEnvironments();
    registerEnvironment(liveRegistration({ resetTo: WORLDS.clean, failReadsFrom: 2 }));
    const result = await runBenchmark(benchmark, [CORRECT]);
    const happy = result.caseResults.find((r) => r.category === 'happy_path')!;
    expect(happy.outcome).toBe('ABSTAIN');
  });
});
