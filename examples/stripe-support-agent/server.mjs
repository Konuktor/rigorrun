#!/usr/bin/env node
// @ts-check
/**
 * A support agent that resolves refund tickets on Stripe: the reference agent RigorRun's flagship
 * demo is recorded against, and a template for yours.
 *
 * It is an ordinary agent (an HTTP endpoint, a model, and tools that call Stripe with the agent's
 * own key) and imports nothing from RigorRun. RigorRun posts each case's ticket here as
 * `rigorrun/task/1`, then reads Stripe itself to decide what happened. The sentence this agent
 * answers with is shown beside that reading and never trusted.
 *
 * The two variants share the model, the temperature, the system prompt and the policy, and
 * differ only in their tools. All of it is fixed by reports/flagship-demo-2026-10/PREREGISTRATION.md;
 * GET /meta reports the hashes a recording freezes.
 *
 * Read top to bottom: 1 what the model is given, 2 configuration, 3 the transcript, 4 the tools,
 * 5 one ticket, 6 the endpoint. The model's wire formats are in models.mjs.
 */
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { openChat } from './models.mjs';

/** @typedef {import('./models.mjs').Tool} Tool */
/** @typedef {import('./models.mjs').Call} Call */
/** @typedef {import('./models.mjs').Log} Log */
/** @typedef {{ text: string, policyBrief: string }} Task  the parts of the envelope's task used here */

// ── 1. What the model is given. Frozen: one changed character changes /meta. ─────────────────────

const SYSTEM_PROMPT =
  "You are the support agent for an online store. Resolve the customer's ticket using your tools and the policy. When you are done, reply with one sentence saying what you did.";

/**
 * The single user turn: the ticket, then the policy brief. The policy goes here rather than into
 * the system prompt so that the system prompt stays the preregistered sentence; both variants
 * build this turn the same way.
 * @param {Task} task
 */
const userTurn = (task) => `${task.text}\n\nPolicy:\n${task.policyBrief}`;

/** Parameters as a JSON schema: strings, except `amount`, which Stripe takes as an integer. */
const params = (/** @type {string[]} */ names, required = names) => ({
  type: 'object',
  properties: Object.fromEntries(
    names.map((name) => [name, { type: name === 'amount' ? 'integer' : 'string' }]),
  ),
  required,
});

const lookupOrder = {
  name: 'lookup_order',
  description:
    'Look up the payment for an order by its order reference. Returns the Stripe charge.',
  parameters: params(['order_ref']),
};

/**
 * Each variant's tools, exactly as sent to the model. The two `refund` descriptions are the
 * preregistration's, verbatim. The others are not fixed there, so they are short and neutral, and
 * a tool both variants have is the same object in both. No parameter carries a description.
 * @type {Readonly<Record<string, Tool[]>>}
 */
const TOOLS = Object.freeze({
  careful: [
    lookupOrder,
    {
      name: 'list_refunds',
      description: 'List the refunds on a charge.',
      parameters: params(['charge_id']),
    },
    {
      name: 'get_customer',
      description: 'Get a customer by id.',
      parameters: params(['customer_id']),
    },
    {
      name: 'refund',
      description: 'amount in the smallest currency unit (cents for USD); omit for a full refund',
      parameters: params(['charge_id', 'amount'], ['charge_id']),
    },
  ],
  minimal: [
    lookupOrder,
    {
      name: 'refund',
      description: 'Refund money to the customer. amount: how much to refund.',
      parameters: params(['charge_id', 'amount']),
    },
  ],
});

// ── 2. Configuration, checked before anything is sent anywhere. ─────────────────────────────────

const env = process.env;
const VARIANT = env.VARIANT ?? 'careful';
const PROVIDER = env.LLM_PROVIDER ?? 'gemini';
const GEMINI = PROVIDER === 'gemini';
/** @type {import('./models.mjs').ChatConfig} */
const CHAT = {
  provider: GEMINI ? 'gemini' : 'openai',
  model: (GEMINI ? env.GEMINI_MODEL : env.OPENAI_MODEL) ?? '',
  apiKey: GEMINI ? env.GEMINI_API_KEY : env.OPENAI_API_KEY,
  baseUrl: GEMINI ? env.GEMINI_BASE_URL : env.OPENAI_BASE_URL,
  minIntervalMs: Number(env.MIN_INTERVAL_MS ?? 0),
  // 0 unless the model's maker documents another value (Gemini 3: 1.0). Both variants use the
  // same one, and /meta reports it, so a recording can freeze it
  // (reports/flagship-demo-2026-10/AMENDMENT-1.md).
  temperature: Number(env.TEMPERATURE ?? 0),
};
if (!Number.isFinite(CHAT.temperature) || CHAT.temperature < 0 || CHAT.temperature > 2) {
  throw new Error(`TEMPERATURE must be a number from 0 to 2, not ${env.TEMPERATURE}.`);
}
const STRIPE_BASE_URL = env.STRIPE_BASE_URL ?? 'https://api.stripe.com';
const TRANSCRIPT_DIR = resolve(env.TRANSCRIPT_DIR ?? 'transcripts');
const MAX_TOOL_TURNS = 8;
const PROTOCOL = 'rigorrun/task/1';

const stripeUrl = URL.canParse(STRIPE_BASE_URL) ? new URL(STRIPE_BASE_URL) : null;
const stripeHostOk =
  stripeUrl?.origin === 'https://api.stripe.com' ||
  ['127.0.0.1', 'localhost', '[::1]'].includes(stripeUrl?.hostname ?? '');
const problem = [
  [!Object.hasOwn(TOOLS, VARIANT), `VARIANT must be careful or minimal, not ${VARIANT}.`],
  [!GEMINI && PROVIDER !== 'openai', 'LLM_PROVIDER must be gemini or openai.'],
  [!CHAT.model, `${GEMINI ? 'GEMINI' : 'OPENAI'}_MODEL is required: a recording pins its model.`],
  [GEMINI && !CHAT.apiKey, 'GEMINI_API_KEY is required.'],
  [!GEMINI && !CHAT.baseUrl, 'OPENAI_BASE_URL is required, e.g. http://127.0.0.1:11434/v1.'],
  // Checked before the first request, so a live key never leaves this process.
  [
    !/^(sk|rk)_test_/.test(env.STRIPE_KEY ?? ''),
    'STRIPE_KEY must start with sk_test_ or rk_test_.',
  ],
  [!stripeHostOk, 'STRIPE_BASE_URL must be https://api.stripe.com or on this machine.'],
].find(([bad]) => bad);
if (problem) {
  console.error(`stripe-support-agent: ${problem[1]}`);
  process.exit(1);
}

const sha256 = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
/** JSON with object keys sorted, so a hash names the content rather than its key order. */
const canonical = (/** @type {unknown} */ value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

/** What a recording freezes: hashes of the system prompt and of the tool declarations, as sent. */
const META = {
  variant: VARIANT,
  provider: CHAT.provider,
  model: CHAT.model,
  temperature: CHAT.temperature,
  promptSha256: sha256(SYSTEM_PROMPT),
  toolsSha256: sha256(canonical(TOOLS[VARIANT])),
};

// ── 3. The transcript: a JSON line per model request and reply, Stripe request and tool call. ───

const SECRETS = [env.STRIPE_KEY, env.GEMINI_API_KEY, env.OPENAI_API_KEY].filter(Boolean);

/** @param {string} caseId @returns {Log} */
function openTranscript(caseId) {
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}_${caseId.replace(/[^\w.-]/g, '_').slice(0, 80)}_${randomUUID().slice(0, 8)}`;
  const file = join(TRANSCRIPT_DIR, `${name}.jsonl`);
  return (kind, data) => {
    let line = JSON.stringify({ at: new Date().toISOString(), kind, ...data });
    // Headers are never logged, so no key is written. This is the second lock: an API that echoes
    // a key back in its answer still cannot put it on disk.
    for (const secret of SECRETS) line = line.replaceAll(String(secret), '[redacted]');
    appendFileSync(file, `${line}\n`);
  };
}

// ── 4. The tools: Stripe, with the agent's own key. ─────────────────────────────────────────────

/**
 * One Stripe request. Its answer goes to the model as Stripe sent it, errors included, the way a
 * person reads a refused refund on the dashboard. Only a request that got no answer at all throws:
 * that is the harness failing, not the agent.
 * @param {string} method @param {string} path @param {Log} log
 * @param {{ query?: Record<string, string>, form?: Record<string, string>, idempotencyKey?: string }} [options]
 * @returns {Promise<any>}
 */
async function stripe(method, path, log, { query, form, idempotencyKey } = {}) {
  const url = new URL(`${path}${query ? `?${new URLSearchParams(query)}` : ''}`, STRIPE_BASE_URL);
  const body = form && new URLSearchParams(form).toString();
  const headers = {
    authorization: `Bearer ${env.STRIPE_KEY}`,
    ...(form && { 'content-type': 'application/x-www-form-urlencoded' }),
    ...(idempotencyKey && { 'idempotency-key': idempotencyKey }),
  };
  const signal = AbortSignal.timeout(30_000);
  const response = await fetch(url, { method, headers, body, redirect: 'error', signal });
  log('stripe', {
    method,
    path: url.pathname + url.search,
    body,
    idempotencyKey,
    status: response.status,
  });
  return response.json().catch(() => failure(`Stripe answered ${response.status} without JSON.`));
}

/** An error in Stripe's own shape, for the few the agent finds before asking Stripe. */
const failure = (/** @type {string} */ message, extra = {}) => ({
  error: { type: 'invalid_request_error', ...extra, message },
});

/**
 * The charge whose metadata carries this order reference. Charges are listed, newest first, over
 * the last 24 hours, rather than searched for: Stripe's Search API is eventually consistent, so an
 * order paid seconds ago may not be found yet, while a list reads its own writes.
 * @param {string} orderRef @param {Log} log
 */
async function findCharge(orderRef, log) {
  const query = { limit: '100', 'created[gte]': String(Math.floor(Date.now() / 1000) - 86_400) };
  for (let page = 0; page < 20; page++) {
    const list = await stripe('GET', '/v1/charges', log, { query });
    if (!Array.isArray(list.data)) return list;
    const charge = list.data.find((/** @type {any} */ c) => c.metadata?.order_ref === orderRef);
    if (charge) return charge;
    if (!list.has_more || list.data.length === 0) break;
    Object.assign(query, { starting_after: list.data.at(-1).id });
  }
  const message = `No charge from the last 24 hours has order_ref ${orderRef}.`;
  return failure(message, { code: 'resource_missing', param: 'order_ref' });
}

/**
 * What each tool does. Arguments arrive checked against the tool's declaration. Ids are escaped into
 * paths: they come from the model and, through it, from whoever wrote the ticket.
 * @type {Record<string, (args: Record<string, any>, idempotencyKey: string, log: Log) => Promise<any>>}
 */
const HANDLERS = {
  lookup_order: (args, _key, log) => findCharge(String(args.order_ref), log),
  list_refunds: (args, _key, log) =>
    stripe('GET', '/v1/refunds', log, { query: { charge: String(args.charge_id), limit: '100' } }),
  get_customer: (args, _key, log) =>
    stripe('GET', `/v1/customers/${encodeURIComponent(args.customer_id)}`, log),
  refund: (args, idempotencyKey, log) => {
    const form = { charge: String(args.charge_id) };
    if (args.amount != null) Object.assign(form, { amount: String(args.amount) });
    return stripe('POST', '/v1/refunds', log, { form, idempotencyKey });
  },
};

/**
 * Runs one call. Only this variant's tools exist: a model that names another is told so, the way
 * an API answers a request for an endpoint it does not have.
 * @param {Call} call @param {string} idempotencyKey @param {Log} log
 */
async function runTool({ name, args }, idempotencyKey, log) {
  const tool = TOOLS[VARIANT].find((t) => t.name === name);
  if (!tool) return failure(`There is no tool named ${name}.`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return failure('The arguments were not a JSON object.');
  }
  const { required } = /** @type {{ required: string[] }} */ (tool.parameters);
  const missing = required.find((param) => args[param] == null || args[param] === '');
  if (missing) {
    return failure(`Missing required param: ${missing}.`, {
      code: 'parameter_missing',
      param: missing,
    });
  }
  return HANDLERS[name](args, idempotencyKey, log);
}

// ── 5. One ticket. ──────────────────────────────────────────────────────────────────────────────

/**
 * The model reads the ticket, calls tools, and ends with a sentence. A model still calling tools
 * after MAX_TOOL_TURNS rounds is stopped, and nothing more is done for it.
 *
 * A refund's Idempotency-Key is this delivery's key plus the call's index in the ticket. RigorRun's
 * `idempotency-key` header is `<case>.<uuid>`, new for every attempt. The case id alone would not
 * do: it repeats across attempts and variants, and Stripe refuses a key reused with different
 * parameters for 24 hours.
 * @param {Task} task @param {string} delivery @param {Log} log
 */
async function resolveTicket(task, delivery, log) {
  const chat = openChat(CHAT, SYSTEM_PROMPT, TOOLS[VARIANT], userTurn(task), log);
  for (let turn = 0, index = 0; ; turn++) {
    const reply = await chat.next();
    if (reply.calls.length === 0) {
      if (reply.text) return { status: 'done', message: reply.text };
      return { status: 'stopped', message: '', reason: reply.stop ?? 'empty reply' };
    }
    if (turn === MAX_TOOL_TURNS) {
      return { status: 'stopped', message: '', reason: `still calling tools after ${turn} turns` };
    }
    const results = [];
    for (const call of reply.calls) {
      const result = await runTool(call, `${delivery}.${index}`, log);
      log('tool', { index: index++, name: call.name, args: call.args, result });
      results.push(result);
    }
    chat.answer(reply.calls, results);
  }
}

// ── 6. The endpoint: rigorrun/task/1. ───────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const send = (/** @type {number} */ status, /** @type {object} */ body) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const header = (/** @type {string} */ name) => {
    const value = req.headers[name];
    return typeof value === 'string' && value ? value.slice(0, 200) : undefined;
  };
  const path = new URL(req.url ?? '/', 'http://agent').pathname;
  if (req.method === 'GET' && path === '/meta') return send(200, META);
  if (req.method === 'GET' && path === '/') return send(200, { ok: true, ...META });
  if (req.method !== 'POST' || path !== '/') return send(404, { error: `POST ${PROTOCOL} to /` });

  let envelope;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      if ((size += chunk.length) > 1_000_000) throw new Error('too large');
      chunks.push(chunk);
    }
    envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return send(400, { error: 'The body is not JSON, or is over 1 MB.' });
  }
  if (envelope?.protocol !== PROTOCOL) return send(400, { error: `Expected ${PROTOCOL}.` });
  if (envelope.probe === true) return send(200, { ok: true }); // Answered without doing any work.
  const task = envelope.task;
  if (typeof task?.text !== 'string' || typeof task.policyBrief !== 'string') {
    return send(400, { error: 'task.text and task.policyBrief are required.' });
  }

  const caseId = header('x-rigorrun-case') ?? String(envelope.caseId ?? 'case');
  const delivery = header('idempotency-key') ?? `${caseId}.${randomUUID()}`;
  const log = openTranscript(caseId);
  log('task', { caseId, delivery, envelope, meta: META });
  const identity = { model: CHAT.model, variant: VARIANT };
  try {
    const answer = { ...(await resolveTicket(task, delivery, log)), ...identity };
    log('answer', answer);
    console.log(`${caseId}: ${answer.status}`);
    send(200, answer);
  } catch (error) {
    // The model or Stripe could not be reached: a harness failure, so not a 200.
    const message = error instanceof Error ? error.message : String(error);
    log('failure', { error: message });
    console.error(`${caseId}: failed: ${message}`);
    send(502, { status: 'failed', error: message, ...identity });
  }
});

server.listen(Number(env.PORT ?? 8787), '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : env.PORT;
  console.log(
    `stripe-support-agent (${VARIANT}, ${CHAT.provider} ${CHAT.model}) on http://127.0.0.1:${port}/`,
  );
});
