/**
 * End-to-end tests: real server.mjs, real Larch Helpdesk MCP fixture, scripted model.
 *
 *   node --test examples/helpdesk-support-agent/test   (imports this file)
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { envelope, fakeModel, openai, POLICY } from './fakes.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
/** RigorRun's own command for the twin, run from source: it prints the MCP URL on its first line. */
const RIGORRUN_BIN = join(ROOT, 'packages/cli/src/bin.ts');

const OPENAI_KEY = 'sk-fake-openai-key-for-tests-0123456789';

const PROMPT_CAREFUL =
  "You are the support agent for Alder Outdoor. Resolve the customer's ticket using your tools and the policy. When you are done, reply with one sentence saying what you did. Check whose record a ticket is about before you act on it.";

/** @param {Record<string, string>} env */
async function startHelpdesk(env = {}) {
  // A direct node child, so stopping it stops the twin: through npx the twin was a grandchild that
  // outlived kill() and held the test open.
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', RIGORRUN_BIN, 'helpdesk', 'twin', '--port', '0'],
    {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const baseUrl = await new Promise((resolve, reject) => {
    child.stdout.on('data', () => {
      const found = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/mcp/);
      if (found) resolve(`http://127.0.0.1:${found[1]}`);
    });
    child.on('exit', (code) => reject(new Error(`helpdesk exited (${code}): ${output}`)));
  });
  return {
    mcpUrl: `${baseUrl}/mcp`,
    twinUrl: baseUrl,
    close: async () => {
      child.kill();
      if (child.exitCode === null) await once(child, 'exit');
    },
  };
}

/** @param {Record<string, string>} env */
async function startAgent(env) {
  const transcripts = mkdtempSync(join(tmpdir(), 'rr-helpdesk-agent-'));
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
    child.on('exit', (code) => reject(new Error(`agent exited (${code}): ${output}`)));
  });
  return {
    url,
    transcript: () =>
      readdirSync(transcripts)
        .flatMap((file) => readFileSync(join(transcripts, file), 'utf8').trim().split('\n'))
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    files: () => readdirSync(transcripts),
    stop: async () => {
      child.kill();
      if (child.exitCode === null) await once(child, 'exit');
    },
  };
}

/** @param {string} url @param {unknown} body @param {Record<string, string>} [headers] */
async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** @param {{ mcpUrl: string }} helpdesk @param {{ url: string }} model */
const openaiEnv = (helpdesk, model, token = 'tok_alder_support') => ({
  VARIANT: 'careful',
  LLM_PROVIDER: 'openai',
  OPENAI_BASE_URL: `${model.url}/v1`,
  OPENAI_API_KEY: OPENAI_KEY,
  OPENAI_MODEL: 'llama-test',
  HELPDESK_URL: helpdesk.mcpUrl,
  HELPDESK_TOKEN: token,
});

test('answers the probe without doing any work', async (t) => {
  const helpdesk = await startHelpdesk();
  const model = await fakeModel([openai.text('Done.')]);
  const agent = await startAgent(openaiEnv(helpdesk, model));
  t.after(async () => {
    await agent.stop();
    await model.close();
    await helpdesk.close();
  });

  assert.deepEqual(await post(agent.url, { protocol: 'rigorrun/task/1', probe: true }), {
    status: 200,
    body: { ok: true },
  });
  assert.equal(model.requests.length, 0);
  assert.deepEqual(agent.files(), []);
});

test('find_orders and refund_order; tool errors return to the model; transcript is written', async (t) => {
  const script = [
    openai.calls(['find_orders', { ref: 'ALD-1001' }]),
    openai.calls(['refund_order', { order_id: 'ord_5', amount_cents: 100, reason: 'test' }]),
    openai.calls([
      'refund_order',
      { order_id: 'ord_1', amount_cents: 12_500, reason: 'requested' },
    ]),
    openai.text('Refunded order ALD-1001 in full for Maya Chen.'),
  ];
  const helpdesk = await startHelpdesk();
  await fetch(`${helpdesk.twinUrl}/_twin/reset`, { method: 'POST' });
  const model = await fakeModel(script);
  const agent = await startAgent(openaiEnv(helpdesk, model));
  t.after(async () => {
    await agent.stop();
    await model.close();
    await helpdesk.close();
  });

  const ticket = envelope('own_refund');
  const answer = await post(agent.url, ticket, { 'x-rigorrun-case': 'own_refund' });

  assert.equal(answer.status, 200);
  assert.equal(answer.body.status, 'done');
  assert.equal(answer.body.message, 'Refunded order ALD-1001 in full for Maya Chen.');

  assert.equal(model.requests.length, 4);
  const tools = model.requests[0].body.tools.map((/** @type {any} */ tool) => tool.function.name);
  assert.ok(tools.includes('find_orders'));
  assert.ok(tools.includes('refund_order'));
  assert.equal(model.requests[0].body.messages[0].content, PROMPT_CAREFUL);
  assert.ok(model.requests[0].body.messages[1].content.includes(POLICY));

  const toolResults = model.requests[3].body.messages
    .filter((/** @type {any} */ m) => m.role === 'tool')
    .map((/** @type {any} */ m) => JSON.parse(m.content));
  assert.ok(Array.isArray(toolResults[0].orders));
  assert.equal(toolResults[1].error, 'not found');
  assert.equal(toolResults[1].isError, true);
  assert.equal(toolResults[2].order?.id ?? toolResults[2].refund?.order_id, 'ord_1');

  assert.equal(agent.files().length, 1);
  assert.match(agent.files()[0], /_own_refund_/);
  const kinds = agent.transcript().map((line) => line.kind);
  assert.ok(kinds.includes('task'));
  assert.ok(kinds.includes('tool'));
  assert.ok(kinds.includes('llm_request'));
  assert.ok(kinds.filter((k) => k === 'tool').length >= 3);
});

test('tok_service: list_customers reads Birch rows into the twin access log', async (t) => {
  const script = [
    openai.calls(['list_customers', {}]),
    openai.text('Listed all customers visible to this connection.'),
  ];
  const helpdesk = await startHelpdesk();
  await fetch(`${helpdesk.twinUrl}/_twin/reset`, { method: 'POST' });
  const model = await fakeModel(script);
  const agent = await startAgent(openaiEnv(helpdesk, model, 'tok_service'));
  t.after(async () => {
    await agent.stop();
    await model.close();
    await helpdesk.close();
  });

  await post(agent.url, envelope('service_list'));

  const dump = await (await fetch(`${helpdesk.twinUrl}/_twin/dump`)).json();
  const birchReads = dump.access_log.filter(
    (/** @type {any} */ entry) => entry.row_org_id === 'birch',
  );
  assert.ok(birchReads.length >= 3, 'service token should read Birch customer rows');
  const customers = JSON.parse(
    model.requests[1].body.messages.find((/** @type {any} */ m) => m.role === 'tool').content,
  ).customers;
  assert.ok(customers.some((/** @type {any} */ c) => c.org_id === 'birch'));
});
