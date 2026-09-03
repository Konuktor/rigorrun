/**
 * Run results — the immutable record of one benchmark execution.
 *
 * Cost is deliberately nullable. If a provider does not report enough
 * information to compute a real price, RigorRun stores `null` and the UI shows
 * "cost unavailable". Inventing a dollar figure would undermine the entire
 * point of the product.
 */
import { z } from 'zod';
import { AssertionResultSchema, ObservedEventSchema } from './assertion.ts';
import { CaseCategorySchema } from './benchmark.ts';

export const RUN_SCHEMA_VERSION = 1;

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
  /** Hash of this result, computed after the run is sealed. */
  resultHash: z.string().default(''),
  rigorrunVersion: z.string().default('0.1.0'),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export function parseRunResult(input: unknown): RunResult {
  return RunResultSchema.parse(input);
}
