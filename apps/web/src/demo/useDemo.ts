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
  parseTrace,
  type Benchmark,
  type CaseResult,
  type RunResult,
  type WorkflowContract,
  type WorkflowTrace,
} from '@rigorrun/core';
import { EXAMPLE_REFUND_TRACE } from '@rigorrun/northstar';
import { approveContract, compileTrace } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { demoRobustAgent, demoWeakAgent } from '@rigorrun/agents';
import { runBenchmark } from '@rigorrun/runner';

export const STEPS = ['record', 'contract', 'benchmark', 'run', 'verdict'] as const;
export type Step = (typeof STEPS)[number];

export const STEP_META: Record<Step, { label: string; cli: string }> = {
  record: { label: 'Record', cli: 'rigorrun record' },
  contract: { label: 'Contract', cli: 'rigorrun compile trace.json -o contract.json' },
  benchmark: { label: 'Benchmark', cli: 'rigorrun generate contract.json -o benchmark.json' },
  run: { label: 'Run', cli: 'rigorrun compare benchmark.json' },
  verdict: { label: 'Verdict', cli: 'rigorrun gate benchmark.json --agent demo-robust' },
};

/** Where a run has got to, for honest progress reporting. */
export type RunPhase = 'idle' | 'seeding' | 'executing' | 'verifying' | 'scoring' | 'done';

export interface DemoState {
  step: Step;
  trace: WorkflowTrace;
  draftContract: WorkflowContract | null;
  contract: WorkflowContract | null;
  benchmark: Benchmark | null;
  /** Inferred rules the reviewer explicitly rejected. */
  rejected: Set<string>;
  /** Inferred rules the reviewer explicitly confirmed. */
  confirmed: Set<string>;
  running: boolean;
  phase: RunPhase;
  liveResults: CaseResult[];
  activeCase: { agentId: string; caseName: string } | null;
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

export function useDemo() {
  const trace = useMemo(() => parseTrace(EXAMPLE_REFUND_TRACE), []);
  const [state, setState] = useState<DemoState>(() => ({
    step: stepFromHash(window.location.hash) ?? 'record',
    trace,
    draftContract: null,
    contract: null,
    benchmark: null,
    rejected: new Set(),
    confirmed: new Set(),
    running: false,
    phase: 'idle',
    liveResults: [],
    activeCase: null,
    result: null,
    elapsedMs: null,
    error: null,
    hydrating: false,
  }));

  const runToken = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const setStep = useCallback((step: Step, replace = false) => {
    const target = `#/demo/${step}`;
    if (window.location.hash !== target) {
      if (replace) window.history.replaceState(null, '', target);
      else window.location.hash = target;
    }
    setState((prev) => ({ ...prev, step }));
  }, []);

  /** Compile is pure and instant; it is safe to run whenever it is needed. */
  const buildContract = useCallback(
    (): WorkflowContract =>
      compileTrace(trace, { contractId: 'wfc_refund_v1', name: 'Standard customer refund' }),
    [trace],
  );

  const buildBenchmark = useCallback(async (draft: WorkflowContract, rejected: Set<string>) => {
    const ruleIds = [
      ...draft.preconditions,
      ...draft.requiredActions,
      ...draft.forbiddenActions,
    ].map((rule) => rule.id);
    const contract = approveContract(draft, {
      confirmedRuleIds: ruleIds.filter((id) => !rejected.has(id)),
      rejectedRuleIds: [...rejected],
    });
    const benchmark = await generateBenchmark(contract, {
      benchmarkId: 'bm_refund_v1',
      name: 'Refund processing — private benchmark',
    });
    return { contract, benchmark };
  }, []);

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
      const result = await runBenchmark(benchmark, [demoWeakAgent, demoRobustAgent], {
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

  const compile = useCallback(() => {
    setState((prev) => ({ ...prev, draftContract: prev.draftContract ?? buildContract() }));
    setStep('contract');
  }, [buildContract, setStep]);

  const toggleRule = useCallback((ruleId: string, decision: 'confirm' | 'reject') => {
    setState((prev) => {
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
      return { ...prev, rejected, confirmed, benchmark: null, result: null, liveResults: [] };
    });
  }, []);

  const approveAndGenerate = useCallback(async () => {
    const current = stateRef.current;
    const draft = current.draftContract ?? buildContract();
    try {
      const { contract, benchmark } = await buildBenchmark(draft, current.rejected);
      setState((prev) => ({
        ...prev,
        draftContract: draft,
        contract,
        benchmark,
        result: null,
        liveResults: [],
        error: null,
      }));
      setStep('benchmark');
    } catch (error) {
      setState((prev) => ({ ...prev, error: (error as Error).message }));
    }
  }, [buildBenchmark, buildContract, setStep]);

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
      trace,
      draftContract: null,
      contract: null,
      benchmark: null,
      rejected: new Set(),
      confirmed: new Set(),
      running: false,
      phase: 'idle',
      liveResults: [],
      activeCase: null,
      result: null,
      elapsedMs: null,
      error: null,
      hydrating: false,
    });
    setStep('record', true);
  }, [setStep, trace]);

  /* ----------------------------------------------------------- hydration */

  /**
   * A deep link or a refresh lands on a step whose artefacts do not exist yet.
   * Because the pipeline is deterministic, rebuilding them reproduces exactly
   * what the user would have had — including re-executing the benchmark, which
   * is a real run, not a replay of stored numbers.
   */
  useEffect(() => {
    const target = stepFromHash(window.location.hash);
    if (!target || target === 'record') return;
    if (stateRef.current.draftContract) return;

    let cancelled = false;
    void (async () => {
      setState((prev) => ({ ...prev, hydrating: true }));
      try {
        const draft = buildContract();
        if (cancelled) return;

        if (target === 'contract') {
          setState((prev) => ({ ...prev, draftContract: draft, hydrating: false }));
          return;
        }

        const { contract, benchmark } = await buildBenchmark(draft, new Set());
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          draftContract: draft,
          contract,
          benchmark,
          hydrating: false,
        }));

        if (target === 'run' || target === 'verdict') {
          await execute(benchmark, { animate: target === 'run' });
        }
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
  }, [buildContract, buildBenchmark, execute]);

  /** Back and forward move between steps without discarding anything. */
  useEffect(() => {
    const onHashChange = () => {
      const target = stepFromHash(window.location.hash);
      if (target) setState((prev) => (prev.step === target ? prev : { ...prev, step: target }));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return { state, setStep, compile, toggleRule, approveAndGenerate, run, reset };
}

/** Steps the user may jump to, based on what has actually been produced. */
export function reachedSteps(state: DemoState): Set<Step> {
  const reached = new Set<Step>(['record']);
  if (state.draftContract) reached.add('contract');
  if (state.benchmark) reached.add('benchmark');
  if (state.liveResults.length > 0 || state.running || state.result) reached.add('run');
  if (state.result) reached.add('verdict');
  return reached;
}
