import { describe, expect, it } from 'vitest';
import {
  applyReview,
  blockingRules,
  negate,
  parseEnvironmentContract,
  provenanceStrength,
  rulesAwaitingReview,
  unconfirmedRuleRatio,
  type ContractRule,
  type EnvironmentContract,
} from '@rigorrun/core';

function rule(overrides: Partial<ContractRule> & { id: string }): ContractRule {
  return {
    statement: 'a rule',
    template: 'relation_required',
    status: 'inferred',
    confidence: 0.6,
    provenance: [{ kind: 'state_delta', ref: 'd1', detail: '' }],
    implications: [],
    generatedAssertions: [`assert_${overrides.id}`],
    generatedCases: [],
    predicate: {
      kind: 'row_constraint',
      entity: 'Claim',
      scope: 'created',
      when: [],
      then: [{ field: 'permit__exists', op: 'eq', value: true, describe: 'a permit exists' }],
    },
    ...overrides,
  };
}

const CONTRACT: EnvironmentContract = {
  schemaVersion: 1,
  id: 'ec_1',
  name: 'A job',
  description: '',
  goal: 'Do the job',
  environmentId: 'demo',
  primaryAction: 'fileClaim',
  focusEntity: 'Claim',
  focusScope: 'created',
  remedyActions: [],
  projectionFocus: ['Claim'],
  completionActions: [],
  demonstratedArgs: {},
  observedFacts: [],
  rules: [
    rule({ id: 'observed_one', status: 'observed', confidence: 1 }),
    rule({ id: 'inferred_one' }),
    rule({ id: 'inferred_two' }),
  ],
  successAssertions: [],
  policyAssertions: [
    {
      id: 'assert_observed_one',
      kind: 'state_not_exists',
      description: 'x',
      target: 'derived.created.Claim[permit__exists=false]',
      severity: 'policy',
      evaluator: 'deterministic',
      unsafeIfFailed: true,
    },
    {
      id: 'assert_inferred_one',
      kind: 'state_not_exists',
      description: 'y',
      target: 'derived.created.Claim[permit__exists=false]',
      severity: 'policy',
      evaluator: 'deterministic',
      unsafeIfFailed: true,
    },
  ],
  createdAt: '2026-01-20T09:00:00.000Z',
};

describe('rule lifecycle', () => {
  it('parses', () => {
    expect(parseEnvironmentContract(CONTRACT).rules).toHaveLength(3);
  });

  it('only observed and confirmed rules may block a release', () => {
    expect(blockingRules(CONTRACT).map((r) => r.id)).toEqual(['observed_one']);
  });

  it('confirming a rule makes it blocking', () => {
    const reviewed = applyReview(CONTRACT, { confirmedRuleIds: ['inferred_one'] });
    expect(blockingRules(reviewed).map((r) => r.id)).toEqual(['observed_one', 'inferred_one']);
    expect(reviewed.rules.find((r) => r.id === 'inferred_one')?.confidence).toBe(1);
  });

  it('records the confirmation itself as provenance', () => {
    const reviewed = applyReview(CONTRACT, { confirmedRuleIds: ['inferred_one'] });
    const kinds = reviewed.rules.find((r) => r.id === 'inferred_one')?.provenance.map((p) => p.kind);
    expect(kinds).toContain('user_confirmation');
  });

  it('rejecting a rule drops the assertion behind it', () => {
    const reviewed = applyReview(CONTRACT, {
      confirmedRuleIds: [],
      rejectedRuleIds: ['inferred_one'],
    });
    expect(reviewed.policyAssertions.map((a) => a.id)).toEqual(['assert_observed_one']);
  });

  it('keeps a rejected rule on the record, because it is a negative control', () => {
    // A defect that violates a rejected rule must SURVIVE the benchmark.
    // Deleting the rule would throw away the only ground truth RigorRun has
    // that did not come from its own inference.
    const reviewed = applyReview(CONTRACT, {
      confirmedRuleIds: [],
      rejectedRuleIds: ['inferred_one'],
    });
    expect(reviewed.rules.map((r) => r.id)).toContain('inferred_one');
    expect(reviewed.rules.find((r) => r.id === 'inferred_one')?.status).toBe('rejected');
  });

  it('an untestable rule never blocks, however confirmed it is', () => {
    const withUntestable: EnvironmentContract = {
      ...CONTRACT,
      rules: [
        ...CONTRACT.rules,
        rule({
          id: 'enforced_by_env',
          status: 'confirmed',
          confidence: 1,
          untestable: { reason: 'the environment refuses the violation' },
        }),
      ],
    };
    expect(blockingRules(withUntestable).map((r) => r.id)).toEqual(['observed_one']);
  });

  it('reports how much human review is still outstanding', () => {
    expect(rulesAwaitingReview(CONTRACT)).toHaveLength(2);
    expect(unconfirmedRuleRatio(CONTRACT)).toBeCloseTo(2 / 3);
    const reviewed = applyReview(CONTRACT, {
      confirmedRuleIds: ['inferred_one', 'inferred_two'],
    });
    expect(unconfirmedRuleRatio(reviewed)).toBe(0);
  });

  it('reports provenance as a distribution, not a percentage', () => {
    const mixed: EnvironmentContract = {
      ...CONTRACT,
      rules: [
        rule({ id: 'strong', provenance: [{ kind: 'recorded_action', ref: '', detail: '' }] }),
        rule({ id: 'weak', provenance: [{ kind: 'ui_text', ref: '', detail: '$50 or less' }] }),
      ],
    };
    expect(provenanceStrength(mixed)).toEqual({ strong: 1, moderate: 0, weak: 1 });
  });

  it('applies an edit to a rule the reviewer changed rather than accepted', () => {
    const reviewed = applyReview(CONTRACT, {
      confirmedRuleIds: ['inferred_one'],
      edits: { inferred_one: { statement: 'the edited statement' } },
    });
    expect(reviewed.rules.find((r) => r.id === 'inferred_one')?.statement).toBe(
      'the edited statement',
    );
  });
});

describe('predicate negation', () => {
  it('turns a requirement into the shape of its violation', () => {
    expect(negate({ field: 'a', op: 'gt', value: 50, describe: '' })[0]?.op).toBe('lte');
    expect(negate({ field: 'a', op: 'exists', describe: '' })[0]).toEqual({
      field: 'a',
      op: 'eq',
      value: null,
      describe: '',
    });
  });

  it('expands "must be one of" into a conjunction of inequalities', () => {
    const negated = negate({ field: 's', op: 'in', value: ['a', 'b'], describe: '' });
    expect(negated).toEqual([
      { field: 's', op: 'ne', value: 'a', describe: '' },
      { field: 's', op: 'ne', value: 'b', describe: '' },
    ]);
  });
});
