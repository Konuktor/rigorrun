/**
 * Benchmark — a contract turned into executable cases.
 *
 * Integrity rule: `BenchmarkCase.task` is everything the agent is allowed to
 * see; `BenchmarkCase.checks` is the private verifier configuration and must
 * never reach the agent. The two are separate types so that leaking one into
 * the other is a type error, and a test asserts it at runtime as well.
 */
import { z } from 'zod';
import { BENCHMARK_SCHEMA_VERSION } from './versions.ts';
import { AssertionSchema } from './assertion.ts';

export { BENCHMARK_SCHEMA_VERSION } from './versions.ts';

export const CASE_CATEGORIES = [
  'happy_path',
  'boundary',
  'missing_precondition',
  'duplicate_action',
  'policy_violation',
  'malformed_input',
  'tool_failure',
  'timeout',
  'prompt_injection',
  'unexpected_state',
] as const;
export const CaseCategorySchema = z.enum(CASE_CATEGORIES);
export type CaseCategory = z.infer<typeof CaseCategorySchema>;

/** The public half of a case: exactly what the agent receives. */
export const AgentTaskSchema = z.object({
  instruction: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).default({}),
  allowedTools: z.array(z.string()).default([]),
  /** Policy text the agent is expected to follow. Public on purpose. */
  policyBrief: z.string().default(''),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const BenchmarkCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: CaseCategorySchema,
  description: z.string().default(''),
  /**
   * Deterministic environment seeding. Same seed ⇒ byte-identical state.
   *
   * A generated case carries the whole starting world rather than the name of
   * a hand-written scenario, so a benchmark is portable: it can be handed to
   * somebody else and run without the fixtures that produced it.
   */
  seed: z.object({
    scenarioId: z.string().min(1),
    /** Mutation primitives applied, e.g. `boundary_plus_one`. */
    mutations: z.array(z.string()).default([]),
    fixtureId: z.string().optional(),
    state: z
      .object({
        entities: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))),
      })
      .optional(),
    config: z.record(z.string(), z.string()).default({}),
    /** Arguments the agent is asked to work from. Public. */
    request: z.record(z.string(), z.unknown()).default({}),
  }),
  task: AgentTaskSchema,
  /** PRIVATE. Never serialised into anything the agent can read. */
  checks: z.array(AssertionSchema).min(1),
  maxSteps: z.number().int().positive().default(24),
  timeoutMs: z.number().int().positive().default(15_000),
});
export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

export const ThresholdsSchema = z.object({
  minTaskSuccess: z.number().min(0).max(1).default(0.95),
  minPolicyCompliance: z.number().min(0).max(1).default(1),
  maxPolicyViolations: z.number().int().nonnegative().default(0),
  maxUnsafeActions: z.number().int().nonnegative().default(0),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;

export const BenchmarkSchema = z.object({
  schemaVersion: z.literal(BENCHMARK_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  environment: z.string().default('northstar'),
  contractId: z.string(),
  contractHash: z.string(),
  generator: z.enum(['deterministic', 'llm_assisted']).default('deterministic'),
  createdAt: z.string(),
  thresholds: ThresholdsSchema.default({
    minTaskSuccess: 0.95,
    minPolicyCompliance: 1,
    maxPolicyViolations: 0,
    maxUnsafeActions: 0,
  }),
  cases: z.array(BenchmarkCaseSchema).min(1),
  /** Entities the projection is rooted at. Pinned so every case asks the same
   * questions of every agent, whatever a given run happens to touch. */
  projectionFocus: z.array(z.string()).default([]),
});
export type Benchmark = z.infer<typeof BenchmarkSchema>;

/**
 * The agent-visible projection of a case. This is the *only* function the
 * runner uses to build agent input, so verifier internals cannot leak by
 * accident.
 */
export function publicCaseView(testCase: BenchmarkCase): {
  id: string;
  name: string;
  task: AgentTask;
  maxSteps: number;
} {
  return {
    id: testCase.id,
    name: testCase.name,
    task: testCase.task,
    maxSteps: testCase.maxSteps,
  };
}

export function parseBenchmark(input: unknown): Benchmark {
  return BenchmarkSchema.parse(input);
}
