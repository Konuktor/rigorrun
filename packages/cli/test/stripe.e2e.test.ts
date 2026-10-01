/**
 * The founder's path, end to end, with an agent RigorRun did not write.
 *
 * `stripe init --twin` → a black-box agent in another language, holding its
 * own key and talking to the twin itself → `agent add` → `gate --report`. The
 * agents are the pre-registration's scripted ones
 * (fixtures/external/stripe-scripted-agent/agent.py): the correct one must
 * pass the gate, and the one that sends whole dollars as cents must fail it,
 * with the report saying what the twin holds — a $0.25 refund on a $25.00
 * order. Needs `python3`; without it the suite says so and skips.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTwin, type RunningTwin } from '@rigorrun/env-stripe';
import { main } from '../src/main.ts';

const AGENT = fileURLToPath(
  new URL('../../../fixtures/external/stripe-scripted-agent/agent.py', import.meta.url),
);
const python = spawnSync('python3', ['--version']).status === 0;
if (!python)
  console.warn('stripe.e2e: python3 is not on PATH, so the scripted agents cannot run; skipped.');

let dir: string;
let home: string;
let twin: RunningTwin;
let projectId: string;
const agents: ChildProcess[] = [];

async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  try {
    return { code: await main([...args, '--home', home]), out, err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Starts one scripted agent with its own key, and waits until it answers. */
async function scriptedAgent(behaviour: string): Promise<string> {
  const port = await freePort();
  const child = spawn(
    'python3',
    [
      AGENT,
      '--port',
      String(port),
      '--behaviour',
      behaviour,
      '--trace',
      join(dir, `${behaviour}.jsonl`),
    ],
    {
      env: {
        PATH: process.env['PATH'] ?? '',
        PYTHONDONTWRITEBYTECODE: '1',
        STRIPE_BASE_URL: twin.url,
        STRIPE_KEY: 'sk_test_twin',
      },
      stdio: 'ignore',
    },
  );
  agents.push(child);
  const url = `http://127.0.0.1:${port}/`;
  for (let tries = 0; tries < 100; tries += 1) {
    const answered = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ protocol: 'rigorrun/task/1', probe: true }),
    }).catch(() => undefined);
    if (answered?.ok) return url;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the ${behaviour} agent did not start`);
}

beforeAll(async () => {
  if (!python) return;
  dir = await mkdtemp(join(tmpdir(), 'rigorrun-stripe-e2e-'));
  home = join(dir, 'home');
  twin = await startTwin({ port: 0, disputeDelayMs: 100 });
  const init = await cli(
    'stripe',
    'init',
    '--twin',
    twin.url,
    '--yes',
    '--dir',
    join(dir, 'ticket'),
    '--json',
  );
  expect(init.code, init.err).toBe(0);
  projectId = (JSON.parse(init.out) as { projectId: string }).projectId;
  for (const behaviour of ['correct', 'units']) {
    const url = await scriptedAgent(behaviour);
    const added = await cli(
      'agent',
      'add',
      '--project',
      projectId,
      '--name',
      behaviour,
      '--black-box',
      url,
      '--claim-path',
      'message',
    );
    expect(added.code, added.out + added.err).toBe(0);
  }
}, 60_000);

afterAll(async () => {
  for (const child of agents) child.kill();
  await twin?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!python)(
  'stripe init → agent add → gate, with an agent RigorRun did not write',
  () => {
    it('passes the gate for the correct agent', async () => {
      const report = join(dir, 'correct.html');
      const { code, out } = await cli(
        'gate',
        '--project',
        projectId,
        '--agent',
        'correct',
        '--report',
        report,
      );
      expect(code, out).toBe(0);
      expect(out).toContain('PASS');
      expect(out).toContain('PARTIAL');
    }, 120_000);

    it('fails the gate for the agent that sends whole dollars, and the report shows the $0.25 refund', async () => {
      const report = join(dir, 'units.html');
      const { code, out } = await cli(
        'gate',
        '--project',
        projectId,
        '--agent',
        'units',
        '--report',
        report,
      );
      expect(code, out).toBe(1);
      const html = await readFile(report, 'utf8');
      // full_refund: $25.00 asked, 25 sent as minor units.
      expect(html).toMatch(/Refund re_\w+ of \$0\.25 on ch_\w+ \(a \$25\.00 charge\)/);
    }, 120_000);

    it('runs the canary alone', async () => {
      const { code, out } = await cli(
        'stripe',
        'canary',
        '--project',
        projectId,
        '--agent',
        'correct',
      );
      expect(code, out).toBe(0);
      expect(out).toContain('Canary · correct · PASS');
      expect(out).toMatch(/The Stripe twin shows\s+Refund re_\w+ of \$1\.00/);
      const units = await cli('stripe', 'canary', '--project', projectId, '--agent', 'units');
      expect(units.code).toBe(1);
      expect(units.out).toMatch(/of \$0\.01 on ch_\w+ \(a \$1\.00 charge\)/);
    }, 60_000);
  },
);
