#!/usr/bin/env node
/**
 * Drives RigorRun's own runner API through the product journey, headlessly.
 *
 * RigorRun 0.2.0 has no CLI for connecting a system or teaching a job — those
 * are interface-only (docs/V1_GAP_AUDIT.md). The interface is a client of the
 * runner's loopback HTTP API, so this script does what the interface does:
 * start the runner, redeem the one-time pairing code for the session cookie,
 * then call the same /api/projects routes in the same order. No RigorRun
 * internals are imported; only the public routes are used. Running and gating
 * are then done with the real CLI (`rigorrun run/gate --project`).
 *
 * Usage:
 *   node journey.mjs setup <spec.json> --home <dir> --out <artefact-dir>
 *   node journey.mjs add-agent --home <dir> --project <id> --name <n> --command <c> [--arg <a>]...
 *   node journey.mjs api --home <dir> <METHOD> <path> [json-body]
 *
 * Secrets: spec.secrets maps a secret NAME to the environment variable holding
 * its value; values are written with `rigorrun secrets set` and never land in
 * any artefact.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const TSX = join(REPO, 'node_modules', '.bin', 'tsx');
const BIN = join(REPO, 'packages', 'cli', 'src', 'bin.ts');

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function flags(name) {
  const out = [];
  process.argv.forEach((value, index) => { if (value === `--${name}`) out.push(process.argv[index + 1]); });
  return out;
}

function cli(args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(TSX, [BIN, ...args], { cwd: REPO, env: { ...process.env, NO_COLOR: '1', ...env } });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => resolveRun({ code, out }));
  });
}

async function startRunner(home, port) {
  return new Promise((resolveStart, reject) => {
    const child = spawn(TSX, [BIN, '--no-open', '--home', home, '--port', String(port)], {
      cwd: REPO, env: { ...process.env, NO_COLOR: '1', RIGORRUN_SECRET_BACKEND: 'file' },
    });
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('runner did not start: ' + buffer.slice(-500))), 60_000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?code=([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})/.exec(buffer);
      if (m) { clearTimeout(timer); resolveStart({ child, port: Number(m[1]), code: m[2] }); }
    });
    child.stderr.on('data', (chunk) => (buffer += chunk));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`runner exited ${code}: ${buffer.slice(-800)}`)); });
  });
}

async function pair(port, code) {
  const response = await fetch(`http://127.0.0.1:${port}/?code=${code}`, { redirect: 'manual' });
  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error(`pairing failed: HTTP ${response.status}`);
  return cookie.split(';')[0];
}

function makeApi(port, cookie, log) {
  return async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    log.push({ at: new Date().toISOString(), method, path, request: body ?? null, status: response.status, response: json });
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 600)}`);
    return json;
  };
}

function save(dir, name, value) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}

async function withRunner(home, fn) {
  const port = 41000 + Math.floor(Math.random() * 2000);
  const runner = await startRunner(home, port);
  try {
    const cookie = await pair(runner.port, runner.code);
    const log = [];
    const api = makeApi(runner.port, cookie, log);
    return await fn(api, log);
  } finally {
    runner.child.kill('SIGTERM');
  }
}

async function setup() {
  const specPath = process.argv[3];
  const home = resolve(flag('home'));
  const out = resolve(flag('out'));
  // `{REPO}` in a spec is this checkout, so specs carry no machine path.
  const spec = JSON.parse(readFileSync(specPath, 'utf8').split('{REPO}').join(REPO));
  mkdirSync(home, { recursive: true });
  mkdirSync(out, { recursive: true });

  for (const [name, envVar] of Object.entries(spec.secrets ?? {})) {
    const value = process.env[envVar];
    if (value === undefined) throw new Error(`secret ${name}: environment variable ${envVar} is not set`);
    const r = await cli(['secrets', 'set', name, '--home', home], { RIGORRUN_SECRET_VALUE: value, RIGORRUN_SECRET_BACKEND: 'file' });
    if (r.code !== 0) throw new Error(`secrets set ${name} failed: ${r.out}`);
  }

  return withRunner(home, async (api, log) => {
    const artefacts = {};
    const created = await api('POST', '/api/projects', { name: spec.name, goal: spec.goal });
    const id = created.project.id;
    artefacts.projectId = id;

    const connected = await api('POST', `/api/projects/${id}/environment`, { connector: spec.connector, safety: spec.safety ?? 'local' });
    save(out, 'discovery.json', { serverName: connected.serverName, latencyMs: connected.latencyMs, tools: connected.tools });

    const configured = await api('POST', `/api/projects/${id}/environment/config`, {
      readOnlyTools: spec.readOnlyTools ?? [], verifierReads: spec.verifierReads ?? [], reset: spec.reset ?? { kind: 'none' },
    });
    save(out, 'readsProblem.txt', (configured.readsProblem || '(no problem reported)') + '\n');

    await api('POST', `/api/projects/${id}/teach/start`, {});
    const teachLog = [];
    for (const step of spec.teach) {
      // A demonstration may need real time to pass (a timer that must run for a
      // minute before it is stopped). Nothing is called during the pause.
      if (step.sleepSeconds) { await new Promise((r) => setTimeout(r, step.sleepSeconds * 1000)); teachLog.push({ step }); continue; }
      const result = await api('POST', `/api/projects/${id}/teach/call`, { tool: step.tool, args: step.args ?? {} });
      teachLog.push({ step, result });
    }
    save(out, 'teach.json', teachLog);
    const finished = await api('POST', `/api/projects/${id}/teach/finish`, {});
    save(out, 'questions.json', finished.questions);
    save(out, 'schema.json', finished.schema);
    save(out, 'mismatches.json', finished.mismatches ?? []);

    const answers = [];
    for (const question of finished.questions ?? []) {
      let value = question.proposed;
      for (const [pattern, chosen] of Object.entries(spec.answers ?? {})) {
        if (new RegExp(pattern).test(question.id)) value = chosen;
      }
      answers.push({ questionId: question.id, value });
    }
    await api('POST', `/api/projects/${id}/schema/answers`, { answers });
    save(out, 'answers.json', answers);

    const compiled = await api('POST', `/api/projects/${id}/compile`, {});
    save(out, 'contract-proposed.json', compiled.contract);
    const confirm = [], reject = [];
    for (const rule of compiled.contract.rules ?? []) {
      const text = rule.statement ?? '';
      // Every proposed rule gets an explicit decision, because RigorRun refuses to
      // build a suite while any rule is undecided. Policy: confirm what the spec
      // names, reject everything else, and record both lists as evidence.
      if ((spec.review?.reject ?? []).some((p) => new RegExp(p, 'i').test(text))) reject.push(rule.id);
      else if ((spec.review?.confirm ?? []).some((p) => new RegExp(p, 'i').test(text))) confirm.push(rule.id);
      else if (rule.status === 'inferred') reject.push(rule.id);
    }
    const reviewed = await api('POST', `/api/projects/${id}/review`, { confirmedRuleIds: confirm, rejectedRuleIds: reject });
    save(out, 'contract-reviewed.json', reviewed.contract);
    save(out, 'review.json', { confirmedRuleIds: confirm, rejectedRuleIds: reject,
      rules: (reviewed.contract.rules ?? []).map((r) => ({ id: r.id, status: r.status, statement: r.statement })) });

    const benchmark = await api('POST', `/api/projects/${id}/benchmark`, {});
    save(out, 'benchmark-summary.json', benchmark);
    if (spec.quality) {
      try { save(out, 'quality.json', (await api('POST', `/api/projects/${id}/quality`, {})).quality); }
      catch (error) { save(out, 'quality.json', { error: String(error.message) }); }
    }
    const agents = [];
    for (const agent of spec.agents ?? []) {
      const added = await api('POST', `/api/projects/${id}/agents`, { name: agent.name, command: agent.command, args: agent.args ?? [] });
      agents.push(added.agent);
    }
    save(out, 'agents.json', agents);
    save(out, 'api-log.json', log);
    save(out, 'project.json', (await api('GET', `/api/projects/${id}`)));
    process.stdout.write(id + '\n');
    return id;
  });
}

async function addAgent() {
  const home = resolve(flag('home'));
  const project = flag('project');
  return withRunner(home, async (api) => {
    const added = await api('POST', `/api/projects/${project}/agents`, { name: flag('name'), command: flag('command'), args: flags('arg') });
    process.stdout.write(JSON.stringify(added.agent) + '\n');
  });
}

async function rawApi() {
  const home = resolve(flag('home'));
  const rest = process.argv.slice(3).filter((v, i, a) => !(a[i - 1] === '--home' || v === '--home'));
  const [method, path, body] = rest;
  return withRunner(home, async (api) => {
    process.stdout.write(JSON.stringify(await api(method, path, body ? JSON.parse(body) : undefined), null, 2) + '\n');
  });
}

const mode = process.argv[2];
const run = mode === 'setup' ? setup : mode === 'add-agent' ? addAgent : mode === 'api' ? rawApi : null;
if (!run) { process.stderr.write('usage: journey.mjs setup|add-agent|api ...\n'); process.exit(2); }
run().then(() => process.exit(0), (error) => { process.stderr.write(`journey: ${error.message}\n`); process.exit(1); });
