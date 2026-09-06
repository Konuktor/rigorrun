/**
 * The agent adapter boundary.
 *
 * An agent sees only `AgentTask` — the public half of a benchmark case. It
 * never receives the assertions it will be judged against, and it has no way to
 * reach them: the runner builds this input with `publicCaseView`, and a test
 * asserts at runtime that no verifier internals appear in it.
 */
import type { AgentTask, TokenUsage } from '@rigorrun/core';

/**
 * What a tool call gives back.
 *
 * Defined here rather than imported from any environment: the agent boundary
 * must not know which business system it is pointed at.
 */
export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface AgentRunInput {
  caseId: string;
  task: AgentTask;
  maxSteps: number;
}

/** The only channel through which an agent may affect the world. */
export interface AgentEnvironment {
  call(tool: string, args?: Record<string, unknown>): Promise<ToolResult>;
  /** Remaining step budget. Reaching zero ends the run. */
  stepsRemaining(): number;
  /** Optional free-text reasoning attached to the next step, for evidence. */
  note(text: string): void;
}

export interface AgentRunOutput {
  /** The agent's own account of what it did. Displayed, never scored. */
  report: string;
  usage?: TokenUsage | null;
  costUsd: number | null;
  costNote: string;
}

/**
 * `external` is an agent RigorRun cannot start — see `drivenAgent.ts` in the
 * daemon. It is a kind rather than a flag on `http` because nothing about it
 * is a URL: there is no endpoint to probe and nothing to call.
 */
export type AgentKind = 'demo' | 'http' | 'llm' | 'process' | 'external';

export interface AgentAdapter {
  id: string;
  name: string;
  kind: AgentKind;
  description: string;
  execute(input: AgentRunInput, env: AgentEnvironment): Promise<AgentRunOutput>;
}

export const NO_MODEL_COST = {
  costUsd: 0,
  costNote: 'no model calls — deterministic local agent',
} as const;
