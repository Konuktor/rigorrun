/**
 * The demo's state machine.
 *
 * Every step runs the real package code in the browser — the same compiler,
 * generator, runner and verifier the CLI and CI use. Nothing here is mocked,
 * and no result is precomputed.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
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

export const STEPS = ['record', 'compile', 'generate', 'run', 'verdict'] as const;
export type Step = (typeof STEPS)[number];

export interface DemoState {
  step: Step;
  trace: WorkflowTrace;
  draftContract: WorkflowContract | null;
  contract: WorkflowContract | null;
  benchmark: Benchmark | null;
  rejected: Set<string>;
  running: boolean;
  liveResults: CaseResult[];
  activeCase: { agentId: string; caseName: string } | null;
  result: RunResult | null;
  error: string | null;
}

/**
 * Milliseconds paused between cases so a person can watch the run.
 *
 * This paces the *display* only. Each case's duration is measured and recorded
 * inside the runner before its progress event fires, so the reported latency is
 * unaffected by this delay.
 */
const DISPLAY_PACE_MS = 55;

export function useDemo() {
  const trace = useMemo(() => parseTrace(EXAMPLE_REFUND_TRACE), []);
  const [state, setState] = useState<DemoState>({
    step: 'record',
    trace,
    draftContract: null,
    contract: null,
    benchmark: null,
    rejected: new Set(),
    running: false,
    liveResults: [],
    activeCase: null,
    result: null,
    error: null,
  });
  const cancelled = useRef(false);

  const goto = useCallback((step: Step) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  const compile = useCallback(() => {
    setState((prev) => ({
      ...prev,
      draftContract: compileTrace(prev.trace, {
        contractId: 'wfc_refund_v1',
        name: 'Standard customer refund',
      }),
      step: 'compile',
    }));
  }, []);

  const toggleRule = useCallback((ruleId: string) => {
    setState((prev) => {
      const rejected = new Set(prev.rejected);
      if (rejected.has(ruleId)) rejected.delete(ruleId);
      else rejected.add(ruleId);
      return { ...prev, rejected };
    });
  }, []);

  const approveAndGenerate = useCallback(async () => {
    setState((prev) => ({ ...prev, error: null }));
    try {
      const draft = state.draftContract ?? compileTrace(state.trace);
      const allRuleIds = [
        ...draft.preconditions,
        ...draft.requiredActions,
        ...draft.forbiddenActions,
      ].map((rule) => rule.id);

      const contract = approveContract(draft, {
        confirmedRuleIds: allRuleIds.filter((id) => !state.rejected.has(id)),
        rejectedRuleIds: [...state.rejected],
      });
      const benchmark = await generateBenchmark(contract, {
        benchmarkId: 'bm_refund_v1',
        name: 'Refund processing — private benchmark',
      });
      setState((prev) => ({
        ...prev,
        contract,
        benchmark,
        step: 'generate',
        result: null,
        liveResults: [],
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: (error as Error).message }));
    }
  }, [state.draftContract, state.rejected, state.trace]);

  const run = useCallback(async () => {
    if (!state.benchmark) return;
    cancelled.current = false;
    setState((prev) => ({
      ...prev,
      step: 'run',
      running: true,
      liveResults: [],
      result: null,
      error: null,
    }));

    try {
      const result = await runBenchmark(state.benchmark, [demoWeakAgent, demoRobustAgent], {
        onProgress: async (event) => {
          if (cancelled.current) return;
          if (event.type === 'case_started') {
            setState((prev) => ({
              ...prev,
              activeCase: { agentId: event.agentId, caseName: event.caseName },
            }));
          }
          if (event.type === 'case_finished') {
            setState((prev) => ({ ...prev, liveResults: [...prev.liveResults, event.result] }));
            await new Promise((resolve) => setTimeout(resolve, DISPLAY_PACE_MS));
          }
        },
      });
      setState((prev) => ({ ...prev, running: false, activeCase: null, result, step: 'verdict' }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        running: false,
        activeCase: null,
        error: (error as Error).message,
      }));
    }
  }, [state.benchmark]);

  const reset = useCallback(() => {
    cancelled.current = true;
    setState({
      step: 'record',
      trace,
      draftContract: null,
      contract: null,
      benchmark: null,
      rejected: new Set(),
      running: false,
      liveResults: [],
      activeCase: null,
      result: null,
      error: null,
    });
  }, [trace]);

  return { state, goto, compile, toggleRule, approveAndGenerate, run, reset };
}
