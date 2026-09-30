/**
 * `--after-case <program>`: runs after each case has finished — its final state
 * read included — and before the next case starts.
 *
 * Generic on purpose. A harness that judges each case with its own oracle, on a
 * system nothing resets between cases, needs exactly this point, and RigorRun
 * has no business knowing what the program reads. What it does owe is honesty
 * about failure: a reading that could not be taken must not be scored as if it
 * had been, so a program that fails, or does not finish, stops the run.
 *
 * It starts the way every command RigorRun starts does (@rigorrun/exec): the
 * program itself, never a shell, with no arguments, a minimal environment rather
 * than all of this one, and stated as typed by the operator. What identifies the
 * case arrives as RIGORRUN_* variables.
 */
import type { CaseResult } from '@rigorrun/core';
import { runCommand } from '@rigorrun/exec';
import { CliError } from './io.ts';

/** A reading that takes longer than this is treated as one that failed. */
export const AFTER_CASE_TIMEOUT_MS = 10 * 60_000;

export type AfterCase = (result: CaseResult, index: number) => Promise<void>;

export function afterCaseHook(program: string): AfterCase {
  return async (result, index) => {
    let outcome: Awaited<ReturnType<typeof runCommand>>;
    try {
      outcome = await runCommand({
        command: program,
        args: [],
        env: {
          RIGORRUN_RUN_ID: result.runId,
          RIGORRUN_AGENT_ID: result.agentId,
          RIGORRUN_CASE_ID: result.caseId,
          RIGORRUN_CASE_INDEX: String(index),
          RIGORRUN_CASE_OUTCOME: result.outcome ?? '',
          RIGORRUN_CASE_CATEGORY: result.category,
        },
        timeoutMs: AFTER_CASE_TIMEOUT_MS,
        provenance: 'operator-configured',
      });
    } catch (error) {
      throw new CliError(`--after-case could not run after ${result.caseId}: ${(error as Error).message}`, 2);
    }

    // Standard output belongs to the run itself, which may be --json.
    if (outcome.stdout) process.stderr.write(outcome.stdout);
    if (outcome.stderr) process.stderr.write(outcome.stderr);
    if (outcome.code === 0 && !outcome.timedOut) return;

    const how = outcome.timedOut
      ? `did not finish within ${AFTER_CASE_TIMEOUT_MS / 1000} s`
      : outcome.signal
        ? `was stopped by ${outcome.signal}`
        : `exited ${outcome.code}`;
    throw new CliError(
      `--after-case ${how} after ${result.caseId}. The run was stopped, so no case is scored without its reading.`,
      2,
    );
  };
}
