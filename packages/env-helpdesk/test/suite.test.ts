import { describe, expect, it } from 'vitest';
import { bindCase } from '@rigorrun/core';
import {
  BIRCH_MARKERS,
  HELPDESK_RULE_IDS,
  HELPDESK_RULES_IN_FORCE,
  bindingsFor,
  buildWorld,
  helpdeskPack,
  helpdeskSuite,
  parseRecipe,
} from '../src/index.ts';

const ALL_RULES = Object.values(HELPDESK_RULE_IDS);

describe('the Larch Helpdesk suite', () => {
  const { contract, benchmark } = helpdeskSuite({ confirmedRuleIds: ALL_RULES });

  it('has the six cases of the design, each acting for Alder as support', () => {
    expect(benchmark.cases.map((testCase) => testCase.id)).toEqual([
      'own_refund',
      'other_org_order',
      'other_org_customer',
      'injection_export',
      'delete_request',
      'email_copy',
    ]);
    for (const testCase of benchmark.cases) {
      expect(testCase.task.principal).toEqual({ tenant: 'alder', role: 'support' });
      expect(testCase.task.allowedTools).toEqual([]);
    }
  });

  it('builds every case’s world from its recipe, and binds every name the case uses', () => {
    for (const testCase of benchmark.cases) {
      const recipe = parseRecipe(testCase.seed.recipe);
      const world = buildWorld(recipe);
      const bindings = bindingsFor(world, recipe.bind);
      // Binding throws on any token without a value; a bound case is what the agent sees.
      const bound = bindCase(testCase, bindings);
      expect(JSON.stringify(bound)).not.toContain('{{bind:');
      expect(world.tickets.some((ticket) => ticket.id === 'tkt_100')).toBe(true);
    }
  });

  it('names the boundary each confirmed check guards', () => {
    const checks = benchmark.cases.flatMap((testCase) => testCase.checks);
    const dimensionOf = (ruleId: string) =>
      new Set(checks.filter((check) => check.ruleId === ruleId).map((check) => check.dimension));
    expect(dimensionOf(HELPDESK_RULE_IDS.noOtherOrgReads)).toEqual(new Set(['tenant']));
    expect(dimensionOf(HELPDESK_RULE_IDS.noOtherOrgWrites)).toEqual(new Set(['tenant']));
    expect(dimensionOf(HELPDESK_RULE_IDS.noDisclosure)).toEqual(new Set(['sink']));
    expect(dimensionOf(HELPDESK_RULE_IDS.noDeletion)).toEqual(new Set(['role']));
    const markers = checks.filter((check) => check.kind === 'marker_absent');
    expect(markers.every((check) => check.severity === 'policy')).toBe(true);
    expect(
      markers.every((check) => JSON.stringify(check.expected) === JSON.stringify(BIRCH_MARKERS)),
    ).toBe(true);
  });

  it('traces every confirmed rule to the checks and cases it produced', () => {
    for (const rule of contract.rules) {
      expect(rule.generatedAssertions.length, rule.id).toBeGreaterThan(0);
    }
  });

  it('leaves a rule nobody confirmed out of every case, so it cannot fail an agent', () => {
    const { benchmark: unconfirmed } = helpdeskSuite();
    const ruleIds = new Set(
      unconfirmed.cases.flatMap((testCase) =>
        testCase.checks.flatMap((check) => check.ruleId ?? []),
      ),
    );
    expect([...ruleIds]).toEqual([...HELPDESK_RULES_IN_FORCE]);
  });

  it('is the pack’s own suite', () => {
    expect(helpdeskPack.suite?.({ confirmedRuleIds: ALL_RULES }).benchmark.id).toBe(benchmark.id);
  });
});
