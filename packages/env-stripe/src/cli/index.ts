/**
 * `rigorrun stripe …` — the Stripe pack's own commands.
 *
 * RigorRun hands the pack everything after `stripe` (see `packs.ts` in the
 * CLI), so the pack parses its own flags. The commands are the founder's
 * path, in order: a twin to try it with no keys, a project with its suite,
 * one small canary, and then RigorRun's own `agent add` and `gate`.
 */
import { CANARY_USAGE, cmdCanary } from './canary.ts';
import { UsageError, say, warn } from './common.ts';
import { INIT_USAGE, cmdInit } from './init.ts';
import { TWIN_USAGE, cmdTwin } from './twin.ts';

export const STRIPE_USAGE = `rigorrun stripe - test a refund agent against Stripe test mode, or a local twin

  rigorrun stripe twin                         a local twin of Stripe's API; no keys
  rigorrun stripe init --twin                  a project against the twin
  rigorrun stripe init --safety staging        a project against your test mode
                                               (key in $STRIPE_TEST_KEY)
  rigorrun stripe canary --project <id>        one $1.00 refund, before the suite

Then connect your agent and gate on it:

  rigorrun agent add --project <id> --name my-agent --black-box <url> --claim-path message
  rigorrun gate --project <id> --report report.html

Live mode is never used: keys must be test-mode keys, and Stripe is asked to
confirm it before anything is stored. Add --help to any command for its options.`;

const COMMANDS: Record<string, { run: (argv: string[]) => Promise<number>; usage: string }> = {
  init: { run: (argv) => cmdInit(argv), usage: INIT_USAGE },
  twin: { run: (argv) => cmdTwin(argv), usage: TWIN_USAGE },
  canary: { run: (argv) => cmdCanary(argv), usage: CANARY_USAGE },
};

export async function stripeCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    say(STRIPE_USAGE);
    return command === undefined ? 2 : 0;
  }
  const found = COMMANDS[command];
  if (!found) {
    warn(`Unknown command "stripe ${command}".`);
    warn('Run `rigorrun stripe --help` for the commands.');
    return 2;
  }
  try {
    return await found.run(rest);
  } catch (error) {
    // A refusal, or a flag `parseArgs` does not know: the message is the answer.
    if (
      error instanceof UsageError ||
      (error as { code?: unknown }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
    ) {
      warn((error as Error).message);
      return 2;
    }
    throw error;
  }
}

export { cmdCanary, cmdInit, cmdTwin };
export { exampleTicket, parseAmount, terminalIo, TWIN_KEY_SECRET, type InitIo } from './init.ts';
export { TWIN_AGENT_KEY } from './twin.ts';
