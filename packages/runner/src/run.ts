/**
 * The execution engine: reset → seed → execute → observe → verify → score.
 *
 * Two properties this file is responsible for:
 *
 *  1. **Isolation.** Every case builds a brand-new engine from its scenario
 *     seed, so no case can inherit state from another. There is no shared
 *     mutable world anywhere in this path.
 *
 *  2. **Integrity.** The agent is handed `publicCaseView(testCase)` and nothing
 *     else. The assertions live in `testCase.checks`, which is read only after
 *     the agent has finished and only by the verifier.
 *
 * It is isomorphic: no Node built-ins, so the identical code runs in the CLI,
 * in CI and inside the dashboard in the browser.
 */
import {
  RUN_SCHEMA_VERSION,
  hashValue,
  prefixedId,
  publicCaseView,
  type AgentStep,
  type Benchmark,
  type BenchmarkCase,
  type CaseResult,
  type RunResult,
} from '@rigorrun/core';
import { NorthstarEngine, buildObservation, summariseState } from '@rigorrun/northstar';
import type { ToolResult } from '@rigorrun/northstar';
import { verify } from '@rigorrun/verifier';
import { decideVerdict, scoreAgent } from '@rigorrun/scoring';
import type { AgentAdapter, AgentEnvironment } from '@rigorrun/agents';

export type RunProgress =
  | { type: 'run_started'; runId: string; totalCases: number; agents: string[] }
  | { type: 'case_started'; runId: string; agentId: string; caseId: string; caseName: string }
  | { type: 'case_finished'; runId: string; result: CaseResult }
  | { type: 'agent_finished'; runId: string; agentId: string }
  | { type: 'run_finished'; runId: string; result: RunResult };

export interface RunOptions {
  runId?: string;
  /** Repeat every case this many times, enabling pass@k. */
  repeats?: number;
  onProgress?: (event: RunProgress) => void;
  /** Injectable clock so tests and examples can be byte-reproducible. */
  now?: () => Date;
  version?: string;
}

const MAX_TOOL_ARG_BYTES = 8 * 1024;

export async function runBenchmark(
  benchmark: Benchmark,
  agents: AgentAdapter[],
  options: RunOptions = {},
): Promise<RunResult> {
  if (agents.length === 0) throw new Error('At least one agent is required to run a benchmark.');

  const runId = options.runId ?? prefixedId('run');
  const now = options.now ?? (() => new Date());
  const repeats = Math.max(1, options.repeats ?? 1);
  const startedAt = now().toISOString();

  options.onProgress?.({
    type: 'run_started',
    runId,
    totalCases: benchmark.cases.length * agents.length * repeats,
    agents: agents.map((a) => a.id),
  });

  const caseResults: CaseResult[] = [];

  for (const agent of agents) {
    for (const testCase of benchmark.cases) {
      for (let attempt = 0; attempt < repeats; attempt += 1) {
        options.onProgress?.({
          type: 'case_started',
          runId,
          agentId: agent.id,
          caseId: testCase.id,
          caseName: testCase.name,
        });
        const result = await executeCase(runId, testCase, agent, now);
        caseResults.push(result);
        options.onProgress?.({ type: 'case_finished', runId, result });
      }
    }
    options.onProgress?.({ type: 'agent_finished', runId, agentId: agent.id });
  }

  const scores = agents.map((agent) =>
    scoreAgent(
      { id: agent.id, name: agent.name },
      caseResults.filter((r) => r.agentId === agent.id),
      benchmark.thresholds,
    ),
  );

  const result: RunResult = {
    schemaVersion: RUN_SCHEMA_VERSION,
    runId,
    benchmarkId: benchmark.id,
    benchmarkName: benchmark.name,
    benchmarkHash: await hashValue(benchmark),
    contractHash: benchmark.contractHash,
    environment: benchmark.environment,
    startedAt,
    finishedAt: now().toISOString(),
    agents: agents.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    caseResults,
    scores,
    verdict: decideVerdict(scores),
    resultHash: '',
    rigorrunVersion: options.version ?? '0.1.0',
  };

  // Sealed last, over everything above it.
  result.resultHash = await hashValue({ ...result, resultHash: '' });
  options.onProgress?.({ type: 'run_finished', runId, result });
  return result;
}

async function executeCase(
  runId: string,
  testCase: BenchmarkCase,
  agent: AgentAdapter,
  now: () => Date,
): Promise<CaseResult> {
  // reset + seed: a fresh world built from the scenario, every single time.
  const engine = NorthstarEngine.fromScenario(testCase.seed.scenarioId, {
    mutations: testCase.seed.mutations,
    actor: `agent.${agent.id}`,
  });

  const steps: AgentStep[] = [];
  let pendingNote: string | null = null;
  let stepBudget = testCase.maxSteps;

  const env: AgentEnvironment = {
    async call(tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
      if (stepBudget <= 0) {
        return {
          ok: false,
          error: { code: 'TOOL_UNAVAILABLE', message: 'Step budget exhausted.' },
        };
      }
      stepBudget -= 1;

      const safeArgs = boundArgs(args);
      const result = engine.call(tool, args);
      steps.push({
        index: steps.length,
        at: Date.now(),
        tool,
        args: safeArgs,
        ok: result.ok,
        ...(result.ok ? { result: result.data } : { error: result.error.code }),
        ...(pendingNote ? { note: pendingNote } : {}),
      });
      pendingNote = null;
      return result;
    },
    stepsRemaining: () => stepBudget,
    note(text: string) {
      pendingNote = text.slice(0, 1000);
    },
  };

  const startedAt = now().toISOString();
  const startedMs = performanceNow();

  let report: string;
  let usage: CaseResult['usage'];
  let costUsd: number | null = null;
  let costNote = 'cost unavailable';
  let errored = false;
  let errorMessage: string | undefined;

  try {
    const output = await withTimeout(
      agent.execute(
        { caseId: testCase.id, task: publicCaseView(testCase).task, maxSteps: testCase.maxSteps },
        env,
      ),
      testCase.timeoutMs,
    );
    report = output.report;
    if (output.usage) usage = output.usage;
    costUsd = output.costUsd;
    costNote = output.costNote;
  } catch (error) {
    errored = true;
    errorMessage = (error as Error).message;
    report = `Agent execution failed: ${errorMessage}`;
  }

  const durationMs = Math.max(0, performanceNow() - startedMs);
  const finishedAt = now().toISOString();

  // observe: read the world the agent actually left behind.
  const observation = buildObservation(engine, {
    scenarioId: testCase.seed.scenarioId,
    agentReport: report,
  });

  // verify: the private checks, evaluated against that world.
  const summary = verify(testCase.checks, observation);
  const finalState = engine.snapshot();

  return {
    runId,
    caseId: testCase.id,
    caseName: testCase.name,
    category: testCase.category,
    agentId: agent.id,
    correlationId: `${runId}.${agent.id}.${testCase.id}`,
    startedAt,
    finishedAt,
    durationMs: round3(durationMs),
    steps,
    actions: engine.events(),
    assertions: summary.results,
    taskSuccess: !errored && summary.taskSuccess,
    policyCompliant: summary.policyCompliant,
    unsafeActions: summary.unsafeActions,
    errored,
    ...(errorMessage ? { error: errorMessage } : {}),
    ...(usage ? { usage } : {}),
    costUsd,
    costNote,
    agentReport: report,
    finalStateHash: await hashValue(finalState),
    finalStateSummary: summariseState(finalState),
  };
}

/** Caps how much of an agent's arguments are retained in evidence. */
function boundArgs(args: Record<string, unknown>): Record<string, unknown> {
  const serialised = JSON.stringify(args);
  if (serialised.length <= MAX_TOOL_ARG_BYTES) return args;
  return { _truncated: true, preview: serialised.slice(0, 512) };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Agent exceeded its ${timeoutMs}ms budget`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function performanceNow(): number {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
