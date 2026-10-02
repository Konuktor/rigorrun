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
/**
 * The other common shape of an identifier a system issues: a short lowercase
 * prefix, an underscore, and a token with at least one digit in it (rec_0042,
 * ab_3Fz9Q). Requiring the digit keeps ordinary snake_case words readable.
 */
const PREFIXED_ID = /\b[a-z]{1,8}_(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{3,}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const MONEY = /\$\d[\d,]*(?:\.\d{1,2})?/g;

const WITHHELD = '(withheld from the published report)';

export function maskPrivateText(text: string): string {
  return text
    .replace(EMAIL, '\u2039address\u203a')
    .replace(RECORD_ID, '\u2039id\u203a')
    .replace(PREFIXED_ID, '\u2039id\u203a')
    .replace(MONEY, '$\u2039amount\u203a');
}

export function sanitizeRunResult(run: RunResult): RunResult {
  return {
    ...run,
    caseResults: run.caseResults.map((result, index) => sanitizeCaseResult(result, index)),
  };
}

function sanitizeCaseResult(result: CaseResult, index: number): CaseResult {
  // The identifiers a case's records were created under are the private
  // workflow's own record identifiers, so they go with the task inputs.
  const { materialized: _materialized, ...kept } = result;
  return {
    ...kept,
    // Case names describe the customer's own business process.
    caseName: `Case ${index + 1}`,
    // The reason quotes the failed checks' messages, which name the records
    // they looked at — the bound identifiers of a materialized case above all.
    outcomeReason: maskPrivateText(result.outcomeReason),
    ...(result.error !== undefined ? { error: maskPrivateText(result.error) } : {}),
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
      // How the answer was reached, and how much a failure matters, are safe
      // to publish: they describe the check, not the customer's data.
      verificationSource: assertion.verificationSource,
      failureSeverity: assertion.failureSeverity,
      blocking: assertion.blocking,
      // Which boundary the check guards names a kind of rule, not a record.
      ...(assertion.dimension ? { dimension: assertion.dimension } : {}),
      message: WITHHELD,
    })),
    agentReport: WITHHELD,
    // What the system showed is a reading of the customer's records, as the
    // final state summary is, so its sentences go too. Whose account it was
    // stays, so the published page still says that one was taken.
    ...(result.reality ? { reality: { system: result.reality.system, lines: [WITHHELD] } } : {}),
    // What the reads covered is a statement about the verdict, and is kept;
    // any identifier written into it is masked like a check description's.
    ...(result.readScope ? { readScope: maskPrivateText(result.readScope) } : {}),
    finalStateSummary: {},
  };
}

/** Field-by-field description of what publishing removes, shown in the preview. */
export const SANITIZATION_NOTES = [
  'Task inputs, including every record identifier, are removed.',
  'Case names are replaced with case numbers; only the category label is kept.',
  'Record identifiers and money amounts inside check descriptions are masked.',
  'Tool arguments and tool results are removed; only the tool name and outcome remain.',
  'Assertion evidence (observed and expected values) is removed; only PASS/FAIL/ERROR remains.',
  'Agent prose reports are removed.',
  'What the system showed at the end of each case is removed; only whose account it was remains.',
  'The identifiers each case\u2019s records were created under are removed, and any inside a read scope are masked.',
  'Final state summaries are removed.',
  'Scores, category labels, agent labels, hashes and timestamps are kept.',
] as const;
