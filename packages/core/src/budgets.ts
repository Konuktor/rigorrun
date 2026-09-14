/**
 * The budget hierarchy, from the inside out.
 *
 * A tool call gives up after `DEFAULT_TOOL_CALL_TIMEOUT_MS`. A case must be
 * able to outlast one call that never answers *and* the agent's response to
 * that — a retry, a read to check — or the case dies before the behaviour it
 * exists to observe (audit R-4: a 15 s case under a 20 s tool timeout could
 * not survive a single lost response). An agent process is given at least the
 * case budget plus a margin, so the runner's budget is always the one that
 * fires and a timeout is recorded as TIMED_OUT rather than as an agent crash.
 */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 20_000;
export const DEFAULT_CASE_TIMEOUT_MS = 60_000;
export const BUDGET_MARGIN_MS = 5_000;
