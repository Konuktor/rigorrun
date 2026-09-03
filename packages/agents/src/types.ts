/**
 * The agent adapter boundary.
 *
 * An agent sees only `AgentTask` — the public half of a benchmark case. It
 * never receives the assertions it will be judged against, and it has no way to
 * reach them: the runner builds this input with `publicCaseView`, and a test
 * asserts at runtime that no verifier internals appear in it.
 */
import type { AgentTask, TokenUsage } from '@rigorrun/core';
import type { ToolResult } from '@rigorrun/northstar';

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

export type AgentKind = 'demo' | 'http' | 'llm' | 'process';

export interface AgentAdapter {
  id: string;
  name: string;
  kind: AgentKind;
  description: string;
  execute(input: AgentRunInput, env: AgentEnvironment): Promise<AgentRunOutput>;
}

/** Reads the self-serve limit out of the policy the agent was handed. */
export function limitFromBrief(brief: string, fallback = 50): number {
  const match =
    /above \$(\d+(?:\.\d+)?)/i.exec(brief) ?? /\$(\d+(?:\.\d+)?)\s*or less/i.exec(brief);
  return match?.[1] ? Number(match[1]) : fallback;
}

/** Strict money parse — free text never silently becomes an amount. */
export function strictAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  if (!/^\s*\d+(\.\d{1,2})?\s*$/.test(raw)) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

export const NO_MODEL_COST = {
  costUsd: 0,
  costNote: 'no model calls — deterministic local agent',
} as const;
