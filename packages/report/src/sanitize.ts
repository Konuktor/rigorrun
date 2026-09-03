/**
 * Sanitised reports.
 *
 * A published report must never carry the private workflow it was built from.
 * What survives: scores, assertion outcomes, category labels, agent labels,
 * hashes and timestamps. What is stripped: task inputs, tool arguments, tool
 * results, agent prose, customer content and observed values.
 *
 * The removal is structural, not a text filter — private fields are dropped
 * rather than scrubbed, so nothing can survive by being formatted unusually.
 */
import type { CaseResult, RunResult } from '@rigorrun/core';

/**
 * Record identifiers (CUST-2016, ORD-3001, TCK-4001, REF-7001 …) and money
 * amounts leak the shape of the private workflow, and they turn up inside
 * RigorRun-authored assertion descriptions such as "the refund references
 * ticket TCK-4001". Masking is done on the way out rather than at authoring
 * time so the full report keeps its readable evidence.
 */
const RECORD_ID = /\b[A-Z]{2,6}-\d{3,}\b/g;
const MONEY = /\$\d[\d,]*(?:\.\d{1,2})?/g;

export function maskPrivateText(text: string): string {
  return text.replace(RECORD_ID, '\u2039id\u203a').replace(MONEY, '$\u2039amount\u203a');
}

export function sanitizeRunResult(run: RunResult): RunResult {
  return {
    ...run,
    caseResults: run.caseResults.map((result, index) => sanitizeCaseResult(result, index)),
  };
}

function sanitizeCaseResult(result: CaseResult, index: number): CaseResult {
  return {
    ...result,
    // Case names describe the customer's own business process.
    caseName: `Case ${index + 1}`,
    // Tool arguments and results carry customer data verbatim.
    steps: result.steps.map((step) => ({
      index: step.index,
      at: step.at,
      tool: step.tool,
      args: {},
      ok: step.ok,
      ...(step.error ? { error: step.error } : {}),
    })),
    actions: result.actions.map((action) => ({
      type: action.type,
      at: action.at,
      payload: {},
      ok: action.ok,
      ...(action.error ? { error: action.error } : {}),
    })),
    assertions: result.assertions.map((assertion) => ({
      assertionId: assertion.assertionId,
      kind: assertion.kind,
      description: maskPrivateText(assertion.description),
      status: assertion.status,
      severity: assertion.severity,
      evaluator: assertion.evaluator,
      unsafe: assertion.unsafe,
      message: '(withheld from the published report)',
    })),
    agentReport: '(withheld from the published report)',
    finalStateSummary: {},
  };
}

/** Field-by-field description of what publishing removes, shown in the preview. */
export const SANITIZATION_NOTES = [
  'Task inputs (customer, order and ticket identifiers) are removed.',
  'Case names are replaced with case numbers; only the category label is kept.',
  'Record identifiers and money amounts inside check descriptions are masked.',
  'Tool arguments and tool results are removed; only the tool name and outcome remain.',
  'Assertion evidence (observed and expected values) is removed; only PASS/FAIL/ERROR remains.',
  'Agent prose reports are removed.',
  'Final state summaries are removed.',
  'Scores, category labels, agent labels, hashes and timestamps are kept.',
] as const;
