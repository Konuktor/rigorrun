/**
 * The demo's state machine.
 *
 * Every step runs the real package code in the browser — the same compiler,
 * generator, runner and verifier the CLI and CI use. Nothing is mocked and no
 * result is precomputed.
 *
 * The current step lives in the URL, and the pipeline is deterministic, so a
 * deep link, a refresh or the browser back button all rebuild exactly the same
 * artefacts rather than dropping the user back at the start.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyReview,
  type Benchmark,
  type CanonicalHumanTrace,
  type CaseResult,
  type EnvironmentContract,
  type RunResult,
} from '@rigorrun/core';
import { generateBenchmark, createReferenceAgent } from '@rigorrun/generator';
import { carefulAgent, naiveAgent } from '@rigorrun/agents';
import { runBenchmark } from '@rigorrun/runner';
import {
  WORKFLOWS,
  fixtureFor,
  recordDemonstration,
  workflowByKey,
  type WorkflowDefinition,
} from '@rigorrun/environments';
import { induceContract } from '@rigorrun/compiler';

export const STEPS = ['record', 'learned', 'confirm', 'benchmark', 'run', 'verdict'] as const;
export type Step = (typeof STEPS)[number];

/**
 * Six steps, six screens.
 *
 * Reviewing and confirming were one screen, and they are two acts: reading
 * what a machine inferred is a different job from deciding whether it is your
 * policy, and collapsing them invites people to click through the second one
 * while still doing the first.
 */
export const STEP_META: Record<Step, { label: string; heading: string; cli: string }> = {
  record: { label: 'Show the job', heading: 'Step 1 — show us the job', cli: 'rigorrun record' },
  learned: {
    label: 'What we learned',
    heading: 'Step 2 — review what RigorRun learned',
    cli: 'rigorrun compile trace.json -o contract.json',
  },
  confirm: {
    label: 'Confirm rules',
    heading: 'Step 3 — confirm the rules',
    cli: 'rigorrun compile trace.json -o contract.json',
  },
  benchmark: {
    label: 'Stress-test',
    heading: 'Step 4 — RigorRun stress-tests the job',
    cli: 'rigorrun generate contract.json -o benchmark.json',
  },
  run: {
    label: 'Connect agent',
    heading: 'Step 5 — connect an agent',
    cli: 'rigorrun compare benchmark.json',
  },
  verdict: {
    label: 'Pass or fail',
    heading: 'Step 6 — see whether it passes',
    cli: 'rigorrun gate benchmark.json --agent reference',
  },
};

export { WORKFLOWS };
export const DEFAULT_WORKFLOW = 'refund';

/** Where a run has got to, for honest progress reporting. */
export type RunPhase = 'idle' | 'seeding' | 'executing' | 'verifying' | 'scoring' | 'done';

export interface DemoState {
  step: Step;
  workflow: WorkflowDefinition;
  trace: CanonicalHumanTrace | null;
  draftContract: EnvironmentContract | null;
  contract: EnvironmentContract | null;
  benchmark: Benchmark | null;
  /** Inferred rules the reviewer explicitly rejected. */
  rejected: Set<string>;
  /** Inferred rules the reviewer explicitly confirmed. */
  confirmed: Set<string>;
  running: boolean;
  phase: RunPhase;
  liveResults: CaseResult[];
  activeCase: { agentId: string; caseName: string } | null;
  /**
   * How many agents the current run puts against the suite.
   *
   * Carried in state rather than assumed, because the screen that reports
   * progress used to assume two while three ran, and rendered "66 of 44 case
   * executions" with the bar at 150%.
   */
  agentCount: number;
  result: RunResult | null;
  elapsedMs: number | null;
  error: string | null;
  hydrating: boolean;
}

/**
 * One animation frame between case reveals.
 *
 * The benchmark itself takes tens of milliseconds; without this the whole run
 * would land in a single paint and a person would see nothing happen. This
 * paces *rendering*, not execution — each case's duration is measured and
 * recorded inside the runner before its progress event fires, so no reported
 * number is affected. Reduced-motion users skip it entirely.
 */
const FRAME_MS = 16;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function stepFromHash(hash: string): Step | null {
  const match = /^#\/demo\/([a-z]+)/.exec(hash);
  const candidate = match?.[1];
  return candidate && (STEPS as readonly string[]).includes(candidate) ? (candidate as Step) : null;
}

export function useDemo(workflowKey: string = DEFAULT_WORKFLOW) {
  const workflow = useMemo(() => workflowByKey(workflowKey), [workflowKey]);
  const [state, setState] = useState<DemoState>(() => ({
    step: stepFromHash(window.location.hash) ?? 'record',
    workflow,
    trace: null,
    draftContract: null,
    contract: null,
    benchmark: null,
    rejected: new Set(),
    confirmed: new Set(),
    running: false,
    phase: 'idle',
    liveResults: [],
    activeCase: null,
    agentCount: 0,
    result: null,
    elapsedMs: null,
    error: null,
    hydrating: false,
  }));

  const runToken = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const setStep = useCallback((step: Step, replace = false) => {
    const target = `#/demo/${step}${window.location.hash.includes('?') ? `?${window.location.hash.split('?')[1]}` : ''}`;
    if (window.location.hash !== target) {
      if (replace) window.history.replaceState(null, '', target);
      else window.location.hash = target;
    }
    setState((prev) => ({ ...prev, step }));
  }, []);

  /** Replays the recording to capture authoritative state either side of it. */
  const buildTrace = useCallback(
    async (): Promise<CanonicalHumanTrace> => recordDemonstration(workflow),
    [workflow],
  );

  const buildContract = useCallback(
    (recorded: CanonicalHumanTrace): EnvironmentContract =>
      induceContract(workflow.registration.create(), recorded, {
        contractId: `ec_${workflow.key}`,
        name: workflow.title,
      }).contract,
    [workflow],
  );

  const buildBenchmark = useCallback(
    async (draft: EnvironmentContract, confirmed: Set<string>, rejected: Set<string>) => {
      const contract = applyReview(draft, {
        confirmedRuleIds: [...confirmed],
        rejectedRuleIds: [...rejected],
      });
      const generation = await generateBenchmark(
        workflow.registration.create(),
        contract,
        [fixtureFor(workflow, workflow.fixtureId)],
        { benchmarkId: `bm_${workflow.key}` },
      );
      return { contract, benchmark: generation.benchmark };
    },
    [workflow],
  );

  const execute = useCallback(async (benchmark: Benchmark, options: { animate: boolean }) => {
    const token = (runToken.current += 1);
    const started = performance.now();
    const pace = options.animate && !prefersReducedMotion() ? FRAME_MS : 0;

    setState((prev) => ({
      ...prev,
      running: true,
      phase: 'seeding',
      liveResults: [],
      result: null,
      elapsedMs: null,
      error: null,
    }));

    try {
      // Two candidates plus the reference implementation, which is an oracle
      // and is labelled as one wherever it appears.
      const agents = [naiveAgent, carefulAgent, createReferenceAgent(benchmark)];
      // Tell the progress screen how many there are, rather than letting it
      // guess. It guessed two.
      setState((prev) => ({ ...prev, agentCount: agents.length }));
      const result = await runBenchmark(benchmark, agents, {
        onProgress: async (event) => {
          if (runToken.current !== token) return;
          if (event.type === 'case_started') {
            setState((prev) => ({
              ...prev,
              phase: 'executing',
              activeCase: { agentId: event.agentId, caseName: event.caseName },
            }));
          }
          if (event.type === 'case_finished') {
            setState((prev) => ({
              ...prev,
              phase: 'verifying',
              liveResults: [...prev.liveResults, event.result],
            }));
            if (pace > 0) await new Promise((resolve) => setTimeout(resolve, pace));
          }
        },
      });

      if (runToken.current !== token) return;
      setState((prev) => ({
        ...prev,
        running: false,
        phase: 'done',
        activeCase: null,
        result,
        elapsedMs: Math.round(performance.now() - started),
      }));
      return result;
    } catch (error) {
      if (runToken.current !== token) return;
      setState((prev) => ({
        ...prev,
        running: false,
        phase: 'idle',
        activeCase: null,
        error: (error as Error).message,
      }));
      return undefined;
    }
  }, []);

  /* ------------------------------------------------------------- actions */

  const compile = useCallback(async () => {
    const current = stateRef.current;
    if (current.draftContract) {
      setStep('learned');
      return;
    }
    setState((prev) => ({ ...prev, hydrating: true }));
    try {
      const recorded = current.trace ?? (await buildTrace());
      setState((prev) => ({
        ...prev,
        trace: recorded,
        draftContract: buildContract(recorded),
        hydrating: false,
      }));
      setStep('learned');
    } catch (error) {
      setState((prev) => ({ ...prev, hydrating: false, error: (error as Error).message }));
    }
  }, [buildContract, buildTrace, setStep]);

  const toggleRule = useCallback((ruleId: string, decision: 'confirm' | 'reject') => {
    setState((prev) => {
      if (
        prev.hydrating ||
        !prev.draftContract?.rules.some((rule) => rule.id === ruleId && rule.status === 'inferred')
      )
        return prev;
      const rejected = new Set(prev.rejected);
      const confirmed = new Set(prev.confirmed);
      if (decision === 'reject') {
        confirmed.delete(ruleId);
        if (rejected.has(ruleId)) rejected.delete(ruleId);
        else rejected.add(ruleId);
      } else {
        rejected.delete(ruleId);
        if (confirmed.has(ruleId)) confirmed.delete(ruleId);
        else confirmed.add(ruleId);
      }
      // A change upstream invalidates everything downstream.
      return {
        ...prev,
        rejected,
        confirmed,
        contract: null,
        benchmark: null,
        result: null,
        liveResults: [],
      };
    });
  }, []);

  const confirmAll = useCallback(() => {
    setState((prev) => {
      if (prev.hydrating || !prev.draftContract) return prev;
      const confirmed = new Set(prev.confirmed);
      for (const rule of prev.draftContract.rules) {
        if (rule.status === 'inferred' && !prev.rejected.has(rule.id)) confirmed.add(rule.id);
      }
      return { ...prev, confirmed, contract: null, benchmark: null, result: null, liveResults: [] };
    });
  }, []);

  const approveAndGenerate = useCallback(async () => {
    const current = stateRef.current;
    if (current.hydrating || !current.draftContract) return;
    if (
      current.draftContract.rules.some(
        (rule) =>
          rule.status === 'inferred' &&
          !current.confirmed.has(rule.id) &&
          !current.rejected.has(rule.id),
      )
    )
      return;
    setState((prev) => ({ ...prev, hydrating: true }));
    const recorded = current.trace ?? (await buildTrace());
    const draft = current.draftContract ?? buildContract(recorded);
    try {
      const { contract, benchmark } = await buildBenchmark(
        draft,
        current.confirmed,
        current.rejected,
      );
      setState((prev) => ({
        ...prev,
        trace: recorded,
        draftContract: draft,
        contract,
        benchmark,
        result: null,
        liveResults: [],
        error: null,
        hydrating: false,
      }));
      setStep('benchmark');
    } catch (error) {
      setState((prev) => ({ ...prev, hydrating: false, error: (error as Error).message }));
    }
  }, [buildBenchmark, buildContract, buildTrace, setStep]);

  const run = useCallback(async () => {
    const current = stateRef.current;
    if (current.running || !current.benchmark) return;
    setStep('run');
    const result = await execute(current.benchmark, { animate: true });
    if (result) setStep('verdict');
  }, [execute, setStep]);

  const reset = useCallback(() => {
    runToken.current += 1;
    setState({
      step: 'record',
      workflow,
      trace: null,
      draftContract: null,
      contract: null,
      benchmark: null,
      rejected: new Set(),
      confirmed: new Set(),
      running: false,
      phase: 'idle',
      liveResults: [],
      activeCase: null,
      agentCount: 0,
      result: null,
      elapsedMs: null,
      error: null,
      hydrating: false,
    });
    setStep('record', true);
  }, [setStep, workflow]);

  /* ----------------------------------------------------------- hydration */

  /**
   * A deep link or a refresh lands on a step whose artefacts do not exist yet.
   * The trace and inferred draft can be rebuilt. Human consent cannot: a later
   * step without this session's reviewed benchmark returns to review.
   */
  useEffect(() => {
    const target = stepFromHash(window.location.hash);
    if (!target || target === 'record') return;
    if (stateRef.current.draftContract) return;

    let cancelled = false;
    void (async () => {
      setState((prev) => ({ ...prev, hydrating: true }));
      try {
        const recorded = await buildTrace();
        if (cancelled) return;
        const draft = buildContract(recorded);
        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          trace: recorded,
          draftContract: draft,
          hydrating: false,
        }));
        if (target !== 'learned' && target !== 'confirm') setStep('confirm', true);
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, hydrating: false, error: (error as Error).message }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally mount-only: later navigation is driven by the actions
    // above, and the callbacks it closes over are stable.
  }, [buildContract, buildTrace, setStep]);

  /**
   * The recording is replayed as soon as the page opens.
   *
   * It is genuinely executed — the demonstration runs against the environment
   * adapter and the state either side of it is read back — so the first screen
   * shows what was actually captured rather than a stored transcript.
   */
  useEffect(() => {
    if (stateRef.current.trace) return;
    let cancelled = false;
    void (async () => {
      try {
        const recorded = await buildTrace();
        if (!cancelled) setState((prev) => (prev.trace ? prev : { ...prev, trace: recorded }));
      } catch (error) {
        if (!cancelled) setState((prev) => ({ ...prev, error: (error as Error).message }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildTrace]);

  /** Back and forward move between steps without discarding anything. */
  useEffect(() => {
    const onHashChange = () => {
      const target = stepFromHash(window.location.hash);
      if (!target) return;
      if (STEPS.indexOf(target) > STEPS.indexOf('confirm') && !stateRef.current.benchmark) {
        setStep('confirm', true);
        return;
      }
      setState((prev) => (prev.step === target ? prev : { ...prev, step: target }));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [setStep]);

  return { state, setStep, compile, toggleRule, confirmAll, approveAndGenerate, run, reset };
}

/** Steps the user may jump to, based on what has actually been produced. */
export function reachedSteps(state: DemoState): Set<Step> {
  const reached = new Set<Step>(['record']);
  if (state.draftContract) {
    reached.add('learned');
    reached.add('confirm');
  }
  if (state.benchmark) reached.add('benchmark');
  if (state.liveResults.length > 0 || state.running || state.result) reached.add('run');
  if (state.result) reached.add('verdict');
  return reached;
}
