/**
 * Audit finding R-1: the baseline a verdict is measured against.
 *
 * Against a system that cannot be seeded, the runner used to project every
 * case against the snapshot captured when the suite was generated. That
 * snapshot already contained the demonstrated record, so a correct agent that
 * did the job again produced "nothing was created" and failed, while any
 * record the snapshot did not know about — a duplicate, a wrong value, mail
 * that arrived since — counted as the agent's work and passed.
 *
 * These tests build exactly that situation in-process and require the runner
 * to observe the world at case start instead.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearEnvironments } from '@rigorrun/environment';
import { hashValue } from '@rigorrun/core';
import { runBenchmark } from '../src/index.ts';
import {
  CLEAN_ROWS,
  CORRECT,
  DEMONSTRATED_CLAIM,
  FALSE_CLAIM,
  liveBenchmark,
  liveRegistration,
  world,
} from './liveWorld.ts';

afterEach(() => clearEnvironments());

describe('a system that cannot be seeded', () => {
  it('measures the case against the world observed at case start, not the generation snapshot', async () => {
    // Generation captured the world with the demonstrated claim already in it.
    // Every run's reset puts the world back to clean, as the audit's resets did.
    const registration = liveRegistration({ resetTo: world(CLEAN_ROWS) });
    const { benchmark, snapshot } = await liveBenchmark(registration);
    expect(Object.keys(snapshot.entities['Claim'] ?? {})).toHaveLength(1);

    const result = await runBenchmark(benchmark, [CORRECT]);
    const happy = result.caseResults.find((r) => r.category === 'happy_path')!;
    expect(happy.baseline).toBe('OBSERVED_AT_START');
    // The baseline is the world the reset produced — not the recorded one.
    expect(happy.initialStateHash).not.toBe(await hashValue(snapshot));
    expect(happy.initialStateHash).toBe(await hashValue(world(CLEAN_ROWS)));
    // And the correct agent passes, which is the whole point.
    expect(happy.outcome).toBe('PASS');
    expect(happy.taskSuccess).toBe(true);
  });

  it('still passes a correct agent when the world has accumulated since generation', async () => {
    // No reset script at all: the demonstrated claim, and whatever else
    // happened since, is still there when the case starts.
    const accumulated = world({ ...CLEAN_ROWS, Claim: [DEMONSTRATED_CLAIM, { ...DEMONSTRATED_CLAIM, claimId: 'CLM-0007', amount: 12 }] });
    const registration = liveRegistration({ resetTo: accumulated });
    const { benchmark } = await liveBenchmark(registration);

    const result = await runBenchmark(benchmark, [CORRECT]);
    const happy = result.caseResults.find((r) => r.category === 'happy_path')!;
    expect(happy.outcome).toBe('PASS');
    // Exactly the new claim is the delta: nothing that was already there.
    const created = happy.assertions.find((a) => a.assertionId === 'success__performed');
    expect(created?.status).toBe('PASS');
  });

  it('still fails an agent that claims the work and did not do it', async () => {
    const registration = liveRegistration({ resetTo: world(CLEAN_ROWS) });
    const { benchmark } = await liveBenchmark(registration);
    const result = await runBenchmark(benchmark, [FALSE_CLAIM]);
    const happy = result.caseResults.find((r) => r.category === 'happy_path')!;
    expect(happy.outcome).toBe('FAIL');
    expect(happy.agentReport).toMatch(/Filed one claim/);
  });

  it('fails an agent that claims the work in an accumulated world too', async () => {
    // The drift is in the baseline now, so it cannot be mistaken for work.
    const accumulated = world({ ...CLEAN_ROWS, Claim: [DEMONSTRATED_CLAIM] });
    const registration = liveRegistration({ resetTo: accumulated });
    const { benchmark } = await liveBenchmark(registration, { snapshot: world(CLEAN_ROWS) });
    const result = await runBenchmark(benchmark, [FALSE_CLAIM]);
    const happy = result.caseResults.find((r) => r.category === 'happy_path')!;
    expect(happy.outcome).toBe('FAIL');
  });

  it('installs the recorded world where the adapter can seed, and says so', async () => {
    const registration = liveRegistration({ resetTo: world(CLEAN_ROWS), caps: { seed: 'arbitrary' } });
    const { benchmark, snapshot } = await liveBenchmark(registration);
    const result = await runBenchmark(benchmark, [CORRECT]);
    const happy = result.caseResults.find((r) => r.category === 'happy_path')!;
    expect(happy.baseline).toBe('INSTALLED_SEED');
    expect(happy.initialStateHash).toBe(await hashValue(snapshot));
  });
});
