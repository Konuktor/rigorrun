/**
 * `rigorrun stripe twin` — the local twin of Stripe's API, in the foreground.
 *
 * The way to try the pack with no account and no key: start this, point
 * `rigorrun stripe init --twin` and your agent at it, and every case runs on
 * this machine. The URL is printed alone on the first line, so a script can
 * start the twin and read where it is.
 */
import { parseArgs } from 'node:util';
import { TWIN_PORT } from '../conventions.ts';
import { DEFAULT_DISPUTE_DELAY_MS } from '../twin/model.ts';
import { startTwin } from '../twin/server.ts';
import { UsageError, say } from './common.ts';

export const TWIN_USAGE = `rigorrun stripe twin - a local twin of Stripe's API, for trying the pack with no keys

Runs in the foreground until Ctrl+C. Loopback only, and it holds nothing once
stopped. It accepts any test-mode key (sk_test_…, rk_test_…), e.g. sk_test_twin,
and refuses everything else.

OPTIONS
      --port <n>               Where it listens. Default ${TWIN_PORT}; 0 picks a free port.
      --dispute-delay-ms <n>   How long after a disputed payment its dispute opens.
                               Default ${DEFAULT_DISPUTE_DELAY_MS}.`;

/** The key an agent can use against the twin, which accepts any test-mode key. */
export const TWIN_AGENT_KEY = 'sk_test_twin';

function wholeNumber(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) throw new UsageError(`${flag} takes a whole number, not "${raw}".`);
  return Number(raw);
}

export async function cmdTwin(
  argv: string[],
  until: Promise<void> = interrupted(),
): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      'dispute-delay-ms': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    say(TWIN_USAGE);
    return 0;
  }
  const port = wholeNumber(values.port, '--port') ?? TWIN_PORT;
  const disputeDelayMs = wholeNumber(values['dispute-delay-ms'], '--dispute-delay-ms');

  const twin = await startTwin({
    port,
    ...(disputeDelayMs === undefined ? {} : { disputeDelayMs }),
  }).catch((error: unknown) => {
    if ((error as { code?: unknown }).code === 'EADDRINUSE') {
      throw new UsageError(
        `Port ${port} is taken — perhaps a twin is already running there. Use it, or pass --port 0.`,
      );
    }
    throw error;
  });
  say(twin.url);
  say();
  say('The Stripe twin is running on this machine. Nothing here reaches Stripe.');
  say(`  agent key   any test-mode key works, e.g. ${TWIN_AGENT_KEY}`);
  say(`  base URL    STRIPE_BASE_URL=${twin.url}`);
  say(`  next        rigorrun stripe init --twin ${twin.url} --yes`);
  say();
  say('Ctrl+C stops it; it keeps nothing.');
  try {
    await until;
  } finally {
    await twin.close();
  }
  return 0;
}

function interrupted(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
}
