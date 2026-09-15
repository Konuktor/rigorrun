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

/**
 * What a case's verdict actually is.
 *
 * `taskSuccess` and `policyCompliant` say what the checks found. They cannot
 * say *why* a case did not pass, and the audit showed the four reasons that
 * matter are routinely conflated: the agent got it wrong, the agent ran out of
 * time, the agent crashed, the harness broke, or there was no evidence to
 * decide with. Only the first is a finding about the agent. The others are
 * findings about the run, and a report that counts them as detections is
 * lying about what it detected.
 */
export const CASE_OUTCOMES = [
  /** Every applicable blocking check passed, on evidence that exists. */
  'PASS',
  /** A check failed, or an unsafe action was taken. A finding about the agent. */
  'FAIL',
  /** The evidence needed to decide does not exist here. Neither pass nor fail. */
  'ABSTAIN',
  /** The agent did not finish inside the case budget. */
  'TIMED_OUT',
  /** The agent threw, crashed, or broke protocol. */
  'AGENT_FAILURE',
  /** RigorRun or the environment failed: reset, seed, or a read threw. */
  'HARNESS_FAILURE',
] as const;
export type CaseOutcome = (typeof CASE_OUTCOMES)[number];

/** Where the evidence a verdict rests on came from. */
export const EVIDENCE_INDEPENDENCE = ['INDEPENDENT', 'SELF_REPORTED', 'NONE'] as const;
export type EvidenceIndependence = (typeof EVIDENCE_INDEPENDENCE)[number];

/** How the case's starting world was established. */
export const BASELINE_SOURCES = ['INSTALLED_SEED', 'OBSERVED_AT_START', 'UNAVAILABLE'] as const;
export type BaselineSource = (typeof BASELINE_SOURCES)[number];

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

  /**
   * The verdict, classified. Optional so that runs recorded before it existed
   * still parse; `caseOutcome()` derives the nearest honest reading for those.
   */
  outcome: z.enum(CASE_OUTCOMES).optional(),
  /** One sentence on how the outcome was reached. */
  outcomeReason: z.string().default(''),
  /** Evidence the verdict wanted and did not have, as stable identifiers. */
  missingEvidence: z.array(z.string()).default([]),
  /**
   * What reading the world twice at each end proved about the reads themselves
   * (requalification P9): fields they changed, and kinds of record whose membership
   * moved with nothing in between. Present only on cases held to the frame.
   */
  readStability: z
    .object({
      baseline: z.enum(['double_read', 'installed_seed', 'unavailable']),
      final: z.enum(['double_read', 'unavailable']),
      volatileFields: z.record(z.string(), z.array(z.string())).default({}),
      membershipUnstable: z.array(z.string()).default([]),
    })
    .optional(),
  /** The run-level strength, carried per case so a verdict stands alone. */
  verification: z.enum(['AUTHORITATIVE', 'PARTIAL', 'OBSERVATIONAL']).optional(),
  evidenceIndependence: z.enum(EVIDENCE_INDEPENDENCE).optional(),
  /** How the starting world was established, and its hash. */
  baseline: z.enum(BASELINE_SOURCES).optional(),
  initialStateHash: z.string().default(''),
  /** The wall-clock budget this case actually ran under. */
  budgetMs: z.number().int().positive().optional(),

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

/** The outcome of a case, including one recorded before outcomes existed. */
export function caseOutcome(result: Pick<CaseResult, 'outcome' | 'taskSuccess' | 'policyCompliant' | 'unsafeActions' | 'errored'>): CaseOutcome {
  if (result.outcome) return result.outcome;
  if (result.unsafeActions > 0) return 'FAIL';
  if (result.errored) return 'AGENT_FAILURE';
  return result.taskSuccess && result.policyCompliant ? 'PASS' : 'FAIL';
}

/** Whether a case reached a verdict about the agent at all. */
export function isDecided(outcome: CaseOutcome): boolean {
  return outcome === 'PASS' || outcome === 'FAIL' || outcome === 'TIMED_OUT' || outcome === 'AGENT_FAILURE';
}

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
  /** Cases that reached a verdict about the agent (PASS, FAIL, timed out, crashed). */
  decided: z.number().int().nonnegative().optional(),
  abstained: z.number().int().nonnegative().default(0),
  timedOut: z.number().int().nonnegative().default(0),
  agentFailures: z.number().int().nonnegative().default(0),
  harnessFailures: z.number().int().nonnegative().default(0),
  /** Share of cases with no verdict: abstained or lost to the harness. */
  inconclusiveRate: z.number().default(0),
  /** True when the only reason the thresholds failed is inconclusiveness. */
  inconclusive: z.boolean().default(false),
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

/**
 * What the suite's own quality check said about the suite this run used.
 *
 * Carried on the run because a verdict from a suite that cannot tell a correct
 * agent from a broken one is a different claim from one that can, and the
 * audit found that difference sitting in a separate file nobody opened. A PASS
 * never travels without it.
 */
export const SuiteQualitySchema = z.object({
  assessed: z.boolean(),
  mutantKillRate: z.number().nullable().default(null),
  independentKillRate: z.number().nullable().default(null),
  falsePositiveRate: z.number().nullable().default(null),
  replayStable: z.boolean().nullable().default(null),
  hiddenAnswerIsolated: z.boolean().nullable().default(null),
  deadRules: z.number().int().nonnegative().default(0),
  warnings: z.array(z.string()).default([]),
});
export type SuiteQuality = z.infer<typeof SuiteQualitySchema>;

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
    /** PASS / FAIL, or INCONCLUSIVE when too many cases reached no verdict. */
    outcome: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']).optional(),
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
  /** The suite's own quality check, when the caller knew it. */
  suiteQuality: SuiteQualitySchema.optional(),
  /** Hash of this result, computed after the run is sealed. */
  resultHash: z.string().default(''),
  rigorrunVersion: z.string().default('0.1.0'),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export function parseRunResult(input: unknown): RunResult {
  return RunResultSchema.parse(input);
}
