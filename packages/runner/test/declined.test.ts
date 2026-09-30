/**
 * Requalification v2 (GATE 2, GATE 5): an agent that did the job in a case
 * whose right answer is to decline passed.
 *
 * It sent an email to the wrong recipient where the request named an unknown
 * service. The reads were of the mailbox the job writes to, so the stray
 * message was outside them, and every state check — nothing of the job's kind
 * created, nothing outside the frame — held. The proxy had recorded the call
 * succeeding; no check asked about it. A declined case now also holds the job's
 * own action to not having succeeded, from the call log: an EVENT check, so a
 * black-box run lists it as not made rather than failing on a log it never had.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearEnvironments, registerEnvironment } from '@rigorrun/environment';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { applyReview, fromActionLog, rulesAwaitingReview, type Benchmark } from '@rigorrun/core';
import { carefulAgent, naiveAgent } from '@rigorrun/agents';
import { runBenchmark } from '../src/index.ts';
import { TEST_FIXTURE, testEnvironment } from '../../environment/test/support.ts';

afterEach(() => clearEnvironments());

async function benchmark(): Promise<Benchmark> {
  clearEnvironments();
  registerEnvironment(testEnvironment);
  const recorder = testEnvironment.create();
  await recorder.reset();
  await recorder.seed(TEST_FIXTURE.state, TEST_FIXTURE.config);
  const before = await recorder.getState();
  await recorder.executeAction('requestPermit', { itemId: 'ITM-1' });
  await recorder.executeAction('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30, permitId: 'PRM-9001' });
  const trace = fromActionLog(
    [
      { at: 0, action: 'requestPermit', args: { itemId: 'ITM-1' } },
      { at: 1000, action: 'fileClaim', args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30, permitId: 'PRM-9001' } },
    ],
    { environmentId: testEnvironment.id, id: 'trace_declined', name: 'A demonstrated claim', before, after: await recorder.getState() },
  );
  const draft = induceContract(testEnvironment.create(), trace, {
    contractId: 'ec_declined',
    createdAt: '2026-10-01T09:00:00.000Z',
  }).contract;
  const contract = applyReview(draft, { confirmedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id) });
  return (await generateBenchmark(testEnvironment.create(), contract, [TEST_FIXTURE])).benchmark;
}

const declined = (suite: Benchmark) =>
  suite.cases.filter((entry) => entry.checks.some((check) => check.id === 'success__declined'));

describe('a case whose right answer is to decline', () => {
  it('holds the job’s own action to not having succeeded, from the call log', async () => {
    const suite = await benchmark();
    expect(declined(suite).length).toBeGreaterThan(0);
    for (const entry of declined(suite)) {
      const check = entry.checks.find((candidate) => candidate.id === 'success__declined__action_not_performed');
      expect(check, entry.name).toBeDefined();
      expect(check?.target).toBe('derived.events.occurred.fileClaim');
      expect(check?.expected).toBe(false);
      expect(check?.verificationSource).toBe('EVENT');
    }
  });

  it('fails an agent that performed the job anyway, and not one that declined', async () => {
    const suite = await benchmark();
    const ids = new Set(declined(suite).map((entry) => entry.id));
    const result = await runBenchmark(suite, [naiveAgent, carefulAgent]);

    const performedAnyway = result.caseResults.filter(
      (entry) =>
        ids.has(entry.caseId) &&
        entry.actions.some((action) => action.type === 'fileClaim' && action.ok),
    );
    expect(performedAnyway.length).toBeGreaterThan(0);
    for (const entry of performedAnyway) {
      const check = entry.assertions.find((a) => a.assertionId === 'success__declined__action_not_performed');
      expect(check?.status, `${entry.agentId} ${entry.caseName}`).toBe('FAIL');
      expect(entry.outcome).toBe('FAIL');
    }

    const didNot = result.caseResults.filter(
      (entry) => ids.has(entry.caseId) && !entry.actions.some((action) => action.type === 'fileClaim' && action.ok),
    );
    for (const entry of didNot) {
      const check = entry.assertions.find((a) => a.assertionId === 'success__declined__action_not_performed');
      expect(check?.status, `${entry.agentId} ${entry.caseName}`).toBe('PASS');
    }
  });
});
