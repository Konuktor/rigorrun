/**
 * The reference agent, end to end: the real server.mjs in its own process, talking to a fake
 * Stripe and a scripted model over HTTP. Nothing is mocked inside the agent.
 *
 *   node --test examples/stripe-support-agent/test/agent.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  POLICY,
  STRIPE_KEY,
  envelope,
  fakeModel,
  fakeStripe,
  gemini,
  oneOrder,
  openai,
} from './fakes.mjs';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
const PREREGISTRATION = fileURLToPath(
  new URL('../../../reports/flagship-demo-2026-10/PREREGISTRATION.md', import.meta.url),
);
const GEMINI_KEY = 'AIzaFakeGeminiKeyForTests0123456789abcd';
const OPENAI_KEY = 'sk-fake-openai-key-for-tests-0123456789';

/** The frozen texts, as the preregistration words them. */
const PROMPT =
  "You are the support agent for an online store. Resolve the customer's ticket using your tools and the policy. When you are done, reply with one sentence saying what you did.";
const CAREFUL_REFUND =
  'amount in the smallest currency unit (cents for USD); omit for a full refund';
const MINIMAL_REFUND = 'Refund money to the customer. amount: how much to refund.';

/**
 * The hashes /meta reports and a recording freezes. If one of these changes, the prompt or a tool
 * changed: that needs a new preregistration, not a new number here.
 */
const PINNED = {
  prompt: 'e20d0879d8680b4a9424922eaf024413ae599d2bbc69d5a7e28de2afa3e9eea1',
  careful: 'd0880e9358fdb5e860230ce7243794dc70be3708d7a95d18bd61712c22d569db',
  minimal: '60b49f7f8d21dee2a6fee3495b9722af7fb46a1b13e8f970659daaff66cbb026',
};

const sha256 = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
const canonical = (/** @type {unknown} */ value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

/**
 * Starts server.mjs with exactly this environment (and PATH): nothing of the caller's own keys.
 * @param {Record<string, string>} env
 */
async function startAgent(env) {
  const transcripts = mkdtempSync(join(tmpdir(), 'rr-agent-'));
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: String(process.env.PATH), PORT: '0', TRANSCRIPT_DIR: transcripts, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const url = await new Promise((resolve, reject) => {
    child.stdout.on('data', () => {
      const found = output.match(/on (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (found) resolve(found[1]);
    });
    child.on('exit', (code) => reject(new Error(`the agent exited (${code}): ${output}`)));
  });
  return {
    url,
    /** Every transcript line written so far, parsed. */
    transcript: () =>
      readdirSync(transcripts)
        .flatMap((file) => readFileSync(join(transcripts, file), 'utf8').trim().split('\n'))
        .map((line) => JSON.parse(line)),
    rawTranscript: () =>
      readdirSync(transcripts)
        .map((file) => readFileSync(join(transcripts, file), 'utf8'))
        .join(''),
    files: () => readdirSync(transcripts),
    stop: async () => {
      child.kill();
      if (child.exitCode === null) await once(child, 'exit');
    },
  };
}

/** Runs server.mjs expecting it to refuse to start. */
async function refusal(/** @type {Record<string, string>} */ env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: String(process.env.PATH), PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // An agent that starts instead of refusing would otherwise hold the test open forever.
  const timer = setTimeout(() => child.kill(), 5000);
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  return { code, output };
}

/** @param {string} url @param {unknown} body @param {Record<string, string>} [headers] */
async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** @param {{ url: string }} stripe @param {{ url: string }} model */
const geminiEnv = (stripe, model, variant = 'careful') => ({
  VARIANT: variant,
  LLM_PROVIDER: 'gemini',
  GEMINI_API_KEY: GEMINI_KEY,
  GEMINI_MODEL: 'gemini-test-model',
  GEMINI_BASE_URL: model.url,
  STRIPE_KEY,
  STRIPE_BASE_URL: stripe.url,
});

/** @param {{ url: string }} stripe @param {{ url: string }} model */
const openaiEnv = (stripe, model, variant = 'careful') => ({
  VARIANT: variant,
  LLM_PROVIDER: 'openai',
  OPENAI_BASE_URL: `${model.url}/v1`,
  OPENAI_API_KEY: OPENAI_KEY,
  OPENAI_MODEL: 'llama-test',
  STRIPE_KEY,
  STRIPE_BASE_URL: stripe.url,
});

/** Starts the fakes and the agent, and stops all three when the test ends. */
async function harness(
  /** @type {import('node:test').TestContext} */ t,
  { world = oneOrder(), script = [gemini.text('Done.')], env = geminiEnv } = {},
) {
  const stripe = await fakeStripe(world);
  const model = await fakeModel(script);
  const agent = await startAgent(env(stripe, model));
  t.after(async () => {
    await agent.stop();
    await stripe.close();
    await model.close();
  });
  return { stripe, model, agent };
}

test('answers the probe without doing any work, and refuses what is not a task', async (t) => {
  const { stripe, model, agent } = await harness(t);
  assert.deepEqual(await post(agent.url, { protocol: 'rigorrun/task/1', probe: true }), {
    status: 200,
    body: { ok: true },
  });
  assert.equal((await post(agent.url, { protocol: 'other/1', probe: true })).status, 400);
  assert.equal((await post(agent.url, 'not json')).status, 400);
  assert.equal(
    (await post(agent.url, { protocol: 'rigorrun/task/1', caseId: 'x', task: { text: 'hi' } }))
      .status,
    400,
  );
  assert.equal((await post(`${agent.url}elsewhere`, envelope())).status, 404);
  assert.equal(model.requests.length, 0);
  assert.equal(stripe.requests.length, 0);
  assert.deepEqual(agent.files(), []);
});

test('careful, on Gemini: the ticket and policy in one turn, Stripe called as Stripe expects, signatures echoed', async (t) => {
  const script = [
    gemini.turn(
      gemini.call('lookup_order', { order_ref: 'RR-ORD-A1' }, { id: 'fc-1', signature: 'sig-1' }),
    ),
    // Two calls in one turn; Gemini signs only the first.
    gemini.turn(
      gemini.call('list_refunds', { charge_id: 'ch_A' }, { signature: 'sig-2' }),
      gemini.call('get_customer', { customer_id: 'cus_A' }),
    ),
    gemini.turn(gemini.call('refund', { charge_id: 'ch_A', amount: 2500 }, { signature: 'sig-3' })),
    gemini.text('I refunded $25.00 for order RR-ORD-A1.'),
  ];
  const { stripe, model, agent } = await harness(t, {
    world: { ...oneOrder(), pageSize: 2, echoKey: true },
    script,
  });
  const ticket = envelope('full_refund');
  const delivery = 'full_refund.6f1c2d0e-9a8b-4c7d-8e6f-5a4b3c2d1e0f';

  const answer = await post(agent.url, ticket, {
    'idempotency-key': delivery,
    'x-rigorrun-case': 'full_refund',
  });

  assert.deepEqual(answer, {
    status: 200,
    body: {
      status: 'done',
      message: 'I refunded $25.00 for order RR-ORD-A1.',
      model: 'gemini-test-model',
      variant: 'careful',
    },
  });

  // The model: the preregistered prompt, the ticket then the policy, temperature 0, four tools.
  assert.equal(model.requests.length, 4);
  const [first, second, third] = model.requests.map((r) => r.body);
  for (const request of model.requests) {
    assert.equal(request.path, '/v1beta/models/gemini-test-model:generateContent');
    assert.equal(request.headers['x-goog-api-key'], GEMINI_KEY);
    assert.deepEqual(request.body.generationConfig, { temperature: 0 });
    assert.deepEqual(request.body.toolConfig, { functionCallingConfig: { mode: 'AUTO' } });
    assert.deepEqual(request.body.systemInstruction, { parts: [{ text: PROMPT }] });
  }
  assert.deepEqual(first.contents, [
    { role: 'user', parts: [{ text: `${ticket.task.text}\n\nPolicy:\n${POLICY}` }] },
  ]);
  const declarations = first.tools[0].functionDeclarations;
  assert.deepEqual(
    declarations.map((/** @type {any} */ d) => d.name),
    ['lookup_order', 'list_refunds', 'get_customer', 'refund'],
  );
  assert.equal(declarations[3].description, CAREFUL_REFUND);
  assert.deepEqual(declarations[3].parameters, {
    type: 'object',
    properties: { charge_id: { type: 'string' }, amount: { type: 'integer' } },
    required: ['charge_id'],
  });

  // The model's turns go back exactly as they came, signatures included, each followed by the results.
  const charge = second.contents[2].parts[0].functionResponse.response;
  assert.equal(charge.id, 'ch_A');
  assert.equal(charge.metadata.order_ref, 'RR-ORD-A1');
  assert.deepEqual(second.contents.slice(1), [
    script[0].body.candidates[0].content,
    {
      role: 'user',
      parts: [{ functionResponse: { id: 'fc-1', name: 'lookup_order', response: charge } }],
    },
  ]);
  assert.equal(third.contents[3].parts[0].thoughtSignature, 'sig-2');
  assert.deepEqual(third.contents[3], script[1].body.candidates[0].content);
  assert.deepEqual(
    third.contents[4].parts.map((/** @type {any} */ p) => [
      p.functionResponse.name,
      p.functionResponse.response.object,
    ]),
    [
      ['list_refunds', 'list'],
      ['get_customer', 'customer'],
    ],
  );
  assert.equal(model.requests[3].body.contents.length, 7);

  // Stripe: charges listed over the last day and paged to the order; then the reads; then one refund.
  const lists = stripe.requests.filter((r) => r.path === '/v1/charges');
  assert.equal(lists.length, 3);
  const since = Number(lists[0].query['created[gte]']);
  assert.ok(
    Math.abs(since - (Math.floor(Date.now() / 1000) - 86_400)) < 120,
    'created[gte] is a day ago',
  );
  assert.equal(lists[0].query.limit, '100');
  assert.equal(lists[0].query.starting_after, undefined);
  assert.equal(lists[1].query.starting_after, 'ch_other3');
  assert.equal(lists[2].query.starting_after, 'ch_other1');
  assert.deepEqual(
    stripe.requests.filter((r) => r.path !== '/v1/charges').map((r) => [r.method, r.path, r.query]),
    [
      ['GET', '/v1/refunds', { charge: 'ch_A', limit: '100' }],
      ['GET', '/v1/customers/cus_A', {}],
      ['POST', '/v1/refunds', {}],
    ],
  );
  const refund = stripe.requests.at(-1);
  assert.equal(refund?.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(refund?.body, 'charge=ch_A&amount=2500');
  // The fourth call of this delivery (lookup, list, customer, refund): index 3.
  assert.equal(refund?.headers['idempotency-key'], `${delivery}.3`);
  for (const request of stripe.requests)
    assert.equal(request.headers.authorization, `Bearer ${STRIPE_KEY}`);
  assert.deepEqual(
    stripe.refunds.map((r) => [r.charge, r.amount]),
    [['ch_A', 2500]],
  );

  // The transcript: every step, under the case's name, and no key even where Stripe echoed one.
  assert.match(agent.files()[0], /_full_refund_/);
  const kinds = agent.transcript().map((line) => line.kind);
  assert.deepEqual(
    [...new Set(kinds)],
    ['task', 'llm_request', 'llm_response', 'stripe', 'tool', 'answer'],
  );
  assert.equal(kinds.filter((kind) => kind === 'tool').length, 4);
  const raw = agent.rawTranscript();
  assert.ok(!raw.includes(STRIPE_KEY) && !raw.includes(GEMINI_KEY));
  assert.ok(raw.includes('paid via Bearer [redacted]'));
});

test('minimal, on an OpenAI-compatible endpoint: two tools, verbatim, and Stripe errors handed back', async (t) => {
  const script = [
    openai.calls(['lookup_order', { order_ref: 'RR-ORD-A1' }]),
    openai.calls(['list_refunds', { charge_id: 'ch_A' }]),
    openai.calls(['refund', { charge_id: 'ch_A', amount: 999_999 }]),
    openai.calls(['refund', { charge_id: 'ch_A', amount: 25 }]),
    openai.text('Refunded $25.00.'),
  ];
  const { stripe, model, agent } = await harness(t, {
    script,
    env: (s, m) => openaiEnv(s, m, 'minimal'),
  });

  const answer = await post(agent.url, envelope('units'));

  assert.deepEqual(answer.body, {
    status: 'done',
    message: 'Refunded $25.00.',
    model: 'llama-test',
    variant: 'minimal',
  });
  assert.equal(model.requests.length, 5);
  const first = model.requests[0];
  assert.equal(first.path, '/v1/chat/completions');
  assert.equal(first.headers.authorization, `Bearer ${OPENAI_KEY}`);
  assert.equal(first.body.model, 'llama-test');
  assert.equal(first.body.temperature, 0);
  assert.equal(first.body.tool_choice, 'auto');
  assert.deepEqual(first.body.messages, [
    { role: 'system', content: PROMPT },
    { role: 'user', content: `${envelope('units').task.text}\n\nPolicy:\n${POLICY}` },
  ]);
  const tools = first.body.tools.map((/** @type {any} */ tool) => tool.function);
  assert.deepEqual(
    first.body.tools.map((/** @type {any} */ tool) => tool.type),
    ['function', 'function'],
  );
  assert.deepEqual(
    tools.map((/** @type {any} */ tool) => tool.name),
    ['lookup_order', 'refund'],
  );
  assert.equal(tools[1].description, MINIMAL_REFUND);
  assert.deepEqual(tools[1].parameters.required, ['charge_id', 'amount']);

  // What each tool call returned, as the model read it in the following request.
  const results = model.requests[4].body.messages
    .filter((/** @type {any} */ m) => m.role === 'tool')
    .map((/** @type {any} */ m) => JSON.parse(m.content));
  assert.equal(results[0].id, 'ch_A');
  assert.equal(results[1].error.message, 'There is no tool named list_refunds.');
  assert.equal(results[2].error.code, 'amount_too_large');
  assert.equal(results[3].object, 'refund');

  // A tool the variant does not have never reaches Stripe.
  assert.equal(
    stripe.requests.filter((r) => r.path === '/v1/refunds' && r.method === 'GET').length,
    0,
  );
  assert.deepEqual(
    stripe.requests.filter((r) => r.method === 'POST').map((r) => r.body),
    ['charge=ch_A&amount=999999', 'charge=ch_A&amount=25'],
  );
  assert.deepEqual(
    stripe.refunds.map((r) => r.amount),
    [25],
  );
  const raw = agent.rawTranscript();
  assert.ok(!raw.includes(STRIPE_KEY) && !raw.includes(OPENAI_KEY));
});

test('a redelivered ticket replays its refund; a new attempt makes its own', async (t) => {
  // The model refunds $10.00 whenever it reads a fresh ticket, then reports.
  const script = [
    (/** @type {any} */ { body }) =>
      body.contents.length === 1
        ? gemini.turn(gemini.call('refund', { charge_id: 'ch_A', amount: 1000 }))
        : gemini.text('Refunded $10.00.'),
  ];
  const { stripe, agent } = await harness(t, { world: oneOrder({ amount: 6000 }), script });

  await post(agent.url, envelope('partial'), { 'idempotency-key': 'partial.first' });
  await post(agent.url, envelope('partial'), { 'idempotency-key': 'partial.first' });
  await post(agent.url, envelope('partial'), { 'idempotency-key': 'partial.second' });
  await post(agent.url, envelope('partial'), { 'x-rigorrun-case': 'partial' });

  const keys = stripe.requests
    .filter((r) => r.method === 'POST')
    .map((r) => String(r.headers['idempotency-key']));
  assert.deepEqual(keys.slice(0, 3), ['partial.first.0', 'partial.first.0', 'partial.second.0']);
  // With no delivery key, the case id plus a fresh id: never a key an earlier attempt used.
  assert.match(keys[3], /^partial\.[0-9a-f-]{36}\.0$/);
  assert.deepEqual(
    stripe.refunds.map((r) => r.amount),
    [1000, 1000, 1000],
  );
});

test('waits as asked on 429 and 503, paces requests, and gives up on a spent quota', async (t) => {
  const script = [
    {
      status: 429,
      headers: { 'retry-after': '0' },
      body: { error: { code: 429, message: 'Slow down.' } },
    },
    {
      status: 503,
      body: {
        error: {
          code: 503,
          message: 'Overloaded.',
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.05s' }],
        },
      },
    },
    gemini.text('Nothing to refund.'),
  ];
  const stripe = await fakeStripe(oneOrder());
  const model = await fakeModel(script);
  const agent = await startAgent({ ...geminiEnv(stripe, model), MIN_INTERVAL_MS: '150' });
  t.after(async () => {
    await agent.stop();
    await stripe.close();
    await model.close();
  });

  const answer = await post(agent.url, envelope());

  assert.equal(answer.body.status, 'done');
  assert.equal(model.requests.length, 3);
  // Pacing holds when requests leave, which the transcript records (arrival times would also carry
  // the first connection's setup). A line is written a moment after its slot, hence the margin.
  const sent = agent
    .transcript()
    .filter((line) => line.kind === 'llm_request')
    .map((line) => Date.parse(line.at));
  assert.equal(sent.length, 3);
  for (const [i, at] of sent.slice(1).entries()) {
    assert.ok(at - sent[i] >= 140, `requests left ${at - sent[i]} ms apart`);
  }

  // A day's quota is spent: the wait asked for is too long to be worth it.
  const spent = await fakeModel([
    {
      status: 429,
      body: { error: { message: 'Quota exceeded.', details: [{ retryDelay: '3600s' }] } },
    },
  ]);
  const quotaAgent = await startAgent(geminiEnv(stripe, spent));
  t.after(async () => {
    await quotaAgent.stop();
    await spent.close();
  });
  const failed = await post(quotaAgent.url, envelope());
  assert.equal(failed.status, 502);
  assert.equal(failed.body.status, 'failed');
  assert.match(failed.body.error, /gemini answered 429: Quota exceeded/);
  assert.equal(spent.requests.length, 1);
});

test('a model that never stops calling tools is stopped after 8 turns', async (t) => {
  const script = [gemini.turn(gemini.call('lookup_order', { order_ref: 'RR-ORD-A1' }))];
  const { stripe, model, agent } = await harness(t, { script });

  const answer = await post(agent.url, envelope());

  assert.deepEqual(answer.body, {
    status: 'stopped',
    message: '',
    reason: 'still calling tools after 8 turns',
    model: 'gemini-test-model',
    variant: 'careful',
  });
  assert.equal(model.requests.length, 9);
  assert.equal(stripe.requests.length, 8);
});

test('/meta: hashes of exactly what is sent, the same on every start, and pinned', async (t) => {
  /** @param {string} variant @param {typeof geminiEnv} env */
  const sample = async (variant, env) => {
    const stripe = await fakeStripe(oneOrder());
    const model = await fakeModel([
      env === geminiEnv ? gemini.text('Done.') : openai.text('Done.'),
    ]);
    const agent = await startAgent(env(stripe, model, variant));
    t.after(async () => {
      await agent.stop();
      await stripe.close();
      await model.close();
    });
    const meta = await (await fetch(`${agent.url}meta`)).json();
    await post(agent.url, envelope());
    return { meta, sent: model.requests[0].body };
  };

  const careful = await sample('careful', geminiEnv);
  const again = await sample('careful', geminiEnv);
  const minimal = await sample('minimal', geminiEnv);
  const overOpenai = await sample('careful', openaiEnv);

  assert.deepEqual(careful.meta, again.meta);
  assert.deepEqual(careful.meta, {
    variant: 'careful',
    provider: 'gemini',
    model: 'gemini-test-model',
    promptSha256: PINNED.prompt,
    toolsSha256: PINNED.careful,
  });
  assert.equal(minimal.meta.promptSha256, PINNED.prompt);
  assert.equal(minimal.meta.toolsSha256, PINNED.minimal);
  assert.equal(overOpenai.meta.toolsSha256, PINNED.careful);

  // The hashes are of the bytes the model received, whichever provider carried them.
  assert.equal(sha256(careful.sent.systemInstruction.parts[0].text), PINNED.prompt);
  assert.equal(sha256(canonical(careful.sent.tools[0].functionDeclarations)), PINNED.careful);
  assert.equal(sha256(canonical(minimal.sent.tools[0].functionDeclarations)), PINNED.minimal);
  assert.equal(sha256(overOpenai.sent.messages[0].content), PINNED.prompt);
  assert.equal(
    sha256(canonical(overOpenai.sent.tools.map((/** @type {any} */ tool) => tool.function))),
    PINNED.careful,
  );

  // Tools both variants have are declared identically.
  const byName = (/** @type {any} */ sent) =>
    Object.fromEntries(
      sent.tools[0].functionDeclarations.map((/** @type {any} */ d) => [d.name, d]),
    );
  assert.deepEqual(byName(minimal.sent).lookup_order, byName(careful.sent).lookup_order);
});

test(
  'the prompt and both refund descriptions are the preregistration’s, verbatim',
  { skip: !existsSync(PREREGISTRATION) && 'not in the RigorRun repository' },
  () => {
    const text = readFileSync(PREREGISTRATION, 'utf8').replace(/\s*\n\s*/g, ' ');
    assert.ok(text.includes(`"${PROMPT}"`));
    assert.ok(text.includes(`"${CAREFUL_REFUND}"`));
    assert.ok(text.includes(`"${MINIMAL_REFUND}"`));
    assert.ok(
      text.includes('`minimal` is a first version written the way first versions often are'),
    );
  },
);

test('refuses to start with a key that is not test mode, or bound anywhere but Stripe', async () => {
  const base = { GEMINI_API_KEY: GEMINI_KEY, GEMINI_MODEL: 'gemini-test-model', STRIPE_KEY };
  const live = await refusal({ ...base, STRIPE_KEY: 'sk_live_51SecretLiveKey0123456789' });
  assert.equal(live.code, 1);
  assert.match(live.output, /STRIPE_KEY must start with sk_test_ or rk_test_/);
  assert.ok(!live.output.includes('sk_live_51SecretLiveKey0123456789'));

  for (const where of ['https://evil.example.com', 'http://api.stripe.com', 'not a url']) {
    const elsewhere = await refusal({ ...base, STRIPE_BASE_URL: where });
    assert.equal(elsewhere.code, 1, where);
    assert.match(elsewhere.output, /STRIPE_BASE_URL must be/);
  }
  assert.match((await refusal({ ...base, GEMINI_MODEL: '' })).output, /GEMINI_MODEL is required/);
  assert.match(
    (await refusal({ ...base, VARIANT: 'toString' })).output,
    /VARIANT must be careful or minimal/,
  );
  assert.match(
    (await refusal({ ...base, LLM_PROVIDER: 'openai', OPENAI_MODEL: 'x' })).output,
    /OPENAI_BASE_URL is required/,
  );
});
