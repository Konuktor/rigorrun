/**
 * The conformance script, replayed against an in-process twin.
 *
 * Every step must behave as the pack relies on, and two runs must record the
 * same transcript — otherwise normalization is leaking ids or timestamps and a
 * comparison with Stripe would be noise. When `test/golden/stripe-live.json`
 * exists (it is recorded against Stripe test mode with `scripts/conformance.ts
 * --target live --write-golden`), the twin must match it exactly; where it does
 * not, the twin is wrong.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTwin, type RunningTwin } from '../src/index.ts';
import {
  LiveModeRefused,
  compareToGolden,
  guardTestMode,
  runConformance,
  type ConformanceRun,
  type GoldenFile,
} from '../src/twin/conformance.ts';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'stripe-live.json');
const golden = existsSync(GOLDEN)
  ? (JSON.parse(readFileSync(GOLDEN, 'utf8')) as GoldenFile)
  : undefined;

let twin: RunningTwin;
let first: ConformanceRun;
let second: ConformanceRun;

beforeAll(async () => {
  twin = await startTwin({ port: 0, disputeDelayMs: 30 });
  const options = { baseUrl: twin.url, key: 'sk_test_conformance', pollIntervalMs: 10 };
  first = await runConformance(options);
  second = await runConformance(options);
}, 30_000);
afterAll(async () => {
  await twin.close();
});

describe('the conformance script against the twin', () => {
  it('finds every step behaving as the pack relies on', () => {
    expect(first.failures).toEqual([]);
    expect(first.steps.length).toBeGreaterThanOrEqual(25);
  });

  it('covers the behaviours the twin promises', () => {
    const names = first.steps.map((step) => step.step);
    for (const name of [
      'refund.partial',
      'refund.more_than_remains',
      'refund.nothing_left',
      'refund.disputed_charge',
      'refunds.page_1',
      'refunds.created_since',
      'idempotency.replay',
      'idempotency.different_parameters',
      'balance',
      'charge.unknown',
      'auth.live_key',
    ]) {
      expect(names).toContain(name);
    }
    const errors = first.steps
      .map((step) => (step.body as { error?: { code: unknown } }).error?.code)
      .filter((code) => typeof code === 'string');
    expect(new Set(errors)).toEqual(
      new Set([
        'parameter_unknown',
        'amount_too_large',
        'parameter_invalid_integer',
        'parameter_missing',
        'resource_missing',
        'charge_already_refunded',
        'charge_disputed',
      ]),
    );
  });

  it('records the same transcript every run: ids, timestamps and the tag normalized', () => {
    expect(second.steps).toEqual(first.steps);
    const text = JSON.stringify(first.steps);
    expect(text).not.toMatch(/"(cus|pi|ch|re|dp)_[A-Za-z0-9]{8,}"/);
    expect(text).not.toMatch(/\b1[0-9]{9}\b/);
    expect(text).toContain('<ch:1>');
    expect(text).toContain('rr-conf-<run>@example.com');
  });

  it.skipIf(golden === undefined)(
    'matches test/golden/stripe-live.json, the record of Stripe test mode',
    () => {
      expect(compareToGolden(golden!, first)).toEqual([]);
    },
  );

  it.skipIf(golden !== undefined)(
    'has no golden file yet — record one with `scripts/conformance.ts --target live --write-golden`',
    () => {
      expect(golden).toBeUndefined();
    },
  );
});

describe('comparing with the golden file', () => {
  it('names the step and field where a run differs, and steps on one side only', () => {
    const recorded: GoldenFile = {
      about: 'test',
      recordedAt: '2026-10-01T00:00:00Z',
      stripeVersion: null,
      steps: structuredClone(first.steps),
    };
    expect(compareToGolden(recorded, first)).toEqual([]);
    const tooLarge = recorded.steps.find((step) => step.step === 'refund.more_than_remains')!;
    tooLarge.status = 402;
    (tooLarge.body as { error: { code: string } }).error.code = 'balance_insufficient';
    recorded.steps.push({
      step: 'only.in.golden',
      request: { method: 'GET', path: '/v1/x' },
      status: 200,
      body: {},
    });
    expect(compareToGolden(recorded, first)).toEqual([
      'refund.more_than_remains.status: Stripe 402, this run 400',
      'refund.more_than_remains.body.error.code: Stripe "balance_insufficient", this run "amount_too_large"',
      'only.in.golden: in the golden file, not in this run',
    ]);
  });
});

describe('the guard against anything but test mode', () => {
  let fake: Server;
  let fakeUrl: string;

  beforeAll(async () => {
    // A stand-in that answers like a live account, which the twin never does.
    fake = createServer((_req, res) => {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ object: 'balance', livemode: true, available: [], pending: [] }));
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  });

  it('refuses a key without a test prefix before sending anything', async () => {
    let requests = 0;
    fake.once('request', () => (requests += 1));
    await expect(guardTestMode(fakeUrl, 'sk_live_abc')).rejects.toThrow(/sk_test_ or rk_test_/);
    expect(requests).toBe(0);
  });

  it('refuses any host but api.stripe.com or loopback', async () => {
    await expect(guardTestMode('https://api.example.com', 'sk_test_abc')).rejects.toThrow(
      /only https:\/\/api\.stripe\.com or loopback/,
    );
  });

  it('refuses when the balance says livemode is not false', async () => {
    await expect(guardTestMode(fakeUrl, 'sk_test_abc')).rejects.toThrow(/livemode: false/);
  });

  it('passes the twin', async () => {
    await expect(guardTestMode(twin.url, 'sk_test_abc')).resolves.toBeUndefined();
  });

  it('stops the script the moment anything comes back in live mode', async () => {
    await expect(runConformance({ baseUrl: fakeUrl, key: 'sk_test_abc' })).rejects.toThrow(
      LiveModeRefused,
    );
  });
});
