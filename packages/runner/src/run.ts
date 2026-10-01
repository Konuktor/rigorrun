/**
 * Running a generated benchmark against an environment adapter.
 *
 * The five stages are unchanged — reset, seed, execute, observe, verify — and
 * so are the two properties the runner is responsible for. What changed is
 * that the environment is resolved by id from a registry instead of being
 * imported, so this file has no idea what kind of business it is testing.
 *
 * Isolation: every case builds a fresh adapter and establishes its own starting
 * world — installed where the adapter can seed, observed at case start where it
 * cannot — so no case can inherit anything from another, and no case is graded
 * against a snapshot recorded when the suite was generated.
 *
 * Integrity: the agent is handed `publicCaseView(testCase)` and a bounded tool
 * channel. `testCase.checks` is read afterwards, by the verifier, and never
 * travels through anything the agent can see.
 *
 * An environment that cannot install a world materializes one instead: after
 * the reset it creates the case's records from the recipe in the case's seed,
 * and reports the identifiers they were given. The case is bound to those
 * before the agent or the verifier sees any of it, so both work from the same
 * records, and every attempt gets records of its own.
 */
import {
  RUN_SCHEMA_VERSION,
  bindCase,
  hashValue,
  prefixedId,
  publicCaseView,
  type AgentStep,
  type Benchmark,
  type BenchmarkCase,
  type CaseOutcome,
  type CaseResult,
  type EntityReadStability,
  type EvidenceIndependence,
  type ObservedEvent,
  type RunResult,
  type SuiteQuality,
} from '@rigorrun/core';
import {
  StateReadError,
  buildProjection,
  capabilityLimits,
  createEnvironment,
  frameObservation,
  isolationLevel,
  mayMutateAtAll,
  mayRepeatMutatingCases,
  readStability,
  verificationStrength,
  type CanonicalState,
  type EnvironmentAdapter,
  type EnvironmentCapabilities,
  type MaterializedCase,
  type PackCaseContext,
  type Reality,
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
  /**
   * Overrides every case's wall-clock budget for this run — for an agent that
   * needs more time than the suite was generated with. Recorded on each case.
   */
  caseTimeoutMs?: number;
  /**
   * The suite's own quality check. Its warnings go into the verdict's
   * rationale and an unassessed suite is a limit, so a clean-looking PASS never
   * hides a suite that cannot separate a good agent from a bad one.
   */
  suiteQuality?: SuiteQuality;
  version?: string;
}

const MAX_TOOL_ARG_BYTES = 8 * 1024;

export async function runBenchmark(
  benchmark: Benchmark,
  agents: AgentAdapter[],
  options: RunOptions = {},
): Promise<RunResult> {
  if (agents.length === 0) throw new Error('At least one agent is required to run a benchmark.');
  if (
    options.caseTimeoutMs !== undefined &&
    !(Number.isInteger(options.caseTimeoutMs) && options.caseTimeoutMs > 0)
  ) {
    throw new Error('caseTimeoutMs must be a positive whole number of milliseconds.');
  }

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
      limit:
        `Asked for ${requested} attempts per case, ran 1: without a reset every attempt ` +
        'after the first would start from the last one\u2019s leftovers.',
      remedy: 'Configure a reset for this environment.',
    });
  }

  // A black-box agent works on the system directly. RigorRun cannot refuse its
  // writes the way it refuses a proxied call, so production is not a place to
  // send one — and what it did is judged on state alone, which the run says.
  if (agents.some((agent) => agent.kind === 'blackbox')) {
    if (capabilities.safety === 'production') {
      throw new Error(
        'This system is marked production, and a black-box agent writes to it directly, where RigorRun ' +
          'cannot refuse anything. Run it against a staging or scratch copy.',
      );
    }
    limits.push({
      id: 'no_call_trace',
      limit:
        'Black-box: RigorRun did not see the agent\u2019s calls, so checks about their order were not made. ' +
        'Every check on what the system holds afterwards was, on a reading the agent never touched.',
      remedy:
        'Connect the agent through the RigorRun MCP proxy as well, to have its calls checked too.',
    });
  }

  if (options.suiteQuality && !options.suiteQuality.assessed) {
    limits.push({
      id: 'suite_quality_unassessed',
      limit: 'Nobody has checked whether this suite can tell a correct agent from a broken one.',
      remedy: 'Run the suite check before trusting a PASS from it.',
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
        const result = await executeCase(
          benchmark,
          runId,
          testCase,
          agent,
          now,
          options.caseTimeoutMs,
          attempt,
        );
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

  const verdict = decideVerdict(scores);
  for (const warning of options.suiteQuality?.warnings ?? []) {
    verdict.rationale.push(`Suite quality: ${warning}.`);
  }

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
    verdict,
    verification: verificationStrength(capabilities),
    isolation: isolationLevel(capabilities),
    limits,
    notTestable: benchmark.notTestable ?? [],
    ...(options.suiteQuality ? { suiteQuality: options.suiteQuality } : {}),
    resultHash: '',
    rigorrunVersion: options.version ?? '0.1.0',
  };
  result.resultHash = await hashValue({ ...result, resultHash: '' });
  await options.onProgress?.({ type: 'run_finished', runId, result });
  return result;
}

class AgentTimeoutError extends Error {
  constructor(readonly budgetMs: number) {
    super(`Agent exceeded its ${budgetMs}ms budget`);
    this.name = 'AgentTimeoutError';
  }
}

/**
 * What a case's verdict rests on, decided before anything is compared.
 *
 * Four different worlds a case can start from, and the artefact says which:
 *
 * - INSTALLED_SEED: the adapter can seed, so the recorded world was installed.
 * - OBSERVED_AT_START: the adapter cannot seed, so the world was *read* after
 *   the reset — freshly, now, for this case. Never the snapshot captured when
 *   the suite was generated: that snapshot already contains whatever the
 *   demonstration produced, so a correct agent that repeats the job looks like
 *   it did nothing, and any drift since looks like the agent's work.
 * - MATERIALIZED: the adapter created the case's records, so the world was
 *   read back afterwards — what was made, rather than what was asked for.
 * - UNAVAILABLE: nothing could be read. The delta cannot be computed, so any
 *   check that needs it is unverifiable and the case abstains.
 *
 * A case held to the demonstrated frame reads the starting world twice, with
 * nothing in between (requalification P9). A field that differs was changed by the
 * reading itself, and the second reading is the world the agent starts from, so
 * whatever the reads change before the agent acts is never counted as its work.
 */
interface Baseline {
  state: CanonicalState;
  source: 'INSTALLED_SEED' | 'OBSERVED_AT_START' | 'MATERIALIZED' | 'UNAVAILABLE';
  missing: string[];
  /** What the two starting readings proved, when the case reads twice. */
  stability?: Record<string, EntityReadStability>;
}

async function establishBaseline(
  adapter: EnvironmentAdapter,
  testCase: BenchmarkCase,
  readTwice: boolean,
): Promise<Baseline> {
  const capabilities = adapter.capabilities();
  // Materialized records were made before this was called. Nothing is
  // installed over them: what the system holds now is the starting world.
  const materialized = capabilities.seed === 'materialized';
  if (!materialized && capabilities.seed !== 'none') {
    const seedState = (testCase.seed.state ?? { entities: {} }) as CanonicalState;
    await adapter.seed(seedState, testCase.seed.config);
    return { state: seedState, source: 'INSTALLED_SEED', missing: [] };
  }
  if (capabilities.stateRead === 'none') {
    return { state: { entities: {} }, source: 'UNAVAILABLE', missing: ['no_state_read'] };
  }
  const source = materialized ? 'MATERIALIZED' : 'OBSERVED_AT_START';
  try {
    const first = await adapter.getState();
    if (!readTwice) return { state: first, source, missing: [] };
    const second = await adapter.getState();
    return {
      state: withWindows(second, first),
      source,
      missing: [],
      stability: readStability(adapter.describeEntities(), first, second),
    };
  } catch (error) {
    if (error instanceof StateReadError) {
      return {
        state: { entities: {} },
        source: 'UNAVAILABLE',
        missing: [`initial_state_unavailable:${error.read}`],
      };
    }
    throw error;
  }
}

async function executeCase(
  benchmark: Benchmark,
  runId: string,
  testCase: BenchmarkCase,
  agent: AgentAdapter,
  now: () => Date,
  budgetOverrideMs: number | undefined,
  attempt: number,
): Promise<CaseResult> {
  const adapter = createEnvironment(benchmark.environment);
  const budgetMs = budgetOverrideMs ?? testCase.timeoutMs;
  const capabilities = adapter.capabilities();
  const verification = verificationStrength(capabilities);
  const independence: EvidenceIndependence =
    capabilities.stateRead === 'none'
      ? 'NONE'
      : capabilities.stateReadIndependence === 'independent' || capabilities.stateRead === 'full'
        ? 'INDEPENDENT'
        : 'SELF_REPORTED';

  const startedAt = now().toISOString();
  const startedMs = performanceNow();
  // A case held to the demonstrated frame reads the world twice at each end,
  // so a field the reads themselves change is proved rather than assumed. Only
  // such a case: a benchmark compiled before frames keeps its exact reads.
  const readTwice =
    capabilities.stateRead !== 'none' &&
    testCase.checks.some((check) => check.kind === 'state_frame');
  const skeleton = {
    runId,
    caseId: testCase.id,
    caseName: testCase.name,
    category: testCase.category,
    agentId: agent.id,
    correlationId: `${runId}.${agent.id}.${testCase.id}`,
    attempt,
    startedAt,
    verification,
    evidenceIndependence: independence,
    budgetMs,
  };

  // What was created for this case, once anything was. Carried onto every
  // result from then on, a harness failure included, so a person can always
  // find the records a case made — even the ones it never got to use.
  let made: MaterializedCase | undefined;
  const madeRecord = (): Pick<CaseResult, 'materialized' | 'readScope'> =>
    made ? { materialized: { ...made.bindings }, readScope: made.readScope } : {};

  // A harness that cannot put the world in order has nothing to grade. That
  // is a fact about the run, recorded as one, never as a failure of the agent.
  const harnessFailure = (stage: string, error: unknown): CaseResult => ({
    ...skeleton,
    finishedAt: now().toISOString(),
    durationMs: round3(Math.max(0, performanceNow() - startedMs)),
    steps: [],
    actions: [],
    assertions: [],
    taskSuccess: false,
    policyCompliant: false,
    unsafeActions: 0,
    errored: true,
    error: `${stage}: ${(error as Error).message}`,
    outcome: 'HARNESS_FAILURE',
    outcomeReason: `RigorRun could not ${stage}: ${(error as Error).message}`,
    missingEvidence: [`harness:${stage}`],
    baseline: 'UNAVAILABLE',
    ...madeRecord(),
    initialStateHash: '',
    costUsd: null,
    costNote: 'cost unavailable',
    agentReport: '',
    finalStateHash: '',
    finalStateSummary: {},
  });

  try {
    await adapter.reset();
  } catch (error) {
    return harnessFailure('reset the environment', error);
  }

  // The case everything below works from. For a materialized world it is the
  // case bound to the records just made; otherwise it is the case as written.
  let bound: BenchmarkCase = testCase;
  if (capabilities.seed === 'materialized') {
    try {
      made = await materializeCase(adapter, capabilities, testCase, {
        runId,
        caseId: testCase.id,
        agentId: agent.id,
        attempt,
      });
    } catch (error) {
      return harnessFailure("create the case's records", error);
    }
    // A token nothing was bound to, or a value that would change what a check
    // asks, means the case cannot be asked at all. Its author or the
    // environment is at fault, and the agent has not been involved yet.
    try {
      bound = bindCase(testCase, made.bindings);
    } catch (error) {
      return harnessFailure('bind the case to its records', error);
    }
  }

  let baseline: Baseline;
  try {
    baseline = await establishBaseline(adapter, bound, readTwice);
  } catch (error) {
    return harnessFailure('establish the starting world', error);
  }
  const initialState = baseline.state;
  const missingEvidence = [...baseline.missing];

  // On a system somebody marked production, a write is refused at the channel
  // rather than filtered out of the case list. The agent still gets to try, the
  // refusal is recorded as a step, and the evidence shows exactly what it would
  // have done — which is more useful than a case that silently never ran.
  const writeGuard = mayMutateAtAll(capabilities)
    ? undefined
    : new Set(mutatingActionNames(adapter));

  const steps: AgentStep[] = [];
  let pendingNote: string | null = null;
  let stepBudget = bound.maxSteps;

  const env: AgentEnvironment = {
    async call(tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
      if (stepBudget <= 0) {
        return {
          ok: false,
          error: { code: 'TOOL_UNAVAILABLE', message: 'Step budget exhausted.' },
        };
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
      let result: Awaited<ReturnType<EnvironmentAdapter['executeAction']>>;
      try {
        result = await adapter.executeAction(tool, args);
      } catch (error) {
        // The adapter threw rather than answering. That is the harness's
        // problem, surfaced to the agent as a failed call and recorded.
        result = {
          ok: false,
          error: { code: 'ADAPTER_ERROR', message: (error as Error).message },
        };
      }
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

  let report: string;
  let errored = false;
  let errorMessage: string | undefined;
  let agentOutcome: 'ran' | 'timed_out' | 'failed' = 'ran';
  let usage: CaseResult['usage'];
  let costUsd: number | null = null;
  let costNote = 'cost unavailable';

  try {
    // The bound case's public half, and nothing else of it: never the seed or
    // its recipe, the checks or the reference plan. A black-box agent receives
    // exactly this too, through the same input, and works on the records it
    // names with access of its own.
    const output = await withTimeout(
      agent.execute(
        { caseId: bound.id, task: publicCaseView(bound).task, maxSteps: bound.maxSteps },
        env,
      ),
      budgetMs,
    );
    report = output.report;
    if (output.usage) usage = output.usage;
    costUsd = output.costUsd;
    costNote = output.costNote;
  } catch (error) {
    errored = true;
    errorMessage = (error as Error).message;
    agentOutcome = error instanceof AgentTimeoutError ? 'timed_out' : 'failed';
    report = `Agent execution failed: ${errorMessage}`;
  }

  const durationMs = Math.max(0, performanceNow() - startedMs);
  const finishedAt = now().toISOString();

  // observe: authoritative state, projected the same way for every agent. A
  // case held to the frame reads it twice: the first reading is the final
  // world, and the second only proves what reading changes. The agent's budget
  // ended above, so neither reading spends it.
  let finalState: CanonicalState = { entities: {} };
  let finalReadable = true;
  let finalStability: Record<string, EntityReadStability> | undefined;
  try {
    if (capabilities.stateRead !== 'none') {
      finalState = await adapter.getState();
      if (readTwice) {
        const again = await adapter.getState();
        finalStability = readStability(adapter.describeEntities(), finalState, again);
        finalState = withWindows(finalState, again);
      }
    }
  } catch (error) {
    if (!(error instanceof StateReadError)) return harnessFailure('read the final state', error);
    finalState = { entities: {} };
    finalReadable = false;
    missingEvidence.push(`final_state_unavailable:${error.read}`);
  }
  const events = await adapter.getEvents();
  const { derived, deltas } = buildProjection(adapter.describeEntities(), {
    seed: initialState,
    final: finalState,
    events,
    focus: benchmark.projectionFocus,
    knownEventTypes: mutatingActionNames(adapter),
  });

  // A check against state can only be answered when both ends of the delta
  // were read. Otherwise it is not a pass and not a failure: it is a check
  // RigorRun could not make, and the verdict says so.
  const stateUnverifiable = baseline.source === 'UNAVAILABLE' || !finalReadable;
  // What the case changed for every kind of record, with what the readings at
  // each end proved about themselves: the evidence a frame check reads.
  // Kinds of record a read answered with one page of, at either end. Which of
  // them exist cannot be read, so every check on that is not made.
  const windowed = { ...initialState.windowed, ...finalState.windowed };
  const frame =
    readTwice && !stateUnverifiable && finalStability
      ? frameObservation(
          adapter.describeEntities(),
          deltas,
          baseline.source === 'INSTALLED_SEED' ? 'installed_seed' : (baseline.stability ?? {}),
          finalStability,
          windowed,
        )
      : undefined;
  // A black-box agent's calls were never visible: checks resting on them are
  // listed as not made, and do not hold the verdict hostage.
  const blackBox = agent.kind === 'blackbox';
  const summary = verify(
    bound.checks,
    {
      state: finalState,
      derived: {
        ...derived,
        ...(Object.keys(windowed).length > 0 ? { windowed } : {}),
        ...(frame ? { frame } : {}),
      },
      events: [],
      agentReport: report,
    },
    {
      ...(stateUnverifiable
        ? {
            unverifiableSources: ['STATE'] as const,
            unverifiableReason:
              baseline.source === 'UNAVAILABLE'
                ? capabilities.stateRead === 'none'
                  ? 'this environment cannot be read back'
                  : 'the starting world could not be read'
                : 'the final world could not be read',
          }
        : {}),
      ...(blackBox
        ? {
            unobservedSources: ['EVENT'] as const,
            unobservedReason: 'black-box: RigorRun did not see the agent\u2019s calls',
          }
        : {}),
    },
  );

  const { outcome, outcomeReason } = classify(agentOutcome, summary, errorMessage, budgetMs);

  // The system's own account of how the case ended, to show beside the
  // agent's. Only from two readings that both answered: described from a world
  // that could not be read, it would state as fact what nobody saw.
  const reality = stateUnverifiable
    ? undefined
    : describeReality(adapter, initialState, finalState, missingEvidence);

  // A frame check that could not rule says why, in the same stable terms as
  // every other piece of missing evidence.
  const frameResult = summary.results.find((result) => result.kind === 'state_frame');
  if (frameResult?.status === 'UNVERIFIABLE') {
    const detail = frameResult.observed as { unverifiable?: { id: string }[] } | null;
    for (const id of detail?.unverifiable?.map((entry) => entry.id) ?? []) {
      if (!missingEvidence.includes(id)) missingEvidence.push(id);
    }
  }

  return {
    ...skeleton,
    finishedAt,
    durationMs: round3(durationMs),
    steps,
    actions: events.map((event): ObservedEvent => ({
      type: event.type,
      at: event.at,
      payload: event.payload,
      ok: event.ok,
      ...(event.error ? { error: event.error } : {}),
    })),
    assertions: summary.results,
    taskSuccess: !errored && summary.taskSuccess,
    policyCompliant: summary.policyCompliant,
    unsafeActions: summary.unsafeActions,
    errored,
    ...(errorMessage ? { error: errorMessage } : {}),
    outcome,
    outcomeReason,
    missingEvidence,
    baseline: baseline.source,
    ...madeRecord(),
    ...(reality ? { reality } : {}),
    ...(readTwice
      ? {
          readStability: {
            baseline:
              baseline.source === 'INSTALLED_SEED'
                ? ('installed_seed' as const)
                : baseline.source === 'UNAVAILABLE'
                  ? ('unavailable' as const)
                  : ('double_read' as const),
            final: finalStability ? ('double_read' as const) : ('unavailable' as const),
            volatileFields: Object.fromEntries(
              Object.entries(frame?.entities ?? {})
                .filter(([, entity]) => entity.volatileFields.length > 0)
                .map(([name, entity]) => [name, entity.volatileFields]),
            ),
            membershipUnstable: Object.entries(frame?.entities ?? {})
              .filter(([, entity]) => entity.membershipUnstable)
              .map(([name]) => name),
          },
        }
      : {}),
    initialStateHash: await hashValue(initialState),
    ...(usage ? { usage } : {}),
    costUsd,
    costNote,
    observation: blackBox ? ('state-only' as const) : ('calls-and-state' as const),
    agentReport: report,
    finalStateHash: await hashValue(finalState),
    finalStateSummary: summariseCanonicalState(finalState),
  };
}

/**
 * The verdict, in words a report can act on.
 *
 * Order matters. An unsafe action or a failed check is a finding about the
 * agent whatever else happened, so it comes first — a timeout does not
 * launder a wrong write. After that, how the agent ended decides: out of
 * time, crashed, or finished. Only a case that finished, with no failed check,
 * can pass — and only when every blocking check was actually checked.
 */
function classify(
  agentOutcome: 'ran' | 'timed_out' | 'failed',
  summary: ReturnType<typeof verify>,
  errorMessage: string | undefined,
  budgetMs: number,
): { outcome: CaseOutcome; outcomeReason: string } {
  const failed = summary.results.filter((r) => r.status === 'FAIL' || r.status === 'ERROR');
  if (summary.unsafeActions > 0) {
    return {
      outcome: 'FAIL',
      outcomeReason: `${summary.unsafeActions} unsafe action(s): ${failed
        .filter((r) => r.unsafe)
        .map((r) => r.description)
        .join('; ')}`,
    };
  }
  // A broken rule is the agent's doing whether or not it finished. A success
  // check that failed only because the agent never got to the work is not:
  // that is what running out of time *means*, and it is reported as that.
  const policyFailed = failed.filter((r) => r.severity !== 'success');
  if (policyFailed.length > 0) {
    return {
      outcome: 'FAIL',
      outcomeReason: policyFailed.map((r) => `${r.description} — ${r.message}`).join('; '),
    };
  }
  if (agentOutcome === 'ran' && failed.length > 0) {
    return {
      outcome: 'FAIL',
      outcomeReason: failed.map((r) => `${r.description} — ${r.message}`).join('; '),
    };
  }
  if (agentOutcome === 'timed_out') {
    return {
      outcome: 'TIMED_OUT',
      outcomeReason: `the agent did not finish inside the ${budgetMs} ms case budget; no check failed on what it had done by then`,
    };
  }
  if (agentOutcome === 'failed') {
    return {
      outcome: 'AGENT_FAILURE',
      outcomeReason: `the agent stopped with an error: ${errorMessage ?? 'unknown'}`,
    };
  }
  if (summary.blockingUnverifiable > 0) {
    return {
      outcome: 'ABSTAIN',
      outcomeReason: `${summary.blockingUnverifiable} blocking check(s) could not be made: ${summary.results.find((r) => r.status === 'UNVERIFIABLE')?.message ?? 'no evidence'}`,
    };
  }
  if (!summary.taskSuccess) {
    // No success check applied at all: nothing established that the work was
    // done. That is not a pass.
    return {
      outcome: 'ABSTAIN',
      outcomeReason:
        'no applicable success check: nothing could establish whether the work was done',
    };
  }
  return { outcome: 'PASS', outcomeReason: 'every applicable check passed on observed state' };
}

/**
 * Creates this case's records, as the environment that declared it can.
 *
 * Creating records is a write RigorRun makes on its own behalf, before any
 * agent is there to answer for it, so a system marked production is refused
 * here whatever the adapter itself would have done.
 */
async function materializeCase(
  adapter: EnvironmentAdapter,
  capabilities: EnvironmentCapabilities,
  testCase: BenchmarkCase,
  ctx: PackCaseContext,
): Promise<MaterializedCase> {
  if (!mayMutateAtAll(capabilities)) {
    throw new Error(
      'this system is marked production, and every case of this suite creates records in it',
    );
  }
  if (!adapter.materialize) {
    throw new Error(
      `${adapter.name} says its cases create their own records, but offers no way to create them`,
    );
  }
  return adapter.materialize(testCase.seed, ctx);
}

/**
 * The system's account of how the case ended, copied out of the adapter.
 *
 * It is never scored, so an adapter that throws while writing it costs the
 * reader the account and nothing else: the verdict stands, and the gap is
 * named among what is missing.
 */
function describeReality(
  adapter: EnvironmentAdapter,
  seed: CanonicalState,
  final: CanonicalState,
  missingEvidence: string[],
): Reality | undefined {
  if (!adapter.describeReality) return undefined;
  try {
    const reality = adapter.describeReality(seed, final);
    return reality ? { system: reality.system, lines: [...reality.lines] } : undefined;
  } catch {
    missingEvidence.push('reality_unavailable');
    return undefined;
  }
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
        timer = setTimeout(() => reject(new AgentTimeoutError(timeoutMs)), timeoutMs);
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

/** Both readings of one end: a kind read one page at a time in either is windowed. */
function withWindows(state: CanonicalState, other: CanonicalState): CanonicalState {
  const windowed = { ...other.windowed, ...state.windowed };
  return Object.keys(windowed).length > 0 ? { ...state, windowed } : state;
}
