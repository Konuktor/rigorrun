/**
 * The decisions that turn a tool surface into an environment.
 *
 * Connecting to an MCP server tells RigorRun what can be *done*. It says
 * nothing about what can be *checked*, what can be *undone*, or how much
 * damage a mistake would cause — and those three are what decide whether a
 * verdict is worth anything. None of them can be discovered, so all three are
 * configuration, supplied by the person who knows.
 *
 * That is the boundary this file draws, and why an MCP connection is
 * deliberately not an `EnvironmentAdapter` on its own.
 */
import type { SafetyMode } from '@rigorrun/environment';

/**
 * A read operation nominated as the way to see one kind of record.
 *
 * "Verifier read" is the important phrase: these are the calls RigorRun makes
 * *after* an agent has finished, to find out what actually happened, and they
 * are the entire reason a verdict can rest on the system rather than on the
 * agent's account of itself. A system with none of these can still be driven;
 * it just cannot be graded, and RigorRun says so rather than falling back to
 * believing the agent.
 */
export interface VerifierRead {
  /** The tool to call. Must be one the operator has confirmed is read-only. */
  tool: string;
  /** Fixed arguments, if the call needs any. */
  args?: Record<string, unknown>;
  /** Which record type the rows in the answer belong to. */
  entity: string;
}

export type ResetStrategy =
  | { kind: 'tool'; tool: string; args?: Record<string, unknown> }
  | { kind: 'none' };

export interface McpEnvironmentConfig {
  id: string;
  name: string;
  description: string;
  /** Confirmed or draft, but always reviewed by a person before it gates. */
  verifierReads: readonly VerifierRead[];
  reset: ResetStrategy;
  safety: SafetyMode;
  /**
   * Tools the operator has confirmed only read.
   *
   * Not the server's `readOnlyHint` — a person's decision. This is the list
   * that decides which tools RigorRun will call freely while working out what
   * a system looks like, so it is the one place a server's opinion of itself
   * must not be able to reach.
   */
  readOnlyTools: readonly string[];
}
