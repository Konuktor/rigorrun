/**
 * The twin as an HTTP service: keys, headers, routing, the idempotency layer,
 * injected faults, the test hooks being off unless asked for, loopback only,
 * and the command that runs it.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  encodeForm,
  isLoopbackHost,
  startTwin,
  type FormInput,
  type RunningTwin,
} from '../src/index.ts';

const KEY = 'sk_test_twin_http';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let now = Date.UTC(2026, 9, 1, 12, 0, 0);
let twin: RunningTwin;
let plain: RunningTwin;

beforeAll(async () => {
  twin = await startTwin({ port: 0, clock: () => now, testHooks: true });
  plain = await startTwin({ port: 0 });
});
afterAll(async () => {
  await twin.close();
  await plain.close();
});
afterEach(async () => {
  await fetch(`${twin.url}/_twin/reset`, { method: 'POST' });
});

interface Answer {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

async function call(
  method: string,
  path: string,
  options: {
    params?: Record<string, FormInput>;
    key?: string | null;
    headers?: Record<string, string>;
    body?: string;
    on?: RunningTwin;
  } = {},
): Promise<Answer> {
  const headers: Record<string, string> = { ...options.headers };
  const key = options.key === undefined ? KEY : options.key;
  if (key !== null) headers['Authorization'] ??= `Bearer ${key}`;
  let url = `${(options.on ?? twin).url}${path}`;
  let body = options.body;
  if (options.params && method === 'GET') url += `?${encodeForm(options.params)}`;
  if (options.params && method !== 'GET') body = encodeForm(options.params);
  if (body !== undefined) headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
  const response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body }) });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function errorOf(answer: Answer): Record<string, unknown> {
  return (answer.body['error'] ?? {}) as Record<string, unknown>;
}

async function payment(amount = 6000): Promise<string> {
  const paid = await call('POST', '/v1/payment_intents', {
    params: {
      amount,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
    },
  });
  return String(paid.body['latest_charge']);
}

describe('keys', () => {
  it('answers 401 without a key, in Stripe’s shape', async () => {
    const answer = await call('GET', '/v1/balance', { key: null });
    expect(answer.status).toBe(401);
    expect(errorOf(answer)['type']).toBe('invalid_request_error');
    expect(String(errorOf(answer)['message'])).toMatch(/^You did not provide an API key/);
    expect(answer.headers.get('www-authenticate')).toBe('Basic realm="Stripe"');
    expect(
      (await call('GET', '/v1/balance', { headers: { Authorization: 'Token abc' }, key: null }))
        .status,
    ).toBe(401);
  });

  it('refuses a live key with 401 and never echoes it', async () => {
    for (const key of ['sk_live_supersecretvalue9876', 'rk_live_supersecretvalue9876']) {
      const answer = await call('GET', '/v1/balance', { key });
      expect(answer.status).toBe(401);
      expect(errorOf(answer)['type']).toBe('invalid_request_error');
      const message = String(errorOf(answer)['message']);
      expect(message).toMatch(/^Invalid API Key provided: (sk|rk)_live_\*+9876/);
      expect(message).not.toContain('supersecret');
    }
  });

  it('refuses anything that is not a test secret or restricted key', async () => {
    for (const key of ['pk_test_abc', 'sk_test_', 'whsec_abc', 'abc']) {
      expect((await call('GET', '/v1/balance', { key })).status, key).toBe(401);
    }
  });

  it('accepts any sk_test_ key, by Bearer or as the Basic user name', async () => {
    expect((await call('GET', '/v1/balance', { key: 'sk_test_anything' })).status).toBe(200);
    const basic = `Basic ${Buffer.from(`${KEY}:`).toString('base64')}`;
    expect(
      (await call('GET', '/v1/balance', { key: null, headers: { Authorization: basic } })).status,
    ).toBe(200);
  });

  it('treats an rk_test_ key as read-only: reads pass, writes are 403', async () => {
    const key = 'rk_test_readonly';
    expect((await call('GET', '/v1/balance', { key })).status).toBe(200);
    const write = await call('POST', '/v1/customers', { key, params: { email: 'a@example.com' } });
    expect(write.status).toBe(403);
    expect(errorOf(write)['type']).toBe('invalid_request_error');
    expect(String(errorOf(write)['message'])).toMatch(/does not have the required permissions/);
    expect(twin.model.all('customer')).toHaveLength(0);
  });

  it('shares one account between keys, as two keys to one Stripe account do', async () => {
    const created = await call('POST', '/v1/customers', { params: { email: 'a@example.com' } });
    const seen = await call('GET', `/v1/customers/${String(created.body['id'])}`, {
      key: 'sk_test_another',
    });
    expect(seen.status).toBe(200);
  });
});

describe('headers and routes', () => {
  it('sends a Request-Id on every answer, and echoes Stripe-Version when sent', async () => {
    const ok = await call('GET', '/v1/balance', { headers: { 'Stripe-Version': '2025-01-27' } });
    expect(ok.headers.get('request-id')).toMatch(/^req_[A-Za-z0-9]{14}$/);
    expect(ok.headers.get('stripe-version')).toBe('2025-01-27');
    const refused = await call('GET', '/v1/balance', { key: null });
    expect(refused.headers.get('request-id')).toMatch(/^req_/);
    expect((await call('GET', '/v1/balance')).headers.get('stripe-version')).toBeNull();
  });

  it('answers an unknown URL with 404 "Unrecognized request URL"', async () => {
    for (const [method, path] of [
      ['GET', '/v1/invoices'],
      ['POST', '/v1/customers/cus_123'],
      ['DELETE', '/v1/customers'],
      ['GET', '/'],
    ] as const) {
      const answer = await call(method, path);
      expect(answer.status, `${method} ${path}`).toBe(404);
      expect(errorOf(answer)['type']).toBe('invalid_request_error');
      expect(String(errorOf(answer)['message'])).toMatch(
        new RegExp(`^Unrecognized request URL \\(${method}: ${path.replace(/\//g, '\\/')}\\)`),
      );
    }
  });

  it('says it has no Search API instead of pretending "search" is an id', async () => {
    const answer = await call('GET', '/v1/charges/search', {
      params: { query: "metadata['order_ref']:'A1'" },
    });
    expect(answer.status).toBe(404);
    expect(String(errorOf(answer)['message'])).toMatch(/does not implement the Search API/);
  });

  it('takes form bodies only, as Stripe does', async () => {
    const json = await call('POST', '/v1/customers', {
      body: JSON.stringify({ email: 'a@example.com' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(json.status).toBe(400);
    expect(String(errorOf(json)['message'])).toMatch(/unsupported Content-Type application\/json/);
    const malformed = await call('POST', '/v1/customers', { body: 'metadata[a]=1&metadata=2' });
    expect(malformed.status).toBe(400);
    expect(errorOf(malformed)['param']).toBe('metadata');
  });

  it('reads parameters from the query string of a POST too, the body winning', async () => {
    const created = await call('POST', '/v1/customers?name=FromQuery&email=q%40example.com', {
      body: 'email=b%40example.com',
    });
    expect(created.body).toMatchObject({ name: 'FromQuery', email: 'b@example.com' });
  });
});

describe('idempotency', () => {
  const idem = (key: string) => ({ 'Idempotency-Key': key });

  it('replays the saved answer to a retry with the same key and parameters', async () => {
    const params = { email: 'a@example.com', metadata: { b: '2', a: '1' } };
    const first = await call('POST', '/v1/customers', { params, headers: idem('k1') });
    const again = await call('POST', '/v1/customers', { params, headers: idem('k1') });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(again.headers.get('original-request')).toBe(first.headers.get('request-id'));
    expect(again.headers.get('idempotency-key')).toBe('k1');
    expect(twin.model.all('customer')).toHaveLength(1);
  });

  it('refuses the same key with different parameters: idempotency_error', async () => {
    await call('POST', '/v1/customers', { params: { email: 'a@example.com' }, headers: idem('k') });
    const reused = await call('POST', '/v1/customers', {
      params: { email: 'b@example.com' },
      headers: idem('k'),
    });
    expect(reused.status).toBe(400);
    expect(errorOf(reused)['type']).toBe('idempotency_error');
    expect(errorOf(reused)).not.toHaveProperty('code');
    expect(String(errorOf(reused)['message'])).toMatch(/^Keys for idempotent requests/);
    const elsewhere = await call('POST', '/v1/refunds', {
      params: { email: 'a@example.com' },
      headers: idem('k'),
    });
    expect(errorOf(elsewhere)['type']).toBe('idempotency_error');
    expect(twin.model.all('customer')).toHaveLength(1);
  });

  it('replays a refusal the endpoint made, so a retried refund cannot succeed the second time', async () => {
    const charge = await payment(1000);
    await call('POST', '/v1/refunds', { params: { charge } });
    const params = { charge, amount: 100 };
    const first = await call('POST', '/v1/refunds', { params, headers: idem('r') });
    expect(errorOf(first)['code']).toBe('charge_already_refunded');
    const again = await call('POST', '/v1/refunds', { params, headers: idem('r') });
    expect(again.status).toBe(400);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
  });

  it('saves nothing when the parameters were refused before the endpoint ran', async () => {
    const charge = await payment(1000);
    const invalid = await call('POST', '/v1/refunds', {
      params: { charge, amount: '1.5' },
      headers: idem('v'),
    });
    expect(errorOf(invalid)['code']).toBe('parameter_invalid_integer');
    const valid = await call('POST', '/v1/refunds', {
      params: { charge, amount: 100 },
      headers: idem('v'),
    });
    expect(valid.status).toBe(200);
    expect(valid.headers.get('idempotent-replayed')).toBeNull();
  });

  it('scopes keys to the API key', async () => {
    const params = { email: 'a@example.com' };
    const mine = await call('POST', '/v1/customers', { params, headers: idem('shared') });
    const theirs = await call('POST', '/v1/customers', {
      params,
      headers: idem('shared'),
      key: 'sk_test_someone_else',
    });
    expect(theirs.body['id']).not.toBe(mine.body['id']);
  });

  it('forgets a key after 24 hours', async () => {
    const params = { email: 'a@example.com' };
    const first = await call('POST', '/v1/customers', { params, headers: idem('day') });
    now += 24 * 60 * 60 * 1000;
    const later = await call('POST', '/v1/customers', { params, headers: idem('day') });
    expect(later.body['id']).not.toBe(first.body['id']);
    expect(later.headers.get('idempotent-replayed')).toBeNull();
  });

  it('ignores the header on a GET, and refuses a key longer than 255 characters', async () => {
    const read = await call('GET', '/v1/balance', { headers: idem('g') });
    expect(read.headers.get('idempotency-key')).toBeNull();
    expect(
      (
        await call('POST', '/v1/customers', {
          params: { email: 'a@example.com' },
          headers: idem('x'.repeat(256)),
        })
      ).status,
    ).toBe(400);
  });
});

describe('faults and test hooks', () => {
  it('answers 429 with Stripe-Should-Retry: true, before anything runs', async () => {
    twin.injectFault({ status: 429, path: '/v1/customers', method: 'POST' });
    const limited = await call('POST', '/v1/customers', { params: { email: 'a@example.com' } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('stripe-should-retry')).toBe('true');
    expect(errorOf(limited)).toMatchObject({ type: 'invalid_request_error', code: 'rate_limit' });
    expect(twin.model.all('customer')).toHaveLength(0);
    expect(
      (await call('POST', '/v1/customers', { params: { email: 'a@example.com' } })).status,
    ).toBe(200);
  });

  it('answers 500 api_error as many times as asked, only on matching requests', async () => {
    twin.injectFault({ status: 500, count: 2, path: '/v1/refunds' });
    expect((await call('GET', '/v1/balance')).status).toBe(200);
    const first = await call('GET', '/v1/refunds');
    expect(first.status).toBe(500);
    expect(errorOf(first)['type']).toBe('api_error');
    expect(first.headers.get('stripe-should-retry')).toBeNull();
    expect((await call('GET', '/v1/refunds')).status).toBe(500);
    expect((await call('GET', '/v1/refunds')).status).toBe(200);
  });

  it('takes faults over HTTP too, and drops them on DELETE or reset', async () => {
    const queued = await fetch(`${twin.url}/_twin/faults`, {
      method: 'POST',
      body: JSON.stringify({ status: 503, shouldRetry: false }),
    });
    expect(await queued.json()).toEqual({ queued: 1 });
    const unavailable = await call('GET', '/v1/balance');
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('stripe-should-retry')).toBe('false');

    await fetch(`${twin.url}/_twin/faults`, {
      method: 'POST',
      body: JSON.stringify({ status: 429 }),
    });
    await fetch(`${twin.url}/_twin/faults`, { method: 'DELETE' });
    expect((await call('GET', '/v1/balance')).status).toBe(200);

    const refused = await fetch(`${twin.url}/_twin/faults`, {
      method: 'POST',
      body: JSON.stringify({ status: 200 }),
    });
    expect(refused.status).toBe(400);
  });

  it('forgets objects, saved responses and faults on reset', async () => {
    await call('POST', '/v1/customers', {
      params: { email: 'a@example.com' },
      headers: { 'Idempotency-Key': 'z' },
    });
    twin.injectFault({ status: 429 });
    const reset = await fetch(`${twin.url}/_twin/reset`, { method: 'POST' });
    expect(await reset.json()).toEqual({ reset: true });
    expect(twin.model.all('customer')).toHaveLength(0);
    expect((await call('GET', '/v1/balance')).status).toBe(200);
  });

  it('has no hooks unless started with testHooks: true', async () => {
    const hook = await fetch(`${plain.url}/_twin/reset`, { method: 'POST' });
    expect(hook.status).toBe(401);
    const authed = await call('POST', '/_twin/reset', { on: plain });
    expect(authed.status).toBe(404);
    expect(String(errorOf(authed)['message'])).toMatch(/^Unrecognized request URL/);
    expect(() => plain.injectFault({ status: 429 })).toThrow(/testHooks/);
  });
});

describe('where it listens', () => {
  it('refuses any host that is not loopback', async () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.10', 'example.com']) {
      await expect(startTwin({ port: 0, host }), host).rejects.toThrow(/loopback only/);
    }
  });

  it('knows a loopback address when it sees one', () => {
    for (const host of [
      '127.0.0.1',
      '127.1.2.3',
      'localhost',
      '::1',
      '[::1]',
      '::ffff:127.0.0.1',
    ]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ['0.0.0.0', '::', '10.0.0.1', '128.0.0.1', 'localhost.example.com']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it('listens on localhost, reports a URL without a trailing slash, and closes twice safely', async () => {
    const local = await startTwin({ port: 0, host: 'localhost' });
    expect(local.url).toMatch(/^http:\/\/(127\.0\.0\.1|\[::1\]):\d+$/);
    await local.close();
    await local.close();
  });

  it('fails to start, rather than sharing, when the port is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as { port: number }).port;
    await expect(startTwin({ port })).rejects.toThrow(/EADDRINUSE/);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });
});

describe('the command', () => {
  it('prints its URL first, serves, and stops on SIGTERM', async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'packages/env-stripe/src/twin/main.ts', '--port', '0'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8');
          const line = out.split('\n')[0];
          if (out.includes('\n') && line) resolve(line.trim());
        });
        child.once('exit', (code) => reject(new Error(`exited ${code} before printing a URL`)));
      });
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const balance = await fetch(`${url}/v1/balance`, {
        headers: { Authorization: `Bearer ${KEY}` },
      });
      expect(balance.status).toBe(200);
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      expect(await exited).toBe(0);
    } finally {
      child.kill('SIGKILL');
    }
  }, 20_000);

  it('refuses a non-loopback host', async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'packages/env-stripe/src/twin/main.ts', '--host', '0.0.0.0'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    expect(code).toBe(2);
    expect(err).toMatch(/loopback only/);
  }, 20_000);
});
