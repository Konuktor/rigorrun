/**
 * LLM-assisted case generation.
 *
 * Hard rule: a model may propose *what to test*, never *how it is judged*.
 * Suggestions are constrained to (scenario, category, name, rationale) tuples
 * over scenarios that already exist, and the checks are still assembled
 * deterministically from the contract. A model cannot author an assertion, so
 * it cannot weaken the benchmark or leak an answer key into it.
 *
 * If no provider is configured, or the provider fails or runs out of quota,
 * this returns the deterministic benchmark unchanged. That is a normal
 * outcome, not an error.
 */
import { z } from 'zod';
import type { Benchmark, WorkflowContract } from '@rigorrun/core';
import { CASE_CATEGORIES } from '@rigorrun/core';
import { SCENARIOS } from '@rigorrun/northstar';
import { ProviderError, type LlmProvider } from '@rigorrun/providers';
import { generateBenchmark, type GenerateOptions } from './generate.ts';

const SuggestionSchema = z.object({
  scenarioId: z.string(),
  category: z.enum(CASE_CATEGORIES),
  name: z.string().min(1).max(120),
  rationale: z.string().min(1).max(400),
});

const SuggestionsSchema = z.object({ suggestions: z.array(SuggestionSchema).max(20) });

export interface LlmGenerateOptions extends GenerateOptions {
  provider: LlmProvider | null;
  /** Surfaced to the caller so the UI can say what actually happened. */
  onNote?: (note: string) => void;
}

export interface LlmGenerationResult {
  benchmark: Benchmark;
  usedLlm: boolean;
  note: string;
}

export async function generateWithLlm(
  contract: WorkflowContract,
  options: LlmGenerateOptions,
): Promise<LlmGenerationResult> {
  const benchmark = await generateBenchmark(contract, options);
  const { provider } = options;

  if (!provider) {
    const note = 'No LLM provider configured — used deterministic generation only.';
    options.onNote?.(note);
    return { benchmark, usedLlm: false, note };
  }

  try {
    const response = await provider.complete({
      timeoutMs: 30_000,
      messages: [
        {
          role: 'system',
          content:
            'You help design test coverage for a business workflow benchmark. You may only ' +
            'reference scenario ids from the provided list. You never write assertions. ' +
            'Reply with JSON only: {"suggestions":[{"scenarioId","category","name","rationale"}]}.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            goal: contract.goal,
            rules: contract.forbiddenActions.map((r) => r.rule),
            availableScenarioIds: SCENARIOS.map((s) => s.id),
            categories: CASE_CATEGORIES,
            alreadyCovered: benchmark.cases.map((c) => ({ id: c.id, category: c.category })),
          }),
        },
      ],
    });

    const parsed = SuggestionsSchema.safeParse(extractJson(response.text));
    if (!parsed.success) {
      const note = 'LLM response was not valid suggestion JSON — kept the deterministic benchmark.';
      options.onNote?.(note);
      return { benchmark, usedLlm: false, note };
    }

    const known = new Set(SCENARIOS.map((s) => s.id));
    const accepted = parsed.data.suggestions.filter((s) => known.has(s.scenarioId));
    const note =
      accepted.length === 0
        ? 'LLM suggested no new coverage — kept the deterministic benchmark.'
        : `LLM reviewed coverage and flagged ${accepted.length} scenario(s) worth emphasising: ` +
          accepted.map((s) => `${s.scenarioId} (${s.category})`).join(', ');
    options.onNote?.(note);

    return {
      benchmark: {
        ...benchmark,
        generator: accepted.length > 0 ? 'llm_assisted' : 'deterministic',
        description: `${benchmark.description} ${note}`,
      },
      usedLlm: accepted.length > 0,
      note,
    };
  } catch (error) {
    const kind = error instanceof ProviderError ? error.kind : 'http';
    const note =
      kind === 'quota'
        ? 'LLM quota exhausted — degraded to the deterministic benchmark instead of retrying.'
        : `LLM generation unavailable (${kind}) — used the deterministic benchmark.`;
    options.onNote?.(note);
    return { benchmark, usedLlm: false, note };
  }
}

/** Models like to wrap JSON in prose or fences; pull out the first object. */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
