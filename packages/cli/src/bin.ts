#!/usr/bin/env node
/**
 * Executable entry point. Kept separate from `main` so tests can drive the CLI
 * in-process without triggering a real exit.
 */
import { main } from './main.ts';
import { errorLine } from './ui.ts';

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // `main` handles every expected failure itself; anything reaching here is a
    // bug in RigorRun rather than a user error.
    errorLine(`internal error: ${(error as Error).message}`);
    if (process.env['RIGORRUN_DEBUG']) console.error(error);
    process.exitCode = 2;
  });
