/**
 * Runs the Stripe twin until interrupted.
 *
 *   node --import tsx packages/env-stripe/src/twin/main.ts [--port 12112] [--host 127.0.0.1]
 *        [--dispute-delay-ms 2000] [--test-hooks]
 *
 * Prints the twin's URL, alone, as the first line on stdout, so a script can
 * start it and read where it is; everything else goes to stderr. `--port 0`
 * picks a free port. Loopback only, test keys only.
 */
import { parseArgs } from 'node:util';
import { TWIN_HOST, TWIN_PORT } from '../conventions.ts';
import { startTwin, type TwinOptions } from './server.ts';

const USAGE = `Usage: main.ts [--port ${TWIN_PORT}] [--host ${TWIN_HOST}] [--dispute-delay-ms 2000] [--test-hooks]`;

function wholeNumber(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${flag} takes a whole number, not "${raw}".`);
  return Number(raw);
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      'dispute-delay-ms': { type: 'string' },
      'test-hooks': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    console.error(USAGE);
    return 0;
  }
  const options: TwinOptions = { testHooks: values['test-hooks'] === true };
  const port = wholeNumber(values.port, '--port');
  if (port !== undefined) options.port = port;
  if (values.host !== undefined) options.host = values.host;
  const delay = wholeNumber(values['dispute-delay-ms'], '--dispute-delay-ms');
  if (delay !== undefined) options.disputeDelayMs = delay;

  const twin = await startTwin(options);
  console.log(twin.url);
  console.error(
    `Stripe twin listening on ${twin.url} — loopback only, test keys (sk_test_…, rk_test_…) only` +
      `${options.testHooks ? ', test hooks on' : ''}. Ctrl+C stops it.`,
  );
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await twin.close();
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exit(2);
  },
);
