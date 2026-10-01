/**
 * Runs the Stripe conformance script against the twin or Stripe test mode.
 *
 *   node --import tsx packages/env-stripe/scripts/conformance.ts --target twin
 *   node --import tsx packages/env-stripe/scripts/conformance.ts --target live \
 *        [--key-env STRIPE_TEST_KEY] [--write-golden]
 *
 * Options:
 *   --target twin|live   Required. `twin` starts an in-process twin unless --base-url names a
 *                        running one (loopback only). `live` talks to https://api.stripe.com.
 *   --base-url URL       Where to send requests instead. For `live`, only api.stripe.com or
 *                        loopback is accepted.
 *   --key-env NAME       The environment variable holding the key. Default STRIPE_TEST_KEY.
 *                        Required for `live`; for `twin` any sk_test_ key works and a fixed
 *                        one is used when the variable is unset.
 *   --write-golden       Record the run as test/golden/stripe-live.json. `live` only.
 *   --out FILE           Also write this run's normalized transcript to FILE.
 *
 * The golden file is recorded against Stripe test mode with `--target live --write-golden`,
 * and it is the authority: where the twin and it disagree, the twin is fixed, never the file.
 * A run against the twin is compared with it when it exists (CI does the same through
 * test/twin.conformance.test.ts). A run against Stripe without --write-golden is compared too,
 * which is how a change on Stripe's side shows up.
 *
 * Against Stripe the run refuses to start unless the key starts with sk_test_ or rk_test_ and
 * GET /v1/balance answers livemode: false, and it stops the moment any response carries
 * livemode: true. The key is read from the environment only and is never printed. The run
 * creates two customers, three payments and a handful of refunds in that test-mode account,
 * tagged with metadata rigorrun_conformance; use a dedicated Sandbox.
 *
 * Exit status: 0 when every step behaved as the pack relies on and nothing differs from the
 * golden file; 1 otherwise; 2 when the run could not start.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LIVE_URL } from '../src/conventions.ts';
import {
  GOLDEN_ABOUT,
  compareToGolden,
  guardTestMode,
  runConformance,
  type GoldenFile,
} from '../src/twin/conformance.ts';
import { isLoopbackHost, startTwin, type RunningTwin } from '../src/twin/server.ts';

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test',
  'golden',
  'stripe-live.json',
);
const TWIN_KEY = 'sk_test_rigorrun_conformance';

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: 'string' },
      'base-url': { type: 'string' },
      'key-env': { type: 'string' },
      'write-golden': { type: 'boolean' },
      out: { type: 'string' },
    },
    strict: true,
  });
  const target = values.target;
  if (target !== 'twin' && target !== 'live') {
    console.error('--target twin or --target live is required.');
    return 2;
  }
  if (values['write-golden'] && target !== 'live') {
    console.error(
      'The golden file is recorded against Stripe only (--target live): it is the authority the ' +
        'twin is checked against, so the twin cannot write it.',
    );
    return 2;
  }
  const keyEnv = values['key-env'] ?? 'STRIPE_TEST_KEY';
  const fromEnv = process.env[keyEnv];

  let twin: RunningTwin | undefined;
  let baseUrl: string;
  let key: string;
  if (target === 'twin') {
    key = fromEnv ?? TWIN_KEY;
    if (values['base-url'] !== undefined) {
      baseUrl = values['base-url'];
      if (!isLoopbackHost(new URL(baseUrl).hostname)) {
        console.error(`--target twin talks to a loopback twin only, not ${baseUrl}.`);
        return 2;
      }
    } else {
      twin = await startTwin({ port: 0, disputeDelayMs: 200 });
      baseUrl = twin.url;
    }
  } else {
    if (fromEnv === undefined || fromEnv === '') {
      console.error(`--target live needs a test key in $${keyEnv}.`);
      return 2;
    }
    key = fromEnv;
    baseUrl = values['base-url'] ?? LIVE_URL;
    try {
      await guardTestMode(baseUrl, key);
    } catch (error) {
      console.error((error as Error).message);
      return 2;
    }
  }

  try {
    console.error(`Running the conformance script against ${target} (${baseUrl}).`);
    const run = await runConformance({
      baseUrl,
      key,
      pollIntervalMs: target === 'twin' ? 50 : 1000,
      log: (line) => console.error(line),
    });
    if (values.out !== undefined) writeFileSync(values.out, `${JSON.stringify(run, null, 2)}\n`);
    for (const failure of run.failures) console.error(`not as the pack relies on — ${failure}`);

    if (values['write-golden']) {
      if (run.failures.length > 0) {
        console.error(
          'Recorded anyway: the golden file says what Stripe does. The failures above are ' +
            'assumptions in the pack (and the twin) that Stripe does not share; fix those.',
        );
      }
      const golden: GoldenFile = {
        about: GOLDEN_ABOUT,
        recordedAt: new Date().toISOString(),
        stripeVersion: run.stripeVersion,
        steps: run.steps,
      };
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 2)}\n`);
      console.error(`Wrote ${GOLDEN} (${run.steps.length} steps).`);
      return run.failures.length > 0 ? 1 : 0;
    }

    let differences: string[] = [];
    if (existsSync(GOLDEN)) {
      const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as GoldenFile;
      differences = compareToGolden(golden, run);
      for (const line of differences) console.error(`differs from Stripe — ${line}`);
      console.error(
        differences.length === 0
          ? `Matches the golden file (recorded ${golden.recordedAt}).`
          : `${differences.length} difference(s) from the golden file. The golden file is right.`,
      );
    } else {
      console.error(
        `No golden file at ${GOLDEN} yet: nothing to compare with. Record one with ` +
          '--target live --write-golden and a test key.',
      );
    }
    console.error(`${run.steps.length} steps, ${run.failures.length} not as relied on.`);
    return run.failures.length > 0 || differences.length > 0 ? 1 : 0;
  } finally {
    await twin?.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
