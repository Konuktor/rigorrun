/**
 * The golden path, assembled once and reused by the CLI, the dashboard and the
 * tests: recorded trace → contract → approved contract → benchmark.
 *
 * Keeping this in one place is what stops the demo and the CLI drifting apart:
 * they run the same pipeline over the same data.
 */
import type { Benchmark, WorkflowContract, WorkflowTrace } from '@rigorrun/core';
import { parseTrace } from '@rigorrun/core';
import { EXAMPLE_REFUND_TRACE } from '@rigorrun/northstar';
import { approveContract, compileTrace } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';

export interface DemoPipeline {
  trace: WorkflowTrace;
  /** Straight out of the compiler: inferences still unconfirmed. */
  draftContract: WorkflowContract;
  /** After a human accepts the proposed rules in the review step. */
  contract: WorkflowContract;
  benchmark: Benchmark;
}

export interface DemoPipelineOptions {
  trace?: WorkflowTrace;
  /** Rules the reviewer rejected; their assertions are dropped entirely. */
  rejectedRuleIds?: string[];
  createdAt?: string;
}

export async function buildDemoPipeline(options: DemoPipelineOptions = {}): Promise<DemoPipeline> {
  const createdAt = options.createdAt ?? '2026-01-20T09:05:00.000Z';
  const trace = parseTrace(options.trace ?? EXAMPLE_REFUND_TRACE);

  const draftContract = compileTrace(trace, {
    contractId: 'wfc_refund_v1',
    name: 'Standard customer refund',
    createdAt,
  });

  const rejected = new Set(options.rejectedRuleIds ?? []);
  const contract = approveContract(
    draftContract,
    {
      confirmedRuleIds: [
        ...draftContract.preconditions,
        ...draftContract.requiredActions,
        ...draftContract.forbiddenActions,
      ]
        .map((rule) => rule.id)
        .filter((id) => !rejected.has(id)),
      rejectedRuleIds: [...rejected],
    },
    createdAt,
  );

  const benchmark = await generateBenchmark(contract, {
    benchmarkId: 'bm_refund_v1',
    name: 'Refund processing — private benchmark',
    createdAt,
  });

  return { trace, draftContract, contract, benchmark };
}
