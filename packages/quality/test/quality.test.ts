import { describe, expect, it } from 'vitest';
import { WORKFLOWS, compileWorkflow, type CompiledWorkflow } from '@rigorrun/environments';
import { createReferenceAgent } from '@rigorrun/generator';
import { naiveAgent } from '@rigorrun/agents';
import { assessBenchmark, checkIsolation, type BenchmarkQuality } from '@rigorrun/quality';

const cache = new Map<string, Promise<{ compiled: CompiledWorkflow; quality: BenchmarkQuality }>>();

function assess(key: string) {
  let entry = cache.get(key);
  if (!entry) {
    entry = (async () => {
      const definition = WORKFLOWS.find((w) => w.key === key)!;
      const compiled = await compileWorkflow(definition);
      const quality = await assessBenchmark({
        benchmark: compiled.benchmark,
        contract: compiled.contract,
        reference: createReferenceAgent(compiled.benchmark),
        naive: naiveAgent,
      });
      return { compiled, quality };
    })();
    cache.set(key, entry);
  }
  return entry;
}

describe('the benchmark is graded before any agent is', () => {
  for (const definition of WORKFLOWS) {
    describe(definition.key, () => {
      it('fails no implementation that follows the policy', async () => {
        // The single most important property. A suite that fails a correct
        // actor is not strict, it is broken, and every other number it
        // reports is meaningless.
        const { quality } = await assess(definition.key);
        const measure = quality.measures.find((m) => m.id === 'false_positive_rate');
        expect(measure?.value).toBe(0);
      });

      it('catches every injected defect that must be caught', async () => {
        const { quality } = await assess(definition.key);
        const missed = quality.mutants.filter(
          (mutant) => mutant.expectation === 'must_be_caught' && !mutant.caught,
        );
        // Idempotent work cannot be caught by repeating it, and that is a
        // property of the job rather than a weakness in the benchmark.
        for (const mutant of missed) expect(mutant.id).toBe('repeats_the_work');
        expect(quality.mutantKillRate).toBeGreaterThanOrEqual(0.75);
      });

      it('never fails an implementation for being over-careful', async () => {
        const { quality } = await assess(definition.key);
        const controls = quality.mutants.filter((m) => m.expectation === 'must_survive');
        expect(controls.length).toBeGreaterThan(0);
        expect(controls.every((mutant) => !mutant.caught)).toBe(true);
      });

      it('produces the same world twice from the same seed', async () => {
        const { quality } = await assess(definition.key);
        expect(quality.replayStable).toBe(true);
      });

      it('keeps the answer away from the agent', async () => {
        const { quality, compiled } = await assess(definition.key);
        expect(quality.hiddenAnswerIsolated).toBe(true);
        expect(checkIsolation(compiled.benchmark).ok).toBe(true);
      });

      it('has cases that tell a correct implementation from a careless one', async () => {
        const { quality } = await assess(definition.key);
        const measure = quality.measures.find((m) => m.id === 'case_discrimination');
        expect(Number(measure?.value)).toBeGreaterThan(0.4);
      });

      it('reports how well grounded its rules are, weakest evidence first', async () => {
        const { quality } = await assess(definition.key);
        const measure = quality.measures.find((m) => m.id === 'provenance_strength');
        expect(String(measure?.value)).toMatch(/strong/);
      });
    });
  }

  it('notices when the answer would leak through the policy wording', async () => {
    const { compiled } = await assess('refund');
    const tampered = {
      ...compiled.benchmark,
      cases: compiled.benchmark.cases.map((testCase, index) => ({
        ...testCase,
        task: {
          ...testCase.task,
          // A brief that differs per case could hint at the verdict without
          // any assertion ever leaking.
          policyBrief: `${testCase.task.policyBrief} (case ${index})`,
        },
      })),
    };
    const check = checkIsolation(tampered);
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('policy differs');
  });

  it('notices when a check target reaches the agent', async () => {
    const { compiled } = await assess('refund');
    const first = compiled.benchmark.cases[0]!;
    const tampered = {
      ...compiled.benchmark,
      cases: [
        {
          ...first,
          task: { ...first.task, instruction: `${first.task.instruction} ${first.checks[0]!.target}` },
        },
      ],
    };
    expect(checkIsolation(tampered).ok).toBe(false);
  });
});
