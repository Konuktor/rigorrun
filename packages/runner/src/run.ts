/**
 * Running a generated benchmark against an environment adapter.
 *
 * The five stages are unchanged — reset, seed, execute, observe, verify — and
 * so are the two properties the runner is responsible for. What changed is
 * that the environment is resolved by id from a registry instead of being
 * imported, so this file has no idea what kind of business it is testing.
 *
 * Isolation: every case builds a fresh adapter from its own recorded starting
 * world, so no case can inherit anything from another.
 *
 * Integrity: the agent is handed `publicCaseView(testCase)` and a bounded tool
 * channel. `testCase.checks` is read afterwards, by the verifier, and never
 * travels through anything the agent can see.
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
  type ObservedEvent,
  type RunResult,
} from '@rigorrun/core';
import {
  buildProjection,
  capabilityLimits,
  createEnvironment,
  isolationLevel,
  mayMutateAtAll,
  mayRepeatMutatingCases,
  verificationStrength,
  type CanonicalState,
  type EnvironmentAdapter,
} from '@rigorrun/environment';
import { verify } from '@rigorrun/verifier';
import { decideVerdict, scoreAgent } from '@rigorrun/scoring';
import type { AgentAdapter, AgentEnvironment, ToolResult } from '@rigorrun/agents';
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
  /**
   * Progress callback. It may return a promise, which the runner awaits — that
   * lets the dashboard pace the run for a human to watch without distorting
   * any measurement, since each case's duration is recorded before its event
   * is emitted.
   */
  onProgress?: (event: RunProgress) => void | Promise<void>;
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
  const startedAt = now().toISOString();

  // What this environment can do decides what this run is allowed to claim, so
  // it is read once, before anything executes, and carried to the result.
  const capabilities = createEnvironment(benchmark.environment).capabilities();
  const limits = capabilityLimits(capabilities);

  // Repeating a case that changes the world, without a way to put the world
  // back, measures the wreckage of the previous attempt. Rather than let a
  // caller ask for that, the request is clamped and the reason is recorded.
  const requested = Math.max(1, options.repeats ?? 1);
  const repeats = mayRepeatMutatingCases(capabilities) ? requested : 1;
  if (repeats !== requested) {
    limits.push({
      id: 'repeats_clamped',
      limit: `Asked for ${requested} attempts per case, ran 1: without a reset every attempt ` +
        'after the first would start from the last one\u2019s leftovers.',
      remedy: 'Configure a reset for this environment.',
    });
  }

  await options.onProgress?.({
    type: 'run_started',
    runId,
    totalCases: benchmark.cases.length * agents.length * repeats,
    agents: agents.map((a) => a.id),
  });

  const caseResults: CaseResult[] = [];
  for (const agent of agents) {
    for (const testCase of benchmark.cases) {
      for (let attempt = 0; attempt < repeats; attempt += 1) {
        await options.onProgress?.({
          type: 'case_started',
          runId,
          agentId: agent.id,
          caseId: testCase.id,
          caseName: testCase.name,
        });
        const result = await executeCase(benchmark, runId, testCase, agent, now);
        caseResults.push(result);
        await options.onProgress?.({ type: 'case_finished', runId, result });
      }
    }
    await options.onProgress?.({ type: 'agent_finished', runId, agentId: agent.id });
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
    verification: verificationStrength(capabilities),
    isolation: isolationLevel(capabilities),
    limits,
    notTestable: benchmark.notTestable ?? [],
    resultHash: '',
    rigorrunVersion: options.version ?? '0.1.0',
  };
  result.resultHash = await hashValue({ ...result, resultHash: '' });
  await options.onProgress?.({ type: 'run_finished', runId, result });
  return result;
}

async function executeCase(
  benchmark: Benchmark,
  runId: string,
  testCase: BenchmarkCase,
  agent: AgentAdapter,
  now: () => Date,
): Promise<CaseResult> {
  const adapter = createEnvironment(benchmark.environment);
  const capabilities = adapter.capabilities();
  const seedState = (testCase.seed.state ?? { entities: {} }) as CanonicalState;
  await adapter.reset();
  // An environment that cannot be seeded is not asked to pretend. Its world
  // comes from the reset, which is a weaker guarantee than an installed state
  // and a sufficient one: the same starting position every time still isolates
  // cases and still reproduces. Calling `seed()` anyway would be harmless here
  // and dishonest in the artefact, because the case would claim a world it
  // never had.
  if (capabilities.seed !== 'none') {
    await adapter.seed(seedState, testCase.seed.config);
  }

  // On a system somebody marked production, a write is refused at the channel
  // rather than filtered out of the case list. The agent still gets to try, the
  // refusal is recorded as a step, and the evidence shows exactly what it would
  // have done — which is more useful than a case that silently never ran.
  const writeGuard = mayMutateAtAll(capabilities)
    ? undefined
    : new Set(mutatingActionNames(adapter));

  const steps: AgentStep[] = [];
  let pendingNote: string | null = null;
  let stepBudget = testCase.maxSteps;

  const env: AgentEnvironment = {
    async call(tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
      if (stepBudget <= 0) {
        return { ok: false, error: { code: 'TOOL_UNAVAILABLE', message: 'Step budget exhausted.' } };
      }
      stepBudget -= 1;
      if (writeGuard?.has(tool)) {
        const refusal = {
          ok: false as const,
          error: {
            code: 'WRITE_REFUSED',
            message: `${tool} writes, and this environment is marked production.`,
          },
        };
        steps.push({
          index: steps.length,
          at: Date.now(),
          tool,
          args: boundArgs(args),
          ok: false,
          error: refusal.error.code,
          ...(pendingNote ? { note: pendingNote } : {}),
        });
        pendingNote = null;
        return refusal;
      }
      const result = await adapter.executeAction(tool, args);
      steps.push({
        index: steps.length,
        at: Date.now(),
        tool,
        args: boundArgs(args),
        ok: result.ok,
        ...(result.ok ? { result: result.data } : { error: result.error?.code ?? 'FAILED' }),
        ...(pendingNote ? { note: pendingNote } : {}),
      });
      pendingNote = null;
      return result.ok
        ? { ok: true, data: result.data }
        : {
            ok: false,
            error: {
              code: result.error?.code ?? 'FAILED',
              message: result.error?.message ?? 'the action was refused',
            },
          };
    },
    stepsRemaining: () => stepBudget,
    note(text: string) {
      pendingNote = text.slice(0, 1000);
    },
  };

  const startedAt = now().toISOString();
  const startedMs = performanceNow();

  let report: string;
  let errored = false;
  let errorMessage: string | undefined;
  let usage: CaseResult['usage'];
  let costUsd: number | null = null;
  let costNote = 'cost unavailable';

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

  // observe: authoritative state, projected the same way for every agent.
  const finalState = await adapter.getState();
  const events = await adapter.getEvents();
  const { derived } = buildProjection(adapter.describeEntities(), {
    seed: seedState,
    final: finalState,
    events,
    focus: benchmark.projectionFocus,
    knownEventTypes: mutatingActionNames(adapter),
  });

  const summary = verify(testCase.checks, {
    state: finalState,
    derived,
    events: [],
    agentReport: report,
  });

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
    actions: events.map(
      (event): ObservedEvent => ({
        type: event.type,
        at: event.at,
        payload: event.payload,
        ok: event.ok,
        ...(event.error ? { error: event.error } : {}),
      }),
    ),
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
    finalStateSummary: summariseCanonicalState(finalState),
  };
}

function mutatingActionNames(adapter: EnvironmentAdapter): string[] {
  return adapter
    .getActions()
    .filter((action) => !action.readOnly)
    .map((action) => action.name);
}

/** A compact slice of the world for the evidence view. */
function summariseCanonicalState(state: CanonicalState): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const name of Object.keys(state.entities).sort()) {
    const rows = Object.values(state.entities[name] ?? {});
    summary[name] = { count: rows.length, rows: rows.slice(0, 5) };
  }
  return summary;
}

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
