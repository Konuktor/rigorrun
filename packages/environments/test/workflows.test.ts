import { describe, expect, it } from 'vitest';
import { blockingRules, publicCaseView } from '@rigorrun/core';
import { validateAdapter } from '@rigorrun/environment';
import { WORKFLOWS, compileWorkflow, type CompiledWorkflow } from '@rigorrun/environments';

/**
 * One compiler, five jobs.
 *
 * Everything asserted here is asserted the same way for every workflow. A
 * branch on `workflow.key` in this file would be the first sign that the
 * generalisation claim had quietly stopped being true.
 */
const compiled = new Map<string, Promise<CompiledWorkflow>>();
function workflow(key: string): Promise<CompiledWorkflow> {
  const found = WORKFLOWS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no workflow ${key}`);
  let entry = compiled.get(key);
  if (!entry) {
    entry = compileWorkflow(found);
    compiled.set(key, entry);
  }
  return entry;
}

describe('the five demo workflows', () => {
  it('are five materially different jobs', () => {
    expect(WORKFLOWS.map((w) => w.key).sort()).toEqual([
      'access',
      'fulfillment',
      'invoice',
      'lead',
      'refund',
    ]);
    expect(new Set(WORKFLOWS.map((w) => w.discipline)).size).toBe(5);
    expect(new Set(WORKFLOWS.map((w) => w.registration.id)).size).toBe(5);
  });

  for (const definition of WORKFLOWS) {
    describe(definition.key, () => {
      it('declares a schema the SDK accepts', async () => {
        const problems = await validateAdapter(
          () => definition.registration.create(),
          definition.registration.fixtures,
        );
        expect(problems).toEqual([]);
      });

      it('compiles a contract from one demonstration', async () => {
        const { contract, draft } = await workflow(definition.key);
        expect(contract.environmentId).toBe(definition.registration.id);
        expect(contract.observedFacts.length).toBeGreaterThan(0);
        // Everything a template proposes is a generalisation. Only the facts
        // in the delta are observed.
        expect(draft.rules.every((rule) => rule.status === 'inferred')).toBe(true);
        expect(contract.rules.length).toBeGreaterThanOrEqual(5);
      });

      it('gives every rule provenance and a question a person can answer', async () => {
        const { draft } = await workflow(definition.key);
        for (const rule of draft.rules) {
          expect(rule.provenance.length).toBeGreaterThan(0);
          expect(rule.question?.text.endsWith('?')).toBe(true);
          expect(rule.question?.reason.length).toBeGreaterThan(0);
        }
      });

      it('generates cases from mutations, with both outcomes represented', async () => {
        const { generation } = await workflow(definition.key);
        expect(generation.benchmark.cases.length).toBeGreaterThanOrEqual(8);
        const proceed = generation.cases.filter((c) => c.expected.shouldPerform);
        const refuse = generation.cases.filter((c) => !c.expected.shouldPerform);
        expect(proceed.length).toBeGreaterThan(0);
        expect(refuse.length).toBeGreaterThan(0);
      });

      it('reports no contradiction and no rule it could not compile', async () => {
        const { generation } = await workflow(definition.key);
        expect(generation.conflicts).toEqual([]);
        expect(generation.problems).toEqual([]);
      });

      it('expects the demonstrated job itself to be permitted', async () => {
        // If the confirmed rules refuse the very work the operator just did,
        // the contract contradicts its own evidence.
        const { generation } = await workflow(definition.key);
        const happy = generation.cases.find((c) => c.testCase.category === 'happy_path');
        expect(happy?.expected.shouldPerform).toBe(true);
      });

      it('keeps the answer out of what the agent is shown', async () => {
        const { generation } = await workflow(definition.key);
        const briefs = new Set(generation.cases.map((c) => c.testCase.task.policyBrief));
        expect(briefs.size).toBe(1);
        for (const entry of generation.cases) {
          const visible = JSON.stringify(publicCaseView(entry.testCase));
          for (const check of entry.testCase.checks) {
            expect(visible).not.toContain(check.target);
          }
          expect(visible).not.toContain('derived.');
        }
      });

      it('only lets confirmed rules block a release', async () => {
        const { draft, contract } = await workflow(definition.key);
        expect(blockingRules(draft)).toEqual([]);
        expect(blockingRules(contract).length).toBe(contract.rules.length);
      });

      it('produces a benchmark in well under a minute', async () => {
        const { timings } = await workflow(definition.key);
        expect(timings.total).toBeLessThan(60_000);
      });
    });
  }

  it('finds a comparable amount of policy in each of them', async () => {
    // Not a coverage claim: a check that no workflow is quietly getting a
    // richer contract than the others because something was special-cased.
    const counts = await Promise.all(
      WORKFLOWS.map(async (definition) => (await workflow(definition.key)).contract.rules.length),
    );
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(5);
  });

  it('exercises every template across the five, without any one workflow needing all of them', async () => {
    const templates = new Set<string>();
    for (const definition of WORKFLOWS) {
      const { contract } = await workflow(definition.key);
      for (const rule of contract.rules) templates.add(rule.template);
    }
    expect([...templates].sort()).toEqual([
      'action_order',
      'condition_guard',
      'field_populated',
      'field_relation',
      'path_agreement',
      'relation_required',
      'side_effect',
      'target_state',
      'threshold_guard',
      'transition_allowed',
      'uniqueness',
    ]);
  });
});
