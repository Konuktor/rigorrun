import { describe, expect, it } from 'vitest';
import {
  filterBodies,
  splitClauses,
  applyReview,
  blockingRules,
  fromActionLog,
  rulesAwaitingReview,
  type CanonicalHumanTrace,
  type EnvironmentContract,
} from '@rigorrun/core';
import { buildProjection, type CanonicalState } from '@rigorrun/environment';
import { resolvePath, verify } from '@rigorrun/verifier';
import { induceContract, synthesizeAssertions } from '@rigorrun/compiler';
import { TEST_FIXTURE, TEST_SCHEMA, testEnvironment } from '../../environment/test/support.ts';

/** The policy banner the operator could see while doing the work. */
const BANNER = 'Claims of $50 or less need no approval. Above that, a permit is required.';

/**
 * One recorded demonstration: ask for a permit, file a claim within policy
 * against an item the account owns, and write it to the log.
 */
async function demonstrate(): Promise<{ trace: CanonicalHumanTrace; after: CanonicalState }> {
  const env = testEnvironment.create();
  await env.seed(TEST_FIXTURE.state, TEST_FIXTURE.config);
  const before = await env.getState();

  await env.executeAction('requestPermit', { itemId: 'ITM-1' });
  await env.executeAction('fileClaim', {
    accountId: 'ACC-1',
    itemId: 'ITM-1',
    amount: 30,
    permitId: 'PRM-9001',
  });
  await env.executeAction('writeLog', { action: 'filed', detail: 'claim CLM-9001 filed' });
  const after = await env.getState();

  const trace = fromActionLog(
    [
      { at: 0, action: 'requestPermit', args: { itemId: 'ITM-1' }, surfaceText: [BANNER] },
      {
        at: 1000,
        action: 'fileClaim',
        args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30, permitId: 'PRM-9001' },
        surfaceText: [BANNER],
      },
      { at: 2000, action: 'writeLog', args: { action: 'filed', detail: 'claim CLM-9001 filed' } },
    ],
    {
      environmentId: 'sdk-test',
      id: 'trace_sdk',
      name: 'A demonstrated claim',
      before,
      after,
    },
  );
  return { trace, after };
}

async function compile(): Promise<EnvironmentContract> {
  const { trace } = await demonstrate();
  return induceContract(testEnvironment.create(), trace, {
    contractId: 'ec_test',
    createdAt: '2026-01-20T09:00:00.000Z',
  }).contract;
}

describe('induction from a demonstration', () => {
  it('records what changed as observed fact, separately from any rule', async () => {
    const contract = await compile();
    expect(contract.observedFacts.map((fact) => fact.statement)).toEqual([
      'Claim CLM-9001 was created',
      'LogEntry LOG-9001 was created',
      'Permit PRM-9001 was created',
    ]);
    // Nothing observed is a policy. Every rule is a generalisation.
    expect(contract.rules.every((rule) => rule.status === 'inferred')).toBe(true);
  });

  it('proposes rules from the schema and the delta, never from a word list', async () => {
    const contract = await compile();
    const templates = [...new Set(contract.rules.map((rule) => rule.template))].sort();
    expect(templates).toEqual([
      'action_order',
      'field_populated',
      'field_relation',
      'path_agreement',
      'side_effect',
      'target_state',
      'threshold_guard',
      'uniqueness',
    ]);
  });

  it('reads a threshold out of interface text and files it as the weakest evidence', async () => {
    const contract = await compile();
    const rule = contract.rules.find((r) => r.template === 'threshold_guard');
    expect(rule?.statement).toContain('$50');
    expect(rule?.provenance.map((p) => p.kind)).toContain('ui_text');
    expect(rule?.question?.reason).toContain('text on a page');
  });

  it('notices that two paths reaching the same account agreed', async () => {
    const contract = await compile();
    const rule = contract.rules.find((r) => r.template === 'path_agreement');
    expect(rule?.predicate).toMatchObject({
      kind: 'row_constraint',
      entity: 'Claim',
      then: [{ field: 'agrees__accountId__vs__item__accountId', op: 'eq', value: true }],
    });
  });

  it('does not also demand the link a threshold rule already accounts for', async () => {
    // The operator obtained a permit while filing a claim. That is evidence
    // for "above the limit you need a permit", not for "you always need one" —
    // and emitting both would fail every small claim for a reason the
    // recording never showed.
    const contract = await compile();
    expect(contract.rules.filter((rule) => rule.template === 'relation_required')).toEqual([]);
    expect(contract.rules.some((rule) => rule.template === 'threshold_guard')).toBe(true);
  });

  it('leads the uniqueness question with the counterexample that would break it', async () => {
    const contract = await compile();
    const rule = contract.rules.find((r) => r.template === 'uniqueness');
    expect(rule?.question?.counterexample).toContain('partial');
    expect(rule?.confidence).toBeLessThan(0.5);
  });

  it('asks questions a person can answer without knowing any eval vocabulary', async () => {
    const contract = await compile();
    const questions = contract.rules.map((rule) => rule.question?.text ?? '');
    expect(questions.every((q) => q.endsWith('?'))).toBe(true);
    const jargon = /assertion|scorer|rubric|dataset|JSONPath|predicate|derived\./i;
    expect(questions.filter((q) => jargon.test(q))).toEqual([]);
  });

  it('refuses to compile a recording that changed nothing', async () => {
    const empty = fromActionLog([{ at: 0, action: 'getItem', args: { itemId: 'ITM-1' } }], {
      environmentId: 'sdk-test',
      id: 't',
      name: 'nothing happened',
      before: TEST_FIXTURE.state,
      after: TEST_FIXTURE.state,
    });
    expect(() => induceContract(testEnvironment.create(), empty)).toThrow(
      /no action that changes the system/,
    );
  });
});

describe('verifier synthesis', () => {
  async function synthesise(contract: EnvironmentContract) {
    const { after } = await demonstrate();
    const { keys } = buildProjection(TEST_SCHEMA, {
      seed: TEST_FIXTURE.state,
      final: after,
      focus: contract.projectionFocus,
      knownEventTypes: testEnvironment
        .create()
        .getActions()
        .filter((action) => !action.readOnly)
        .map((action) => action.name),
    });
    const bindings = { itemId: 'ITM-1', accountId: 'ACC-1', permitId: 'PRM-9001' };
    return { result: synthesizeAssertions(contract, keys, { bindings }), keys };
  }

  it('compiles every rule into typed assertions with nothing left over', async () => {
    const contract = await compile();
    const { result } = await synthesise(contract);
    expect(result.problems).toEqual([]);
    expect(result.assertions.length).toBeGreaterThan(0);
    expect(result.assertions.every((a) => a.ruleId !== undefined)).toBe(true);
  });

  it('marks unconfirmed rules non-blocking, and confirmation makes them block', async () => {
    const contract = await compile();
    const before = await synthesise(contract);
    expect(before.result.assertions.every((a) => a.blocking === false)).toBe(true);

    const confirmed = applyReview(contract, {
      confirmedRuleIds: rulesAwaitingReview(contract).map((rule) => rule.id),
    });
    const after = await synthesise(confirmed);
    expect(after.result.assertions.every((a) => a.blocking === true)).toBe(true);
    expect(blockingRules(confirmed).length).toBe(contract.rules.length);
  });

  it('counts what the agent created for a scope rule, and does not gate it on itself', async () => {
    // The environment's own declaration says writeLog touches LogEntry and
    // the job never did, so "must not create a log entry" is observed. It
    // used to count the total and then require the total to be within the
    // limit before applying — inapplicable in exactly the run that broke it.
    const contract = await compile();
    const created: EnvironmentContract = {
      ...contract,
      rules: [
        {
          ...contract.rules[0]!,
          id: 'rule_no_log',
          status: 'observed',
          predicate: { kind: 'count_constraint', entity: 'LogEntry', scope: 'created', groupBy: [], where: [], max: 0 },
        },
        {
          ...contract.rules[0]!,
          id: 'rule_few_logs',
          status: 'observed',
          predicate: { kind: 'count_constraint', entity: 'LogEntry', scope: 'all', groupBy: [], where: [], max: 5 },
        },
      ],
    };
    const { result } = await synthesise(created);
    const noLog = result.assertions.find((a) => a.ruleId === 'rule_no_log')!;
    expect(noLog.target).toBe('derived.count.LogEntry.created');
    expect(noLog.applicableWhen).toBeUndefined();
    const fewLogs = result.assertions.find((a) => a.ruleId === 'rule_few_logs')!;
    expect(fewLogs.target).toBe('derived.count.LogEntry.total');
    expect(fewLogs.applicableWhen).toEqual({ kind: 'numeric_lte', target: 'derived.seed.LogEntry.length', expected: 5 });
  });

  it('refuses a path the projection cannot answer instead of letting it pass', async () => {
    const contract = await compile();
    const broken: EnvironmentContract = {
      ...contract,
      rules: [
        {
          ...contract.rules[0]!,
          id: 'rule_broken',
          predicate: {
            kind: 'row_constraint',
            entity: 'Claim',
            scope: 'created',
            when: [],
            then: [{ field: 'amonut', op: 'gt', value: 1, describe: '' }],
          },
        },
      ],
    };
    const { result } = await synthesise(broken);
    expect(result.assertions).toEqual([]);
    expect(result.problems[0]?.message).toContain('amonut');
  });

  it('writes an outsider-authored value into a filter path only as one opaque value', async () => {
    // It used to refuse such values outright, which also meant a subject with
    // a space in it could never be checked. Now the value is quoted, and the
    // property that matters is tested directly: it cannot add a clause, close
    // the filter early, or match anything but itself.
    const contract = await compile();
    const hostileValue = 'x] & amount>0 & [y';
    const hostile: EnvironmentContract = {
      ...contract,
      rules: [
        {
          ...contract.rules[0]!,
          id: 'rule_injection',
          predicate: {
            kind: 'row_constraint',
            entity: 'Claim',
            scope: 'created',
            when: [],
            then: [
              {
                field: 'filedBy',
                op: 'eq',
                // Exactly the shape our own injection mutation writes.
                value: hostileValue,
                describe: '',
              },
            ],
          },
        },
      ],
    };
    const { result } = await synthesise(hostile);
    expect(result.problems).toEqual([]);
    expect(result.assertions.length).toBeGreaterThan(0);

    const paths = result.assertions.flatMap((assertion) =>
      [assertion.target, assertion.orElse?.target, assertion.applicableWhen?.target].filter(
        (path): path is string => typeof path === 'string',
      ),
    );
    const clauses = paths.flatMap((path) => filterBodies(path).flatMap((body) => splitClauses(body)));
    const carrying = clauses.filter((clause) => clause.includes(JSON.stringify(hostileValue)));
    expect(carrying.length).toBeGreaterThan(0);
    // No clause about amount was smuggled in by the value.
    expect(clauses.some((clause) => /^\s*amount/.test(clause))).toBe(false);

    // And the clause means exactly that string.
    for (const clause of carrying) {
      const rows = [{ filedBy: hostileValue }, { filedBy: 'x' }, { filedBy: 'y', amount: 1 }];
      const matched = resolvePath({ rows }, `rows[${clause.trim()}]`).value as unknown[];
      const expected = /^\s*filedBy\s*!=/.test(clause) ? 2 : 1;
      expect(matched).toHaveLength(expected);
    }
  });
});

describe('what the demonstration says the record must carry', () => {
  it('binds record fields to the arguments that produced them, by value alone', async () => {
    const contract = await compile();
    expect(contract.argumentBindings.map((b) => [b.field, b.param, b.mode])).toEqual([
      ['accountId', 'accountId', 'equals'],
      ['amount', 'amount', 'equals'],
      ['itemId', 'itemId', 'equals'],
      ['permitId', 'permitId', 'equals'],
    ]);
    // Never the identifier, and never a value the system chose for itself.
    const bound = contract.argumentBindings.map((b) => b.field);
    expect(bound).not.toContain('claimId');
    expect(bound).not.toContain('filedBy');
    expect(contract.expectedDeltaCount).toBe(1);
  });

  it('uses the goal the person stated, and the tool description only as a fallback', async () => {
    const { trace } = await demonstrate();
    const stated = induceContract(testEnvironment.create(), trace, {
      goal: 'File the claim the customer asked for.',
    }).contract;
    expect(stated.goal).toBe('File the claim the customer asked for');
    const fallback = induceContract(testEnvironment.create(), trace, {}).contract;
    expect(fallback.goal).toBe('File a claim against an item');
  });

  it('ignores a call that changed nothing when deciding what the job was and what it was given', async () => {
    const { trace } = await demonstrate();
    // The same recording with one more call of a tool that can write, which
    // this time wrote nothing — the shape of a read-back through a
    // dual-purpose tool.
    const extended: CanonicalHumanTrace = {
      ...trace,
      steps: [
        ...trace.steps,
        {
          id: 'step_999',
          ordinal: trace.steps.length,
          at: 9_999,
          kind: 'action',
          action: { name: 'requestPermit', args: { itemId: 'ITM-2' }, ok: true, changedState: false },
          surfaceText: [],
        },
      ],
    };
    const contract = induceContract(testEnvironment.create(), extended, {}).contract;
    // Unmarked steps are "could not tell" and stay; only the marked no-op goes,
    // and only because another step was marked as having changed something.
    const marked: CanonicalHumanTrace = {
      ...extended,
      steps: extended.steps.map((step) =>
        step.action && step.action.changedState === undefined
          ? { ...step, action: { ...step.action, changedState: true } }
          : step,
      ),
    };
    const fromMarked = induceContract(testEnvironment.create(), marked, {}).contract;
    expect(fromMarked.primaryAction).toBe('fileClaim');
    expect(fromMarked.demonstratedArgs['requestPermit']).toEqual({ itemId: 'ITM-1' });
    expect(fromMarked.completionActions).not.toContain('requestPermit');
    void contract;
  });

  it('keeps every step when the recorder never saw anything change', async () => {
    // A system read back in prose, or a browser: every call is "changed
    // nothing" because nothing could be seen. That is "could not tell", and
    // the job must not be dropped for it.
    const { trace } = await demonstrate();
    const blind: CanonicalHumanTrace = {
      ...trace,
      steps: trace.steps.map((step) =>
        step.action ? { ...step, action: { ...step.action, changedState: false } } : step,
      ),
    };
    const contract = induceContract(testEnvironment.create(), blind, {}).contract;
    expect(contract.primaryAction).toBe('fileClaim');
    expect(contract.remedyActions).toContain('requestPermit');
  });
});

describe('the synthesised benchmark actually discriminates', () => {
  async function runAgainst(
    contract: EnvironmentContract,
    play: (env: ReturnType<typeof testEnvironment.create>) => Promise<void>,
  ) {
    const env = testEnvironment.create();
    await env.seed(TEST_FIXTURE.state, TEST_FIXTURE.config);
    const seed = await env.getState();
    await play(env);
    const { derived, keys } = buildProjection(TEST_SCHEMA, {
      seed,
      final: await env.getState(),
      events: await env.getEvents(),
      focus: contract.projectionFocus,
      knownEventTypes: env.getActions().filter((a) => !a.readOnly).map((a) => a.name),
    });
    const { assertions } = synthesizeAssertions(contract, keys, {
      bindings: { itemId: 'ITM-1', accountId: 'ACC-1', permitId: 'PRM-9001' },
    });
    return verify(assertions, { state: {}, derived, events: [] });
  }

  async function confirmedContract(): Promise<EnvironmentContract> {
    const contract = await compile();
    const synthesised = applyReview(contract, {
      confirmedRuleIds: rulesAwaitingReview(contract).map((rule) => rule.id),
    });
    return synthesised;
  }

  it('passes an agent that repeats the demonstrated work', async () => {
    const contract = await confirmedContract();
    const summary = await runAgainst(contract, async (env) => {
      await env.executeAction('requestPermit', { itemId: 'ITM-1' });
      await env.executeAction('fileClaim', {
        accountId: 'ACC-1',
        itemId: 'ITM-1',
        amount: 30,
        permitId: 'PRM-9001',
      });
      await env.executeAction('writeLog', { action: 'filed', detail: 'claim CLM-9001 filed' });
    });
    expect(summary.results.filter((r) => r.status === 'FAIL')).toEqual([]);
    expect(summary.policyCompliant).toBe(true);
  });

  it('fails an agent that acts on a record belonging to somebody else', async () => {
    const contract = await confirmedContract();
    const summary = await runAgainst(contract, async (env) => {
      await env.executeAction('requestPermit', { itemId: 'ITM-1' });
      // ITM-1 belongs to ACC-1, not ACC-2.
      await env.executeAction('fileClaim', {
        accountId: 'ACC-2',
        itemId: 'ITM-1',
        amount: 30,
        permitId: 'PRM-9001',
      });
      await env.executeAction('writeLog', { action: 'filed', detail: 'claim CLM-9001 filed' });
    });
    const failed = summary.results.filter((r) => r.status === 'FAIL');
    expect(failed.map((r) => r.ruleId)).toContain(
      'rule_path_agreement__accountId__vs__item__accountId',
    );
    expect(summary.criticalFailures).toBeGreaterThan(0);
  });

  it('fails an agent that goes over the threshold without the guard', async () => {
    const contract = await confirmedContract();
    const summary = await runAgainst(contract, async (env) => {
      await env.executeAction('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 500 });
      await env.executeAction('writeLog', { action: 'filed', detail: 'claim CLM-9001 filed' });
    });
    const failedRules = summary.results.filter((r) => r.status === 'FAIL').map((r) => r.ruleId);
    expect(failedRules.some((id) => id?.startsWith('rule_threshold_guard'))).toBe(true);
  });

  it('fails an agent that does the work but records nothing', async () => {
    const contract = await confirmedContract();
    const summary = await runAgainst(contract, async (env) => {
      await env.executeAction('requestPermit', { itemId: 'ITM-1' });
      await env.executeAction('fileClaim', {
        accountId: 'ACC-1',
        itemId: 'ITM-1',
        amount: 30,
        permitId: 'PRM-9001',
      });
    });
    const failedRules = summary.results.filter((r) => r.status === 'FAIL').map((r) => r.ruleId);
    expect(failedRules).toContain('rule_side_effect__LogEntry__Claim');
  });

  it('reports a rule as inapplicable rather than passed when nothing exercises it', async () => {
    const contract = await confirmedContract();
    // The agent does nothing at all. Every row rule is inapplicable, and none
    // of them may be counted as a pass.
    const summary = await runAgainst(contract, async () => {});
    expect(summary.results.some((r) => r.status === 'INAPPLICABLE')).toBe(true);
    expect(summary.results.filter((r) => r.status === 'PASS' && r.ruleId?.includes('path_agreement'))).toEqual([]);
  });

  it('rejecting a rule stops it failing anyone', async () => {
    const contract = await compile();
    const reviewed = applyReview(contract, {
      confirmedRuleIds: rulesAwaitingReview(contract)
        .map((rule) => rule.id)
        .filter((id) => !id.startsWith('rule_path_agreement')),
      rejectedRuleIds: rulesAwaitingReview(contract)
        .map((rule) => rule.id)
        .filter((id) => id.startsWith('rule_path_agreement')),
    });
    const summary = await runAgainst(reviewed, async (env) => {
      await env.executeAction('requestPermit', { itemId: 'ITM-1' });
      await env.executeAction('fileClaim', {
        accountId: 'ACC-2',
        itemId: 'ITM-1',
        amount: 30,
        permitId: 'PRM-9001',
      });
      await env.executeAction('writeLog', { action: 'filed', detail: 'claim CLM-9001 filed' });
    });
    const failedRules = summary.results.filter((r) => r.status === 'FAIL').map((r) => r.ruleId);
    expect(failedRules.some((id) => id?.startsWith('rule_path_agreement'))).toBe(false);
  });
});
