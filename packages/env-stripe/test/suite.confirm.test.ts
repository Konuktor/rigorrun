/**
 * "Only the rules you confirm can fail your agent", held end to end.
 *
 * `stripe init` asks the owner about every rule of the policy, and promises
 * that a rule they did not confirm never fails their agent. The runner fails a
 * case on any check that fails, whatever the check is marked, so the promise
 * is kept by leaving such a rule's checks out of the suite altogether. Here
 * the pack builds each case's records over Stripe's API faked, reads them back
 * with its own reads, and the real runner decides — so what is checked is the
 * verdict, not a flag on a check.
 *
 * The agent refunds what the ticket asks and, besides, somebody else's payment
 * in nobody's case: the one thing `stripe.no_refund_outside_case` forbids.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseResult } from '@rigorrun/core';
import {
  PackEnvironment,
  clearEnvironments,
  registerEnvironment,
  type PackSession,
} from '@rigorrun/environment';
import type { AgentAdapter } from '@rigorrun/agents';
import { runBenchmark } from '@rigorrun/runner';
import {
  STRIPE_PACK_ID,
  STRIPE_RULE_IDS,
  openStripeSession,
  stripePack,
  stripeSuite,
} from '../src/index.ts';
import { FakeStripe } from './fakeStripe.ts';

const ALL_RULES: string[] = Object.values(STRIPE_RULE_IDS).filter(
  (id) => id !== STRIPE_RULE_IDS.escalateAboveThreshold,
);

let fake: FakeStripe;
let session: PackSession;
let runs = 0;

beforeAll(async () => {
  fake = new FakeStripe();
  session = await openStripeSession(
    { mode: 'twin', secret: () => 'sk_test_confirmations' },
    { fetch: fake.fetch, sleep: async () => {} },
  );
  clearEnvironments();
  registerEnvironment({
    id: STRIPE_PACK_ID,
    name: stripePack.name,
    description: stripePack.description,
    create: () => new PackEnvironment(stripePack, session),
    fixtures: [],
  });
});
afterAll(async () => {
  clearEnvironments();
  await session.close();
});

/** Refunds the $25.00 the ticket asks for, and somebody else's payment besides. */
const stray: AgentAdapter = {
  id: 'stray',
  name: 'stray',
  kind: 'blackbox',
  description: 'refunds the due amount, and a payment outside the case',
  async execute(input) {
    const inputs = input.task.inputs as Record<string, string>;
    fake.refund(inputs['payment']!, 2500);
    fake.refund(fake.outsider(5000).charge, 999);
    return { report: 'Refunded $25.00.', costUsd: 0, costNote: 'scripted' };
  },
};

async function fullRefund(confirmedRuleIds: readonly string[]): Promise<CaseResult> {
  const { benchmark } = stripeSuite({}, { confirmedRuleIds });
  runs += 1;
  const run = await runBenchmark(
    { ...benchmark, cases: benchmark.cases.filter((testCase) => testCase.id === 'full_refund') },
    [stray],
    { runId: `run_confirm_${runs}`, now: () => new Date('2026-10-01T12:00:00.000Z') },
  );
  return run.caseResults[0]!;
}

describe('a rule the owner did not confirm', () => {
  it('cannot fail the agent: its checks are not in the suite at all', async () => {
    const result = await fullRefund(
      ALL_RULES.filter((id) => id !== STRIPE_RULE_IDS.noRefundOutsideCase),
    );
    expect(result.outcome, result.outcomeReason).toBe('PASS');
    const ids = result.assertions.map((check) => check.assertionId);
    expect(ids).not.toContain('full_refund.no_refund_outside_case');
    expect(
      result.assertions.some((check) => check.ruleId === STRIPE_RULE_IDS.noRefundOutsideCase),
    ).toBe(false);
    // The case's own definition of done decided it, as it always does.
    expect(
      result.assertions.find((check) => check.assertionId === 'full_refund.refunded')?.status,
    ).toBe('PASS');
  });

  it('with no rule confirmed at all, leaves the verdict to the success checks', async () => {
    const result = await fullRefund([]);
    expect(result.outcome, result.outcomeReason).toBe('PASS');
    const ids = result.assertions.map((check) => check.assertionId);
    for (const unconfirmed of [
      'full_refund.no_refund_outside_case',
      'full_refund.one_refund_on_charge',
      'full_refund.amount_as_asked',
    ]) {
      expect(ids).not.toContain(unconfirmed);
    }
    expect(ids).toContain('full_refund.refunded');
  });

  it('fails the same agent once the owner confirms it', async () => {
    const result = await fullRefund(ALL_RULES);
    expect(result.outcome).toBe('FAIL');
    const outside = result.assertions.find(
      (check) => check.assertionId === 'full_refund.no_refund_outside_case',
    );
    expect(outside).toMatchObject({ status: 'FAIL', blocking: true, unsafe: true });
  });
});
