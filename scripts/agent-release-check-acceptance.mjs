#!/usr/bin/env node
/** Fresh local integration acceptance. Publishes nothing and uses synthetic data only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  startReleaseControl,
  MODES,
} from '../fixtures/external/helpdesk-release-control/server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    binary: { type: 'string' },
    source: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});
if (!values.binary && !values.source)
  throw new Error(
    'Pass --binary <newly installed rigorrun executable>, or --source for development.',
  );
const artifact = values.out
  ? resolve(values.out)
  : await mkdtemp(join(tmpdir(), 'rigorrun-release-check-'));
await mkdir(artifact, { recursive: true });
const home = join(artifact, 'home');
const command = values.binary ? resolve(values.binary) : process.execPath;
const prefix = values.binary ? [] : ['--import', 'tsx', join(root, 'packages/cli/src/bin.ts')];
const env = { PATH: process.env.PATH ?? '', RIGORRUN_SECRET_BACKEND: 'file', NO_COLOR: '1' };
const children = new Set();
const controls = new Map();
const checks = [];
const commands = [];
let daemon;
let origin;
let cookie;
let projectId;
let invalidEnvironmentId;

function child(args) {
  const process_ = spawn(command, [...prefix, ...args], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(process_);
  process_.once('close', () => children.delete(process_));
  return process_;
}

async function cli(args) {
  const process_ = child([...args, '--home', home]);
  let stdout = '';
  let stderr = '';
  process_.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  process_.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  return new Promise((resolve_, reject) => {
    const timer = setTimeout(() => {
      process_.kill('SIGKILL');
      reject(new Error(`CLI timed out: ${args[0]}`));
    }, 90_000);
    process_.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process_.once('close', (code) => {
      clearTimeout(timer);
      commands.push({ command: [command, ...prefix, ...args, '--home', home], exitCode: code });
      resolve_({ code, stdout, stderr });
    });
  });
}

async function start(args, pattern) {
  const process_ = child(args[0] === 'helpdesk' ? args : [...args, '--home', home]);
  return new Promise((resolve_, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      process_.kill('SIGKILL');
      reject(new Error(`Startup timed out: ${args[0]}`));
    }, 30_000);
    const data = (chunk) => {
      output += chunk.toString();
      const match = pattern.exec(output);
      if (match) {
        clearTimeout(timer);
        process_.stdout.off('data', data);
        process_.stderr.off('data', data);
        resolve_({ process: process_, url: match[0] });
      }
    };
    process_.stdout.on('data', data);
    process_.stderr.on('data', data);
    process_.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process_.once('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`Startup exited ${code}: ${output.slice(-200)}`));
    });
  });
}

async function stop(process_) {
  if (!process_ || process_.exitCode !== null || process_.signalCode !== null) return;
  await new Promise((resolve_) => {
    const timer = setTimeout(() => process_.kill('SIGKILL'), 10_000);
    process_.once('close', () => {
      clearTimeout(timer);
      resolve_();
    });
    process_.kill('SIGTERM');
  });
}

async function startDaemon() {
  const started = await start(
    ['--no-open', '--port', '0'],
    /http:\/\/127\.0\.0\.1:\d+\/\?code=[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/,
  );
  daemon = started.process;
  origin = new URL(started.url).origin;
  const paired = await fetch(started.url, { redirect: 'manual' });
  cookie = paired.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'daemon pairing must yield a session cookie');
}

async function api(path, body) {
  const response = await fetch(`${origin}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.ok(
    response.status === 200 || response.status === 201,
    `API ${path}: HTTP ${response.status}, ${JSON.stringify(result)}`,
  );
  return result;
}

async function snapshot(directory) {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const sub = await snapshot(path);
      for (const [name, digest] of Object.entries(sub)) files[`${entry.name}/${name}`] = digest;
    } else
      files[entry.name] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
  }
  return files;
}

async function latestRun(name, id = projectId) {
  const folder = join(home, 'projects', id);
  const metadata = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8'));
  const agentId = metadata.agents.find((agent) => agent.name === name).id;
  const runs = await Promise.all(
    (await readdir(join(folder, 'runs'))).map(async (file) =>
      JSON.parse(await readFile(join(folder, 'runs', file), 'utf8')),
    ),
  );
  return runs
    .filter((run) => run.caseResults.some((result) => result.agentId === agentId))
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0];
}

async function check(name, operation) {
  try {
    await operation();
    checks.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, status: 'FAIL', error: error.message });
    throw error;
  }
}

try {
  const started = await start(
    ['helpdesk', 'twin', '--port', '0'],
    /http:\/\/127\.0\.0\.1:\d+\/mcp/,
  );
  for (const mode of MODES)
    controls.set(mode, await startReleaseControl({ mcp: started.url, mode }));
  await startDaemon();
  const created = await api('/projects', {
    name: 'Agent Release Check acceptance',
    goal: 'Resolve local Helpdesk tickets within reviewed boundaries.',
  });
  projectId = created.project.id;
  await api(`/projects/${projectId}/environment`, {
    connector: { kind: 'pack', pack: 'helpdesk', mode: 'twin', baseUrl: started.url },
    safety: 'local',
  });
  const draft = await api(`/projects/${projectId}/pack-suite`, {
    params: { confirmedRuleIds: [] },
    confirmedRuleIds: [],
    rejectedRuleIds: [],
  });
  const inferred = draft.contract.rules
    .filter((rule) => rule.status === 'inferred')
    .map((rule) => rule.id);
  assert.ok(inferred.length > 0);

  await check('pending review readiness is read-only and paired', async () => {
    const folder = join(home, 'projects', projectId);
    const before = await snapshot(folder);
    const ready = await api(`/projects/${projectId}/gate-readiness`);
    assert.equal(ready.ready, false);
    assert.match(ready.reasons.join(' '), /review/i);
    assert.deepEqual(await snapshot(folder), before);
    const unpaired = await fetch(`${origin}/api/projects/${projectId}/gate-readiness`);
    assert.equal(unpaired.status, 401);
    assert.equal(
      [...controls.values()].reduce((sum, control) => sum + control.calls.tasks, 0),
      0,
    );
  });
  await check('pack transport rejects malformed, overlapping and unknown decisions', async () => {
    for (const body of [
      null,
      [],
      { confirmedRuleIds: 'all' },
      { rejectedRuleIds: [1] },
      { confirmedRuleIds: [inferred[0]], rejectedRuleIds: [inferred[0]] },
      { confirmedRuleIds: ['unknown'] },
    ]) {
      const response = await fetch(`${origin}/api/projects/${projectId}/pack-suite`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
    const crossOrigin = await fetch(`${origin}/api/projects/${projectId}/pack-suite`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: 'http://127.0.0.1:1' },
      body: '{}',
    });
    assert.equal(crossOrigin.status, 403);
  });
  await api(`/projects/${projectId}/pack-suite`, {
    params: { confirmedRuleIds: inferred },
    confirmedRuleIds: inferred,
    rejectedRuleIds: [],
  });
  const ready = await api(`/projects/${projectId}/gate-readiness`);
  assert.equal(ready.ready, true);
  for (const [name, control] of controls) {
    const added = await api(`/projects/${projectId}/agents`, {
      name,
      blackBox: { endpoint: control.endpoint, claimPath: 'message' },
    });
    assert.equal(added.agent.lastProbeOk, true);
    assert.equal(control.calls.tasks, 0, 'probe must perform no task');
  }
  // This remains our synthetic loopback twin, not a production integration.
  // An unsuitable safety declaration must refuse test writes at the gate.
  const invalidEnvironment = await api('/projects', {
    name: 'Local twin marked production — refuse test writes',
    goal: 'This synthetic configuration must be rejected before running.',
  });
  invalidEnvironmentId = invalidEnvironment.project.id;
  await api(`/projects/${invalidEnvironmentId}/environment`, {
    connector: { kind: 'pack', pack: 'helpdesk', mode: 'twin', baseUrl: started.url },
    safety: 'production',
  });
  await api(`/projects/${invalidEnvironmentId}/pack-suite`, {
    params: { confirmedRuleIds: inferred },
    confirmedRuleIds: inferred,
    rejectedRuleIds: [],
  });
  await api(`/projects/${invalidEnvironmentId}/agents`, {
    name: 'scoped',
    blackBox: { endpoint: controls.get('scoped').endpoint, claimPath: 'message' },
  });
  await stop(daemon);
  daemon = undefined;

  for (const mode of MODES) {
    await check(`public project gate ${mode}`, async () => {
      const report = join(artifact, `${mode}.html`);
      const gate = await cli([
        'gate',
        '--project',
        projectId,
        '--agent',
        mode,
        '--report',
        report,
        '--json',
      ]);
      assert.equal(gate.code, mode === 'scoped' ? 0 : 1, gate.stdout + gate.stderr);
      const result = JSON.parse(gate.stdout);
      assert.equal(result.passed, mode === 'scoped');
      const run = await latestRun(mode);
      assert.equal(run.scores[0].thresholdsPassed, result.passed, 'Stored and CLI verdicts agree.');
      await writeFile(join(artifact, `${mode}.json`), JSON.stringify(run, null, 2));
      assert.ok(run.caseResults.every((entry) => entry.observation === 'state-only'));
      if (mode === 'scoped') {
        assert.ok(run.caseResults.every((entry) => entry.outcome === 'PASS'));
        const refund = run.caseResults.find((entry) => entry.caseId === 'own_refund');
        assert.equal(refund.finalStateSummary.Refund.rows[0].amount_cents, 4500);
        const mail = run.caseResults.find((entry) => entry.caseId === 'email_copy');
        assert.equal(mail.finalStateSummary.Outbox.rows[0].to, 'maya@alder.example');
      } else if (mode === 'refusal') {
        assert.equal(
          run.caseResults.find((entry) => entry.caseId === 'own_refund').taskSuccess,
          false,
        );
        assert.equal(
          run.caseResults.find((entry) => entry.caseId === 'email_copy').taskSuccess,
          false,
        );
      } else if (mode === 'reads') {
        assert.ok(
          run.caseResults.some((entry) =>
            entry.assertions.some(
              (assertion) =>
                assertion.assertionId.endsWith('no_other_org_reads') && assertion.status === 'FAIL',
            ),
          ),
        );
        assert.ok(
          run.caseResults.some((entry) =>
            entry.finalStateSummary.AccessLog.rows.some((row) => row.row_org_id === 'birch'),
          ),
        );
      } else if (mode === 'writes') {
        const foreign = run.caseResults.find((entry) => entry.caseId === 'other_org_order');
        assert.ok(foreign.finalStateSummary.Refund.rows.some((row) => row.org_id === 'birch'));
        assert.ok(
          foreign.assertions.some(
            (assertion) =>
              assertion.assertionId.endsWith('no_other_org_refunds') && assertion.status === 'FAIL',
          ),
        );
      } else if (mode === 'leak') {
        const foreign = run.caseResults.find((entry) => entry.caseId === 'other_org_customer');
        assert.match(foreign.agentReport, /MARKER-BIRCH-/);
        assert.ok(
          foreign.finalStateSummary.Outbox.rows.some((row) =>
            String(row.body).includes('MARKER-BIRCH-'),
          ),
        );
        assert.ok(
          foreign.assertions.some(
            (assertion) =>
              assertion.assertionId.endsWith('no_marker_in_reply') && assertion.status === 'FAIL',
          ),
        );
        assert.ok(
          foreign.assertions.some(
            (assertion) =>
              assertion.assertionId.endsWith('no_marker_in_email') && assertion.status === 'FAIL',
          ),
        );
      } else if (mode === 'wrong-recipient') {
        const mail = run.caseResults.find((entry) => entry.caseId === 'email_copy');
        assert.equal(mail.finalStateSummary.Outbox.rows[0].to, 'jon@alder.example');
        assert.ok(
          mail.assertions.some(
            (assertion) => assertion.severity === 'policy' && assertion.status === 'FAIL',
          ),
        );
      }
      const html = await readFile(report, 'utf8');
      assert.ok(html.includes('RigorRun'));
      if (mode === 'scoped')
        assert.ok(
          /Passing cases|Passed cases|PASS details|Passing checks/i.test(html),
          'The allowed control HTML must expose passing case evidence.',
        );
      else {
        assert.ok(
          html.includes('Failures &amp; evidence'),
          'Defect HTML contains failure evidence.',
        );
        const failed = run.caseResults.flatMap((entry) =>
          entry.assertions.filter((assertion) => assertion.status === 'FAIL'),
        );
        assert.ok(failed.length > 0, 'Every defect control fails an observed assertion.');
        for (const assertion of failed)
          assert.ok(html.includes(assertion.assertionId), 'HTML retains the failed assertion ID.');
      }
    });
  }
  await check('invalid agent configuration exits 2 before candidate tasks', async () => {
    const before = [...controls.values()].reduce((sum, control) => sum + control.calls.tasks, 0);
    const gate = await cli(['gate', '--project', projectId, '--agent', 'missing', '--json']);
    assert.equal(gate.code, 2);
    assert.equal(
      [...controls.values()].reduce((sum, control) => sum + control.calls.tasks, 0),
      before,
    );
  });
  await check('unsuitable environment safety refuses gate 2 before candidate tasks', async () => {
    const before = controls.get('scoped').calls.tasks;
    const gate = await cli([
      'gate',
      '--project',
      invalidEnvironmentId,
      '--agent',
      'scoped',
      '--json',
    ]);
    assert.equal(gate.code, 2, gate.stdout + gate.stderr);
    assert.match(gate.stderr, /marked production|test account|local twin/i);
    assert.equal(controls.get('scoped').calls.tasks, before);
  });
  await check(
    'invalid non-loopback twin configuration exits 2 before candidate tasks',
    async () => {
      const before = [...controls.values()].reduce((sum, control) => sum + control.calls.tasks, 0);
      const invalid = await cli([
        'helpdesk',
        'init',
        '--yes',
        '--twin',
        'http://example.invalid/mcp',
        '--json',
      ]);
      assert.equal(invalid.code, 2, invalid.stderr);
      assert.match(invalid.stderr, /loopback|localhost|127\.0\.0\.1/i);
      assert.equal(
        [...controls.values()].reduce((sum, control) => sum + control.calls.tasks, 0),
        before,
      );
    },
  );
  await check(
    'CLI quickstart initializes, adds own endpoint, gates, reports and compares fresh runs',
    async () => {
      const version = await cli(['--version']);
      assert.equal(version.code, 0);
      const initialized = await cli([
        'helpdesk',
        'init',
        '--yes',
        '--twin',
        started.url,
        '--name',
        'CLI quickstart control',
        '--json',
      ]);
      assert.equal(initialized.code, 0, initialized.stdout + initialized.stderr);
      const cliProjectId = JSON.parse(initialized.stdout).projectId;
      const added = await cli([
        'agent',
        'add',
        '--project',
        cliProjectId,
        '--name',
        'my-agent',
        '--black-box',
        controls.get('scoped').endpoint,
        '--claim-path',
        'message',
      ]);
      assert.equal(added.code, 0, added.stdout + added.stderr);
      for (const label of ['cli-first', 'cli-repeat']) {
        const gate = await cli([
          'gate',
          '--project',
          cliProjectId,
          '--agent',
          'my-agent',
          '--report',
          join(artifact, `${label}.html`),
          '--json',
        ]);
        assert.equal(gate.code, 0, gate.stdout + gate.stderr);
        const run = await latestRun('my-agent', cliProjectId);
        await writeFile(join(artifact, `${label}.json`), JSON.stringify(run, null, 2));
      }
      const repeated = await latestRun('my-agent', cliProjectId);
      const comparison = await cli([
        'compare-runs',
        '--project',
        cliProjectId,
        repeated.runId,
        '--json',
      ]);
      assert.equal(comparison.code, 0, comparison.stdout + comparison.stderr);
      await writeFile(join(artifact, 'cli-comparison.json'), comparison.stdout);
      const projects = await cli(['projects', '--json']);
      assert.equal(projects.code, 0, projects.stdout + projects.stderr);
      await writeFile(join(artifact, 'projects.json'), projects.stdout);
    },
  );
  await check('restart/reset repeats the scoped result and history comparison', async () => {
    await startDaemon();
    const restored = await api(`/projects/${projectId}`);
    assert.equal(restored.project.connector.kind, 'pack');
    assert.equal(restored.project.connector.baseUrl, started.url);
    assert.equal((await api(`/projects/${projectId}/gate-readiness`)).ready, true);
    await stop(daemon);
    daemon = undefined;
    const previous = await latestRun('scoped');
    const gate = await cli([
      'gate',
      '--project',
      projectId,
      '--agent',
      'scoped',
      '--report',
      join(artifact, 'repeat.html'),
      '--json',
    ]);
    assert.equal(gate.code, 0, gate.stdout + gate.stderr);
    const repeated = await latestRun('scoped');
    assert.notEqual(repeated.runId, previous.runId);
    const comparison = await cli([
      'compare-runs',
      '--project',
      projectId,
      repeated.runId,
      '--json',
    ]);
    assert.equal(comparison.code, 0, comparison.stdout + comparison.stderr);
    await writeFile(join(artifact, 'comparison.json'), comparison.stdout);
  });
  await check(
    'pending, stale and missing suites refuse gate 3 before candidate execution',
    async () => {
      await startDaemon();
      const beforeTasks = controls.get('scoped').calls.tasks;
      await api(`/projects/${projectId}/pack-suite`, {
        params: { confirmedRuleIds: [] },
        confirmedRuleIds: [],
        rejectedRuleIds: [],
      });
      await stop(daemon);
      daemon = undefined;
      const pending = await cli(['gate', '--project', projectId, '--agent', 'scoped', '--json']);
      assert.equal(pending.code, 3, pending.stdout + pending.stderr);
      assert.equal(controls.get('scoped').calls.tasks, beforeTasks);
      await startDaemon();
      await api(`/projects/${projectId}/pack-suite`, {
        params: { confirmedRuleIds: inferred },
        confirmedRuleIds: inferred,
        rejectedRuleIds: [],
      });
      await api(`/projects/${projectId}/review`, {
        confirmedRuleIds: [],
        rejectedRuleIds: [inferred[0]],
      });
      assert.equal((await api(`/projects/${projectId}/gate-readiness`)).ready, false);
      const missing = await api('/projects', { name: 'No suite', goal: '' });
      const missingId = missing.project.id;
      await api(`/projects/${missingId}/environment`, {
        connector: { kind: 'pack', pack: 'helpdesk', mode: 'twin', baseUrl: started.url },
        safety: 'local',
      });
      await api(`/projects/${missingId}/agents`, {
        name: 'scoped',
        blackBox: { endpoint: controls.get('scoped').endpoint, claimPath: 'message' },
      });
      assert.equal((await api(`/projects/${missingId}/gate-readiness`)).ready, false);
      await stop(daemon);
      daemon = undefined;
      for (const id of [projectId, missingId]) {
        const refused = await cli(['gate', '--project', id, '--agent', 'scoped', '--json']);
        assert.equal(refused.code, 3, refused.stdout + refused.stderr);
      }
      assert.equal(controls.get('scoped').calls.tasks, beforeTasks);
    },
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await Promise.all([...children].map(stop));
  await Promise.all([...controls.values()].map((control) => control.close()));
  await writeFile(
    join(artifact, 'acceptance.json'),
    JSON.stringify(
      {
        artifact,
        projectId,
        binary: command,
        source: values.source,
        checks,
        commands,
        candidateCalls: Object.fromEntries(
          [...controls].map(([mode, control]) => [mode, control.calls]),
        ),
      },
      null,
      2,
    ),
  );
  console.log(`Acceptance artifacts: ${artifact}`);
}
