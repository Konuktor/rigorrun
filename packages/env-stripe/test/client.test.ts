/**
 * The Stripe client: where it may point, what it sends, when it retries, and
 * that one live-mode object stops it for good.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  LiveModeRefused,
  PAGE_LIMIT,
  STRIPE_API_VERSION,
  StripeApiError,
  StripeConnectionError,
  StripeHostRefused,
  assertStripeBaseUrl,
  createStripeClient,
  redactKeys,
} from '../src/index.ts';
import { FakeStripe } from './fakeStripe.ts';

const KEY = 'sk_test_51SecretValueNeverShown';

function clientFor(fake: FakeStripe, extra: { maxRetries?: number } = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const client = createStripeClient({
    baseUrl: 'http://127.0.0.1:12112',
    key: KEY,
    fetch: fake.fetch,
    sleep,
    random: () => 0.5,
    ...extra,
  });
  return { client, sleep };
}

describe('where the client may point', () => {
  it('accepts Stripe’s API and loopback addresses', () => {
    for (const url of [
      'https://api.stripe.com',
      'https://api.stripe.com/',
      'http://127.0.0.1:12112',
      'http://localhost:4000',
      'https://localhost',
      'http://[::1]:12112',
    ]) {
      expect(() => assertStripeBaseUrl(url), url).not.toThrow();
    }
  });

  it('refuses everything else before a request is made', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const url of [
      'http://api.stripe.com',
      'https://api.stripe.com:8443',
      'https://api.stripe.com.example.com',
      'https://files.stripe.com',
      'https://example.com',
      'http://10.0.0.5:12112',
      'http://127.0.0.2:12112',
      'https://user:pass@api.stripe.com',
      'https://api.stripe.com/v1',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(() => createStripeClient({ baseUrl: url, key: KEY, fetch }), url).toThrow(
        StripeHostRefused,
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('what goes over the wire', () => {
  it('authenticates, pins the version, and writes bracket notation both ways', async () => {
    const fake = new FakeStripe();
    const { client } = clientFor(fake);
    const customer = await client.post<{ id: string }>(
      '/v1/customers',
      { email: 'a@example.com', metadata: { rigorrun_case: 'c1' } },
      { idempotencyKey: 'run.agent.case.0.customer' },
    );
    await client.get('/v1/refunds', { created: { gte: 1790000000 }, expand: ['data.charge'] });

    const [post, get] = fake.calls;
    expect(post?.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(post?.headers['stripe-version']).toBe(STRIPE_API_VERSION);
    expect(post?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(post?.headers['idempotency-key']).toBe('run.agent.case.0.customer');
    expect(post?.body).toEqual({ email: 'a@example.com', metadata: { rigorrun_case: 'c1' } });
    expect(customer.id).toMatch(/^cus_/);

    expect(get?.method).toBe('GET');
    expect(get?.query).toEqual({ created: { gte: '1790000000' }, expand: ['data.charge'] });
    expect(get?.headers['idempotency-key']).toBeUndefined();
  });

  it('gives every write a key, so its own retries are replayed rather than repeated', async () => {
    const fake = new FakeStripe();
    const { client } = clientFor(fake);
    fake.enqueue({ status: 429, body: { error: { type: 'rate_limit_error', message: 'slow' } } });
    await client.post('/v1/customers', { email: 'b@example.com' });
    const [first, second] = fake.calls;
    expect(first?.headers['idempotency-key']).toMatch(/^rigorrun-[0-9a-f-]{36}$/);
    expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key']);
    expect(fake.customers.size).toBe(1);
  });

  it('refuses an Idempotency-Key longer than Stripe allows, without sending it', async () => {
    const fake = new FakeStripe();
    const { client } = clientFor(fake);
    await expect(
      client.post('/v1/customers', {}, { idempotencyKey: 'x'.repeat(256) }),
    ).rejects.toThrow(/255/);
    expect(fake.calls).toHaveLength(0);
  });

  it('refuses a path an id could climb out of', async () => {
    const fake = new FakeStripe();
    const { client } = clientFor(fake);
    for (const path of ['/v1/charges/..', '/v1/charges/a?b=c', '/v2/x', '/v1/charges/a/../b']) {
      await expect(client.get(path), path).rejects.toThrow(/not a Stripe API path/);
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe('retries', () => {
  it('backs off on 429 with the injected sleep, then succeeds', async () => {
    const fake = new FakeStripe();
    const { client, sleep } = clientFor(fake);
    fake.enqueue(
      { status: 429, body: { error: { type: 'rate_limit_error', message: 'slow' } } },
      2,
    );
    const balance = await client.get<{ livemode: boolean }>('/v1/balance');
    expect(balance.livemode).toBe(false);
    expect(fake.calls).toHaveLength(3);
    // Jittered exponential: half fixed, half random (pinned at 0.5 here).
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([375, 750]);
  });

  it('retries whatever Stripe says to, and nothing Stripe says not to', async () => {
    const fake = new FakeStripe();
    const { client } = clientFor(fake);
    fake.enqueue({
      status: 500,
      headers: { 'Stripe-Should-Retry': 'true' },
      body: { error: { type: 'api_error', message: 'blip' } },
    });
    await expect(client.get('/v1/balance')).resolves.toBeDefined();
    expect(fake.calls).toHaveLength(2);

    fake.enqueue({
      status: 429,
      headers: { 'Stripe-Should-Retry': 'false' },
      body: { error: { type: 'rate_limit_error', message: 'no' } },
    });
    await expect(client.get('/v1/balance')).rejects.toMatchObject({ status: 429 });
    expect(fake.calls).toHaveLength(3);
  });

  it('gives up after its bound and reports the last refusal', async () => {
    const fake = new FakeStripe();
    const { client, sleep } = clientFor(fake, { maxRetries: 2 });
    fake.enqueue(
      { status: 429, body: { error: { type: 'rate_limit_error', message: 'slow' } } },
      5,
    );
    await expect(client.get('/v1/balance')).rejects.toBeInstanceOf(StripeApiError);
    expect(fake.calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('retries a request that never arrived, then says Stripe could not be reached', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError('fetch failed', { cause: new Error(`ECONNREFUSED ${KEY}`) });
    });
    const client = createStripeClient({
      baseUrl: 'http://127.0.0.1:1',
      key: KEY,
      fetch,
      sleep: async () => {},
      maxRetries: 1,
    });
    const failure = await client.get('/v1/balance').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StripeConnectionError);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String((failure as Error).message)).not.toContain(KEY);
  });
});

describe('errors', () => {
  it('carries Stripe’s type, code, param and status', async () => {
    const fake = new FakeStripe();
    const { client } = clientFor(fake);
    const error = await client
      .post('/v1/refunds', { charge: 'ch_missing' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StripeApiError);
    expect(error).toMatchObject({
      status: 400,
      type: 'invalid_request_error',
      code: 'resource_missing',
      param: 'charge',
      request: 'POST /v1/refunds',
    });
  });

  it('never quotes the key, even when Stripe’s message does', async () => {
    const fake = new FakeStripe();
    const { client } = clientFor(fake);
    fake.enqueue({
      status: 401,
      body: {
        error: { type: 'invalid_request_error', message: `Invalid API Key provided: ${KEY}` },
      },
    });
    const error = (await client.get('/v1/balance').catch((caught: unknown) => caught)) as Error;
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain('[key]');
    expect(redactKeys('rk_live_abc and sk_test_****1234', undefined)).toBe('[key] and [key]');
  });

  it('reports an answer that is not JSON as such', async () => {
    const client = createStripeClient({
      baseUrl: 'http://127.0.0.1:1',
      key: KEY,
      fetch: async () => new Response('<html>proxy</html>', { status: 502 }),
      sleep: async () => {},
    });
    await expect(client.get('/v1/balance')).rejects.toMatchObject({
      type: 'invalid_response',
      status: 502,
    });
  });
});

describe('live mode', () => {
  it('stops at a live object anywhere in an answer, list data included, and stays stopped', async () => {
    const fake = new FakeStripe({
      tamper: (call, body) =>
        call.path === '/v1/charges' && Array.isArray(body['data'])
          ? {
              ...body,
              data: body['data'].map((row: Record<string, unknown>) => ({
                ...row,
                source: { object: 'card', nested: [{ livemode: true }] },
              })),
            }
          : body,
    });
    const { client } = clientFor(fake);
    fake.outsider(500);
    await expect(client.listAll('/v1/charges')).rejects.toBeInstanceOf(LiveModeRefused);
    expect(client.stoppedByLiveMode).toBe(true);

    const before = fake.calls.length;
    await expect(client.get('/v1/balance')).rejects.toBeInstanceOf(LiveModeRefused);
    await expect(client.post('/v1/customers', {})).rejects.toBeInstanceOf(LiveModeRefused);
    expect(fake.calls).toHaveLength(before);
  });

  it('stops at a live object in an error answer too', async () => {
    const fake = new FakeStripe();
    const { client } = clientFor(fake);
    fake.enqueue({ status: 400, body: { error: { type: 'x', message: 'y' }, livemode: true } });
    await expect(client.get('/v1/balance')).rejects.toBeInstanceOf(LiveModeRefused);
  });
});

describe('lists', () => {
  it('reads every page, continuing after the last id', async () => {
    const fake = new FakeStripe({ pageSize: 2 });
    const { client } = clientFor(fake);
    const ids = Array.from({ length: 5 }, () => fake.outsider(100).charge);
    const { data, truncated } = await client.listAll<{ id: string }>('/v1/charges');
    expect(truncated).toBe(false);
    expect(data.map((charge) => charge.id)).toEqual([...ids].reverse());
    const pages = fake.calls.filter((call) => call.path === '/v1/charges');
    expect(pages).toHaveLength(3);
    expect(pages[0]?.query['limit']).toBe(String(PAGE_LIMIT));
    expect(pages[1]?.query['starting_after']).toBe(ids[3]);
  });

  it('stops at the page cap and says the list was cut short', async () => {
    const fake = new FakeStripe({ pageSize: 1 });
    const { client } = clientFor(fake);
    for (let index = 0; index < 4; index += 1) fake.outsider(100);
    const { data, truncated } = await client.listAll('/v1/charges', {}, { maxPages: 3 });
    expect(truncated).toBe(true);
    expect(data).toHaveLength(3);
  });
});
