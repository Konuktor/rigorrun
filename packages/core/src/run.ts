/**
 * Run results — the immutable record of one benchmark execution.
 *
 * Cost is deliberately nullable. If a provider does not report enough
 * information to compute a real price, RigorRun stores `null` and the UI shows
 * "cost unavailable". Inventing a dollar figure would undermine the entire
 * point of the product.
 */
import { z } from 'zod';
import { RUN_SCHEMA_VERSION } from './versions.ts';
import { AssertionResultSchema, ObservedEventSchema } from './assertion.ts';
import { CaseCategorySchema } from './benchmark.ts';

export { RUN_SCHEMA_VERSION } from './versions.ts';

export const AgentStepSchema = z.object({
  index: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
  /** Tool the agent chose to call. */
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  /** Free-text reasoning the agent chose to expose. Never used for scoring. */
  note: z.string().optional(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const CaseResultSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  caseName: z.string(),
  category: CaseCategorySchema,
  agentId: z.string(),
  correlationId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number().nonnegative(),

  steps: z.array(AgentStepSchema).default([]),
  /** Everything the environment recorded actually happening. */
  actions: z.array(ObservedEventSchema).default([]),
  assertions: z.array(AssertionResultSchema).default([]),

  taskSuccess: z.boolean(),
  policyCompliant: z.boolean(),
  unsafeActions: z.number().int().nonnegative(),
  errored: z.boolean().default(false),
  error: z.string().optional(),

  usage: TokenUsageSchema.optional(),
  /** `null` means genuinely unknown, never zero-by-assumption. */
  costUsd: z.number().nullable().default(null),
  costNote: z.string().default('cost unavailable'),

  /** What the agent claimed. Shown next to reality; never scored. */
  agentReport: z.string().default(''),
  /** Hash of the post-execution world state, for reproducibility checks. */
  finalStateHash: z.string().default(''),
  /** A small, human-readable slice of final state for the evidence view. */
  finalStateSummary: z.record(z.string(), z.unknown()).default({}),
});
export type CaseResult = z.infer<typeof CaseResultSchema>;

export const WilsonIntervalSchema = z.object({
  point: z.number(),
  lower: z.number(),
  upper: z.number(),
  n: z.number().int().nonnegative(),
});
export type WilsonInterval = z.infer<typeof WilsonIntervalSchema>;

export const AgentScoreSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  n: z.number().int().nonnegative(),
  taskSuccessRate: z.number(),
  taskSuccessInterval: WilsonIntervalSchema,
  policyComplianceRate: z.number(),
  policyComplianceInterval: WilsonIntervalSchema,
  policyViolations: z.number().int().nonnegative(),
  unsafeActions: z.number().int().nonnegative(),
  errorRate: z.number(),
  avgLatencyMs: z.number(),
  medianLatencyMs: z.number(),
  p95LatencyMs: z.number(),
  avgSteps: z.number(),
  passAtK: z.record(z.string(), z.number()).default({}),
  totalCostUsd: z.number().nullable().default(null),
  costNote: z.string().default('cost unavailable'),
  thresholdsPassed: z.boolean(),
  failedThresholds: z.array(z.string()).default([]),
});
export type AgentScore = z.infer<typeof AgentScoreSchema>;

/**
 * How much the verdict below is worth, and why.
 *
 * These labels travel with every run for the same reason assertion results
 * carry `DETERMINISTIC` / `MODEL-JUDGED` / `HUMAN-REVIEW`: a reader must never
 * have to work out for themselves whether the machine actually checked. A run
 * against a system RigorRun could not read back is not a worse number, it is a
 * different kind of claim, and it is rendered as one.
 *
 * The strings match `@rigorrun/environment`'s capability model and are declared
 * here rather than imported because core owns the artefact schema and depends
 * on nothing. The runner maps one to the other in a single place.
 */
export const VERIFICATION_STRENGTHS = ['AUTHORITATIVE', 'PARTIAL', 'OBSERVATIONAL'] as const;
export type VerificationStrengthLabel = (typeof VERIFICATION_STRENGTHS)[number];

export const ISOLATION_LEVELS = ['RESET', 'PARTIAL', 'DECLARED', 'NONE'] as const;
export type IsolationLabel = (typeof ISOLATION_LEVELS)[number];

/** Something RigorRun could not do here, and what would have let it. */
export const RunLimitSchema = z.object({
  id: z.string(),
  limit: z.string(),
  remedy: z.string().default(''),
});
export type RunLimit = z.infer<typeof RunLimitSchema>;

export const RunResultSchema = z.object({
  schemaVersion: z.literal(RUN_SCHEMA_VERSION),
  runId: z.string(),
  benchmarkId: z.string(),
  benchmarkName: z.string(),
  benchmarkHash: z.string(),
  contractHash: z.string(),
  environment: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  agents: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })).default([]),
  caseResults: z.array(CaseResultSchema).default([]),
  scores: z.array(AgentScoreSchema).default([]),
  /** Winning agent id, or null when no agent met the thresholds. */
  verdict: z.object({
    winnerAgentId: z.string().nullable(),
    summary: z.string(),
    rationale: z.array(z.string()).default([]),
  }),
  /**
   * How the outcome was established.
   *
   * Defaulted so that runs recorded before this existed still parse; the
   * default is the strong value only because every environment that could
   * produce such a run was an in-process one that genuinely had it.
   */
  verification: z.enum(VERIFICATION_STRENGTHS).default('AUTHORITATIVE'),
  /** Whether each case started from the same place as the last one. */
  isolation: z.enum(ISOLATION_LEVELS).default('RESET'),
  /** What this environment stopped RigorRun from doing, and how to lift it. */
  limits: z.array(RunLimitSchema).default([]),
  /** Cases the generator could not build here, with a reason for each. */
  notTestable: z.array(z.object({ rule: z.string(), reason: z.string() })).default([]),
  /** Hash of this result, computed after the run is sealed. */
  resultHash: z.string().default(''),
  rigorrunVersion: z.string().default('0.1.0'),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export function parseRunResult(input: unknown): RunResult {
  return RunResultSchema.parse(input);
}
