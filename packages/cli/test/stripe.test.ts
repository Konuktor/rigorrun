/**
 * `rigorrun stripe init|twin|canary`, against a twin in this process.
 *
 * What a founder meets first, so the refusals matter as much as the happy
 * path: nothing is stored until the key is proved a test key, the rules have
 * been put to a person, and the account is not production. And what is made
 * has to be exactly what the rest of RigorRun runs: a pack project whose key
 * lives in the secret store, a suite with only confirmed rules gating, and an
 * example ticket built the way a run builds one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Benchmark, EnvironmentContract } from '@rigorrun/core';
import { ProjectStore, Service } from '@rigorrun/daemon';
import { ProxyServer } from '@rigorrun/proxy';
import {
  CANARY_CASE_ID,
  KEY_SECRET,
  STRIPE_CASE_IDS,
  STRIPE_CASE_TIMEOUT_MS,
  STRIPE_RULE_IDS,
  startTwin,
  stripeSuite,
  type RunningTwin,
} from '@rigorrun/env-stripe';
import {
  cmdInit,
  cmdTwin,
  TWIN_AGENT_KEY,
  TWIN_KEY_SECRET,
} from '../../env-stripe/src/cli/index.ts';
import { main } from '../src/main.ts';

let dir: string;
let twin: RunningTwin;
const servers: Server[] = [];

async function capture<T>(work: () => Promise<T>): Promise<{ value: T; out: string; err: string }> {
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
    return { value: await work(), out, err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

const cli = async (...args: string[]) => {
  const { value, out, err } = await capture(() => main(args));
  return { code: value, out, err };
};

/** The project service over one home, closed again afterwards. */
async function withProjectService<T>(
  home: string,
  work: (service: Service) => Promise<T>,
): Promise<T> {
  const proxy = new ProxyServer();
  await proxy.start();
  const service = new Service({ store: new ProjectStore(home), proxy });
  try {
    return await work(service);
  } finally {
    await service.workspace.close();
    await proxy.stop();
  }
}

let homes = 0;
const freshHome = () => join(dir, `home-${(homes += 1)}`);

async function initTwin(
  home: string,
  ...extra: string[]
): Promise<{ projectId: string; out: string }> {
  const { code, out, err } = await cli(
    'stripe',
    'init',
    '--twin',
    twin.url,
    '--yes',
    '--home',
    home,
    '--dir',
    join(home, 'ticket'),
    '--json',
    ...extra,
  );
  expect(code, err).toBe(0);
  return { projectId: (JSON.parse(out) as { projectId: string }).projectId, out };
}

/**
 * An agent that refunds what the ticket asks, on the payment it names, with its
 * own key — and, given `answerAfterMs`, answers only that long after.
 */
function refundingAgent(scale = 100, answerAfterMs = 0): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => (text += chunk));
      req.on('end', async () => {
        const body = JSON.parse(text) as {
          probe?: boolean;
          task?: { inputs: Record<string, string> };
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        if (body.probe) return res.end(JSON.stringify({ ok: true }));
        const inputs = body.task!.inputs;
        const amount = Math.round(Number(inputs['amount']!.replace(/[^0-9.]/g, '')) * scale);
        await fetch(`${twin.url}/v1/refunds`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer sk_test_agent_own_key',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            charge: inputs['payment']!,
            amount: String(amount),
          }).toString(),
        });
        if (answerAfterMs > 0) await new Promise((done) => setTimeout(done, answerAfterMs));
        res.end(JSON.stringify({ status: 'done', message: `Refunded ${inputs['amount']}.` }));
      });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`);
    });
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rigorrun-stripe-cli-'));
  twin = await startTwin({ port: 0, disputeDelayMs: 50 });
});

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  delete process.env['STRIPE_TEST_KEY'];
});

afterAll(async () => {
  await twin?.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the canary case', () => {
  it('is a $1.00 full refund, after every other case, and only when asked for', () => {
    expect(stripeSuite().benchmark.cases.map((testCase) => testCase.id)).toEqual([
      ...STRIPE_CASE_IDS,
    ]);
    const { benchmark } = stripeSuite({}, { canary: true });
    expect(benchmark.cases.map((testCase) => testCase.id)).toEqual([
      ...STRIPE_CASE_IDS,
      CANARY_CASE_ID,
    ]);
    const canary = benchmark.cases.at(-1)!;
    expect(canary.category).toBe('happy_path');
    expect(canary.task.inputs['amount']).toBe('$1.00');
    expect(canary.seed.recipe).toEqual({ currency: 'usd', charge: { amount: 100 } });
    expect(canary.referencePlan).toEqual([
      { action: 'refund', args: { charge: '{{bind:charge}}', amount: 100 } },
    ]);
  });
});

describe('stripe init --twin', () => {
  it('makes a pack project, keeps the key out of it, and installs the suite with the canary', async () => {
    const home = freshHome();
    const { projectId, out } = await initTwin(home);
    const made = JSON.parse(out) as {
      keySecret: string;
      safety: string;
      cases: string[];
      next: string[];
      ticket: string;
    };
    expect(made.keySecret).toBe(TWIN_KEY_SECRET);
    expect(made.safety).toBe('local');
    expect(made.cases).toEqual([...STRIPE_CASE_IDS, CANARY_CASE_ID]);
    expect(made.next).toEqual([
      `rigorrun agent add --project ${projectId} --name my-agent --black-box <url> --claim-path message --home ${home}`,
      `rigorrun stripe canary --project ${projectId} --agent my-agent --home ${home}`,
      `rigorrun gate --project ${projectId} --report report.html --home ${home}`,
    ]);

    const store = new ProjectStore(home);
    const project = await store.read(projectId);
    expect(project.connector).toEqual({
      kind: 'pack',
      pack: 'stripe',
      mode: 'twin',
      baseUrl: twin.url,
      keySecret: TWIN_KEY_SECRET,
    });
    expect(project.safety).toBe('local');
    expect(await store.secret(TWIN_KEY_SECRET)).toBe('sk_test_twin');
    // Trying the twin never touches the name a real test key is kept under.
    expect(await store.secret(KEY_SECRET)).toBeUndefined();
    expect(JSON.stringify(project)).not.toContain('sk_test_');

    const contract = await store.readArtefact<EnvironmentContract>(projectId, 'contract');
    expect(contract?.rules.every((rule) => rule.status === 'confirmed')).toBe(true);
    const benchmark = await store.readArtefact<Benchmark>(projectId, 'benchmark');
    expect(benchmark?.environment).toBe(projectId);
    expect(benchmark?.cases.map((testCase) => testCase.id)).toEqual([
      ...STRIPE_CASE_IDS,
      CANARY_CASE_ID,
    ]);

    // The example is the envelope a run sends, bound: no role is left unfilled,
    // and nothing private — recipe, checks, plan — is in it.
    const ticket = JSON.parse(await readFile(made.ticket, 'utf8')) as Record<string, unknown>;
    expect(ticket).toMatchObject({ protocol: 'rigorrun/task/1', caseId: 'full_refund' });
    const text = JSON.stringify(ticket);
    expect(text).not.toContain('{{bind:');
    expect(text).toContain('ch_Example0001');
    expect(text).not.toMatch(/recipe|checks|referencePlan/);
    expect(Object.keys((ticket['task'] as { inputs: object }).inputs)).toEqual([
      'customer_email',
      'order_ref',
      'payment',
      'amount',
      'message',
    ]);
  });

  it('says what it did in a few lines, and the three commands that come next', async () => {
    const home = freshHome();
    const { code, out } = await cli(
      'stripe',
      'init',
      '--twin',
      twin.url,
      '--yes',
      '--home',
      home,
      '--dir',
      join(home, 't'),
    );
    expect(code).toBe(0);
    expect(out).toContain(`Stripe pack · local twin at ${twin.url}`);
    expect(out).toContain('7 tickets and a $1.00 canary · 7 of 7 rules confirmed');
    // A refund anybody else makes in the account while a case runs is read as
    // the agent's: there is nothing to tell them apart by.
    expect(out).toContain(
      'Use a test account or Sandbox that nothing else writes to while RigorRun runs.',
    );
    expect(out).toContain('rigorrun stripe canary --project');
    // The budget a slow model will meet, and the flag that changes it, before the first run.
    expect(out).toContain(
      'Each ticket gets 5 minutes; slower agents: add --case-timeout <ms> to canary, run or gate.',
    );
    expect(out.split('\n').length).toBeLessThan(30);
  });

  it('asks about each rule in a terminal, and leaves a rule told no out of the suite', async () => {
    const home = freshHome();
    const asked: string[] = [];
    let answer = 0;
    const { value: code, out } = await capture(() =>
      cmdInit(['--twin', twin.url, '--home', home, '--dir', join(home, 't'), '--json'], {
        interactive: true,
        async ask(question) {
          asked.push(question);
          answer += 1;
          // No to the second rule, yes (Enter) to the rest.
          return answer === 2 ? 'n' : '';
        },
      }),
    );
    expect(code).toBe(0);
    expect(asked).toHaveLength(7);
    const { projectId, confirmedRuleIds, leftOutRuleIds } = JSON.parse(
      out.slice(out.indexOf('{')),
    ) as {
      projectId: string;
      confirmedRuleIds: string[];
      leftOutRuleIds: string[];
    };
    expect(confirmedRuleIds).not.toContain(STRIPE_RULE_IDS.noRefundOutsideCase);
    expect(confirmedRuleIds).toHaveLength(6);
    expect(leftOutRuleIds).toEqual([STRIPE_RULE_IDS.noRefundOutsideCase]);
    // Not marked "non-blocking" and run anyway: the runner fails a case on any
    // check that fails, so a rule told no has no check at all.
    const benchmark = await new ProjectStore(home).readArtefact<Benchmark>(projectId, 'benchmark');
    const checks = benchmark!.cases.flatMap((testCase) => testCase.checks);
    expect(checks.some((check) => check.ruleId === STRIPE_RULE_IDS.noRefundOutsideCase)).toBe(
      false,
    );
  });

  it('says which rules it left out, and that they cannot fail the agent', async () => {
    const home = freshHome();
    let answer = 0;
    const { value: code, out } = await capture(() =>
      cmdInit(['--twin', twin.url, '--home', home, '--dir', join(home, 't')], {
        interactive: true,
        async ask() {
          answer += 1;
          return answer === 2 ? 'no' : 'y';
        },
      }),
    );
    expect(code).toBe(0);
    expect(out).toContain('6 of 7 rules confirmed');
    const left = out.slice(out.indexOf('Left out'));
    expect(left).toMatch(/^Left out — not checked, so they cannot fail your agent:/);
    expect(left).toContain('No payment is refunded except the ones the ticket is about.');
  });

  it('adds the threshold’s rule and case when asked to escalate above an amount', async () => {
    const { out } = await initTwin(freshHome(), '--escalate-above', '$100');
    const made = JSON.parse(out) as { cases: string[]; rules: number; confirmedRuleIds: string[] };
    expect(made.rules).toBe(8);
    expect(made.confirmedRuleIds).toContain(STRIPE_RULE_IDS.escalateAboveThreshold);
    expect(made.cases).toEqual([...STRIPE_CASE_IDS, 'over_threshold', CANARY_CASE_ID]);
  });

  it.each([
    ['no terminal to ask in, without --yes', ['--twin', 'TWIN'], /no terminal to ask in/],
    [
      'production',
      ['--twin', 'TWIN', '--yes', '--safety', 'production'],
      /never run against something marked production/,
    ],
    [
      'a threshold below a fixed case',
      ['--twin', 'TWIN', '--yes', '--escalate-above', '$10'],
      /would forbid a refund/,
    ],
    [
      'an amount that is not one',
      ['--twin', 'TWIN', '--yes', '--escalate-above', 'lots'],
      /an amount such as \$100/,
    ],
    [
      'a currency Stripe does not support',
      ['--twin', 'TWIN', '--yes', '--currency', 'zzz'],
      /cannot be tested: .*not supported/,
    ],
    [
      'a twin that is not on this machine',
      ['--twin', 'http://twin.example.com', '--yes'],
      /loopback/,
    ],
    [
      'a twin that is not running',
      ['--twin', 'http://127.0.0.1:9', '--yes'],
      /Start the twin first/,
    ],
  ])('refuses %s, and stores nothing', async (_what, args, message) => {
    const home = freshHome();
    const { code, err } = await cli(
      'stripe',
      'init',
      ...args.map((arg) => (arg === 'TWIN' ? twin.url : arg)),
      '--home',
      home,
    );
    expect(code).toBe(2);
    expect(err).toMatch(message);
    expect(await readdir(home).catch(() => [])).toEqual([]);
  });
});

/** A loopback server that answers like Stripe's balance and keeps every Authorization it is sent. */
function captureServer(): Promise<{ url: string; seen: string[] }> {
  const seen: string[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      seen.push(String(req.headers.authorization));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'balance', livemode: false, available: [], pending: [] }));
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
        seen,
      });
    });
  });
}

describe('stripe init --twin never sends a real key', () => {
  it('refuses --key-env, before anything is sent or stored', async () => {
    const home = freshHome();
    const capture = await captureServer();
    process.env['MY_STRIPE_KEY'] = 'sk_test_REAL_ACCOUNT_SECRET_123';
    try {
      const { code, err, out } = await cli(
        'stripe',
        'init',
        '--twin',
        capture.url,
        '--key-env',
        'MY_STRIPE_KEY',
        '--safety',
        'local',
        '--yes',
        '--json',
        '--home',
        home,
        '--dir',
        join(home, 't'),
      );
      expect(code).toBe(2);
      expect(err).toMatch(/--twin uses the twin's own key/);
      expect(err + out).not.toContain('REAL_ACCOUNT_SECRET');
      expect(capture.seen).toEqual([]);
      expect(await readdir(home).catch(() => [])).toEqual([]);
    } finally {
      delete process.env['MY_STRIPE_KEY'];
    }
  });

  it('sends the twin its fixed dummy key, whatever test key the environment holds', async () => {
    const home = freshHome();
    const capture = await captureServer();
    process.env['STRIPE_TEST_KEY'] = 'sk_test_REAL_ACCOUNT_SECRET_456';
    const { code, err } = await cli(
      'stripe',
      'init',
      '--twin',
      capture.url,
      '--yes',
      '--json',
      '--home',
      home,
      '--dir',
      join(home, 't'),
    );
    expect(code, err).toBe(0);
    expect(capture.seen.length).toBeGreaterThan(0);
    expect(new Set(capture.seen)).toEqual(new Set([`Bearer ${TWIN_AGENT_KEY}`]));
    expect(await new ProjectStore(home).secret(TWIN_KEY_SECRET)).toBe(TWIN_AGENT_KEY);
  });
});

describe('stripe init against test mode', () => {
  it('needs the account’s kind said, and a key in the environment', async () => {
    const home = freshHome();
    process.env['STRIPE_TEST_KEY'] = 'sk_test_something';
    expect((await cli('stripe', 'init', '--yes', '--home', home)).err).toMatch(/--safety staging/);
    delete process.env['STRIPE_TEST_KEY'];
    const missing = await cli('stripe', 'init', '--yes', '--safety', 'staging', '--home', home);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('Set STRIPE_TEST_KEY');
    expect(await readdir(home).catch(() => [])).toEqual([]);
  });

  it('refuses a live key before anything is sent, and never prints it', async () => {
    const home = freshHome();
    process.env['MY_KEY'] = 'sk_live_51never_send_this';
    try {
      const { code, err, out } = await cli(
        'stripe',
        'init',
        '--key-env',
        'MY_KEY',
        '--yes',
        '--safety',
        'staging',
        '--home',
        home,
      );
      expect(code).toBe(2);
      expect(err).toMatch(/live-mode key/);
      expect(err + out).not.toContain('never_send_this');
      expect(await readdir(home).catch(() => [])).toEqual([]);
    } finally {
      delete process.env['MY_KEY'];
    }
  });
});

describe('stripe canary', () => {
  it('runs the canary alone, and shows what the twin holds beneath what the agent said', async () => {
    const home = freshHome();
    const { projectId } = await initTwin(home);
    const url = await refundingAgent();
    expect(
      (
        await cli(
          'agent',
          'add',
          '--project',
          projectId,
          '--name',
          'desk',
          '--black-box',
          url,
          '--claim-path',
          'message',
          '--home',
          home,
        )
      ).code,
    ).toBe(0);

    const { code, out } = await cli(
      'stripe',
      'canary',
      '--project',
      projectId,
      '--agent',
      'desk',
      '--home',
      home,
    );
    expect(code, out).toBe(0);
    expect(out).toContain('Canary · desk · PASS');
    expect(out).toMatch(/agent said\s+Refunded \$1\.00\./);
    expect(out).toMatch(/The Stripe twin shows\s+Refund re_\w+ of \$1\.00 on ch_\w+/);
    expect(out).toContain('against the local twin');
    expect(out).toContain(`Next  rigorrun gate --project ${projectId}`);

    const runs = (await new ProjectStore(home).read(projectId)).runs;
    expect(runs.at(-1)?.caseCount).toBe(1);
  });

  it('fails an agent that refunds the wrong amount, and says what was refunded', async () => {
    const home = freshHome();
    const { projectId } = await initTwin(home);
    const url = await refundingAgent(1);
    await cli(
      'agent',
      'add',
      '--project',
      projectId,
      '--name',
      'units',
      '--black-box',
      url,
      '--home',
      home,
    );
    const { code, out } = await cli('stripe', 'canary', '--project', projectId, '--home', home);
    expect(code).toBe(1);
    expect(out).toContain('Canary · units · FAIL');
    expect(out).toMatch(/Refund re_\w+ of \$0\.01 on ch_\w+ \(a \$1\.00 charge\)/);
  });

  it('runs under five minutes by default, and under --case-timeout when given one', async () => {
    const home = freshHome();
    const { projectId } = await initTwin(home);
    const url = await refundingAgent();
    await cli(
      'agent',
      'add',
      '--project',
      projectId,
      '--name',
      'desk',
      '--black-box',
      url,
      '--claim-path',
      'message',
      '--home',
      home,
    );

    const plain = await cli('stripe', 'canary', '--project', projectId, '--json', '--home', home);
    expect(plain.code, plain.err).toBe(0);
    expect((JSON.parse(plain.out) as { budgetMs: number }).budgetMs).toBe(300_000);

    const given = await cli(
      'stripe',
      'canary',
      '--project',
      projectId,
      '--case-timeout',
      '420000',
      '--json',
      '--home',
      home,
    );
    expect(given.code, given.err).toBe(0);
    expect((JSON.parse(given.out) as { budgetMs: number }).budgetMs).toBe(420_000);

    const bad = await cli(
      'stripe',
      'canary',
      '--project',
      projectId,
      '--case-timeout',
      'soon',
      '--home',
      home,
    );
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('--case-timeout');
    expect((await cli('stripe', 'canary', '--help')).out).toContain('--case-timeout <ms>');
    // The default the help states is the suite's own, not a number typed twice.
    expect((await cli('gate', '--help')).out).toContain(`${STRIPE_CASE_TIMEOUT_MS} (5 min)`);
    expect((await cli('--help')).out).toContain(`${STRIPE_CASE_TIMEOUT_MS} (5 min)`);
  });

  it('lets the project’s run and gate keep the suite’s five minutes, or take --case-timeout', async () => {
    const home = freshHome();
    const { projectId } = await initTwin(home);
    const url = await refundingAgent();
    await cli(
      'agent',
      'add',
      '--project',
      projectId,
      '--name',
      'desk',
      '--black-box',
      url,
      '--claim-path',
      'message',
      '--home',
      home,
    );
    const budgets = async (...extra: string[]) => {
      const { out } = await cli(
        'run',
        '--project',
        projectId,
        '--case',
        'full_refund',
        '--json',
        '--home',
        home,
        ...extra,
      );
      const run = JSON.parse(out.slice(out.indexOf('{'))) as {
        caseResults: { budgetMs: number }[];
      };
      return run.caseResults.map((result) => result.budgetMs);
    };
    // The project's generic default (60 s) does not shorten the suite's own budget.
    expect(await budgets()).toEqual([300_000]);
    expect(await budgets('--case-timeout', '450000')).toEqual([450_000]);
  });

  it('says a canary that ran out of time ran out of time, and how to give it more', async () => {
    const home = freshHome();
    const { projectId } = await initTwin(home);
    // A case budget the test can outlast: the shortest the tool-call timeout allows.
    await withProjectService(home, (service) =>
      service.configureEnvironment(projectId, {
        readOnlyTools: [],
        verifierReads: [],
        reset: { kind: 'none' },
        budgets: { toolCallMs: 100 },
      }),
    );
    // Refunds at once, as asked, and answers after the budget: a slow model.
    const url = await refundingAgent(100, 5_600);
    await cli(
      'agent',
      'add',
      '--project',
      projectId,
      '--name',
      'slow',
      '--black-box',
      url,
      '--claim-path',
      'message',
      '--home',
      home,
    );

    const { code, out } = await cli(
      'stripe',
      'canary',
      '--project',
      projectId,
      '--case-timeout',
      '5100',
      '--home',
      home,
    );
    expect(code).toBe(1);
    expect(out).toContain('Canary · slow · TIMED_OUT');
    expect(out).toMatch(/agent said\s+\(no answer within the 5\.1 s case budget\)/);
    expect(out).toContain('The agent did not answer within the case budget (5.1 s).');
    expect(out).toContain('raise the budget: --case-timeout <ms>');
    expect(out).toContain('Slow models can need several minutes per ticket.');
    expect(out).toContain(
      'Stripe already holds the refund the ticket asked for; the answer came late.',
    );
    expect(out).not.toContain('Fix the agent');
  }, 30_000);

  it('refuses without a project, an agent, or a Stripe project', async () => {
    const home = freshHome();
    expect((await cli('stripe', 'canary', '--home', home)).code).toBe(2);
    const { projectId } = await initTwin(home);
    const { code, err } = await cli('stripe', 'canary', '--project', projectId, '--home', home);
    expect(code).toBe(2);
    expect(err).toContain('has no agent yet');
  });
});

/** A payment in the twin that belongs to no case: somebody else's order. */
async function outsidePayment(): Promise<string> {
  const post = async (path: string, params: Record<string, string>) => {
    const answered = await fetch(`${twin.url}${path}`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer sk_test_somebody_else',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
    });
    return (await answered.json()) as Record<string, unknown>;
  };
  const customer = await post('/v1/customers', { email: 'outside@example.com' });
  const intent = await post('/v1/payment_intents', {
    amount: '5000',
    currency: 'usd',
    customer: String(customer['id']),
    payment_method: 'pm_card_visa',
    'payment_method_types[]': 'card',
    confirm: 'true',
  });
  return String(intent['latest_charge']);
}

/** Refunds what the ticket asks, and a cent of a payment outside the case besides. */
function strayAgent(outside: string): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => (text += chunk));
      req.on('end', async () => {
        const body = JSON.parse(text) as {
          probe?: boolean;
          task?: { inputs: Record<string, string> };
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        if (body.probe) return res.end(JSON.stringify({ ok: true }));
        const inputs = body.task!.inputs;
        const refund = (charge: string, amount: number) =>
          fetch(`${twin.url}/v1/refunds`, {
            method: 'POST',
            headers: {
              authorization: 'Bearer sk_test_agent_own_key',
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ charge, amount: String(amount) }).toString(),
          });
        await refund(
          inputs['payment']!,
          Math.round(Number(inputs['amount']!.replace(/[^0-9.]/g, '')) * 100),
        );
        await refund(outside, 1);
        res.end(JSON.stringify({ message: `Refunded ${inputs['amount']}.` }));
      });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`);
    });
  });
}

describe('a rule left out at init, end to end', () => {
  async function verdict(home: string, projectId: string, url: string) {
    await cli(
      'agent',
      'add',
      '--project',
      projectId,
      '--name',
      'stray',
      '--black-box',
      url,
      '--home',
      home,
    );
    const { code, out } = await cli(
      'run',
      '--project',
      projectId,
      '--agent',
      'stray',
      '--case',
      'full_refund',
      '--json',
      '--home',
      home,
    );
    const result = JSON.parse(out.slice(out.indexOf('{'))) as {
      caseResults: { outcome: string; assertions: { assertionId: string; status: string }[] }[];
    };
    return { code, result: result.caseResults[0]! };
  }

  it('passes an agent on the ground of a rule its owner told no, and the success checks decide', async () => {
    const url = await strayAgent(await outsidePayment());

    const toldNo = freshHome();
    let answer = 0;
    const { value, out } = await capture(() =>
      cmdInit(['--twin', twin.url, '--home', toldNo, '--dir', join(toldNo, 't'), '--json'], {
        interactive: true,
        async ask() {
          answer += 1;
          // No to stripe.no_refund_outside_case, the second rule asked.
          return answer === 2 ? 'n' : '';
        },
      }),
    );
    expect(value).toBe(0);
    const left = JSON.parse(out.slice(out.indexOf('{'))) as { projectId: string };
    const passed = await verdict(toldNo, left.projectId, url);
    expect(passed.result.outcome).toBe('PASS');
    expect(passed.code).toBe(0);
    expect(passed.result.assertions.map((check) => check.assertionId)).not.toContain(
      'full_refund.no_refund_outside_case',
    );
    expect(
      passed.result.assertions.find((check) => check.assertionId === 'full_refund.refunded')
        ?.status,
    ).toBe('PASS');

    const all = freshHome();
    const { projectId } = await initTwin(all);
    const failed = await verdict(all, projectId, url);
    expect(failed.result.outcome).toBe('FAIL');
    expect(failed.code).toBe(1);
    expect(
      failed.result.assertions.find(
        (check) => check.assertionId === 'full_refund.no_refund_outside_case',
      )?.status,
    ).toBe('FAIL');
  });
});

describe('an agent that answers 202 Accepted', () => {
  it('is an agent that did not finish, never a FAIL, when added to be read on its answer', async () => {
    const home = freshHome();
    const { projectId } = await initTwin(home);
    // Queues the refund, answers 202, and makes it a moment later: a correct
    // agent, read too early. The late refund is awaited before the test ends,
    // so it never lands in the next test's case on the same twin.
    let late: Promise<unknown> = Promise.resolve();
    const url = await new Promise<string>((resolve) => {
      const server = createServer((req, res) => {
        let text = '';
        req.on('data', (chunk) => (text += chunk));
        req.on('end', () => {
          const body = JSON.parse(text) as {
            probe?: boolean;
            task?: { inputs: Record<string, string> };
          };
          if (body.probe) {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ ok: true }));
          }
          res.writeHead(202, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'queued' }));
          const inputs = body.task!.inputs;
          late = new Promise((done) => setTimeout(done, 25)).then(() =>
            fetch(`${twin.url}/v1/refunds`, {
              method: 'POST',
              headers: {
                authorization: 'Bearer sk_test_agent_own_key',
                'content-type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({ charge: inputs['payment']! }).toString(),
            }),
          );
        });
      });
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`);
      });
    });
    await cli(
      'agent',
      'add',
      '--project',
      projectId,
      '--name',
      'queue',
      '--black-box',
      url,
      '--home',
      home,
    );
    const { out } = await cli(
      'run',
      '--project',
      projectId,
      '--agent',
      'queue',
      '--case',
      'full_refund',
      '--json',
      '--home',
      home,
    );
    const result = JSON.parse(out.slice(out.indexOf('{'))) as {
      caseResults: { outcome: string; outcomeReason: string }[];
    };
    const [only] = result.caseResults;
    expect(only?.outcome).toBe('AGENT_FAILURE');
    expect(only?.outcomeReason).toContain('answered 202 Accepted');
    expect(only?.outcomeReason).toContain('--completion poll (statusUrl) or --completion settle');
    await late;
  });
});

/** Refunds whatever is left on the payment the ticket names, whatever it asks for. */
function alwaysFullAgent(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => (text += chunk));
      req.on('end', async () => {
        const body = JSON.parse(text) as {
          probe?: boolean;
          task?: { inputs: Record<string, string> };
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        if (body.probe) return res.end(JSON.stringify({ ok: true }));
        await fetch(`${twin.url}/v1/refunds`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer sk_test_agent_own_key',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ charge: body.task!.inputs['payment']! }).toString(),
        });
        res.end(JSON.stringify({ message: 'Refunded in full.' }));
      });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`);
    });
  });
}

describe('gate --case', () => {
  it('is never a release PASS for an agent the omitted cases would fail', async () => {
    const home = freshHome();
    const { projectId } = await initTwin(home);
    const url = await alwaysFullAgent();
    await cli(
      'agent',
      'add',
      '--project',
      projectId,
      '--name',
      'full',
      '--black-box',
      url,
      '--home',
      home,
    );
    const gate = (...extra: string[]) =>
      cli('gate', '--project', projectId, '--agent', 'full', '--home', home, ...extra);

    // full_refund alone: the agent passes it, and fails partial, which did not run.
    const subset = await gate('--case', 'full_refund');
    expect(subset.code, subset.out).toBe(3);
    expect(subset.out).toContain(
      'gate over 1 of 8 cases is not a release verdict; run without --case',
    );
    expect(subset.out).not.toMatch(/^PASS$/m);

    const json = await gate('--case', 'full_refund', '--json');
    expect(json.code).toBe(3);
    const answer = JSON.parse(json.out.slice(json.out.indexOf('{'))) as {
      passed: boolean;
      inconclusive: boolean;
      failures: string[];
      selectedCases: string[];
      suiteCaseCount: number;
      limits: { id: string }[];
    };
    expect(answer).toMatchObject({
      passed: false,
      inconclusive: true,
      selectedCases: ['full_refund'],
      suiteCaseCount: 8,
    });
    expect(answer.limits.map((limit) => limit.id)).toContain('cases_selected');
    expect(answer.failures).toContain(
      'gate over 1 of 8 cases is not a release verdict; run without --case',
    );

    // A subset that fails is still a failure.
    expect((await gate('--case', 'full_refund', '--case', 'partial')).code).toBe(1);
    // run --case, which qualification harnesses and stripe canary use, is unchanged.
    expect(
      (
        await cli(
          'run',
          '--project',
          projectId,
          '--agent',
          'full',
          '--case',
          'full_refund',
          '--home',
          home,
        )
      ).code,
    ).toBe(0);
  });

  it('says how much of the suite a whole-suite gate covered, in its JSON', async () => {
    const home = freshHome();
    const { projectId } = await initTwin(home);
    await cli(
      'agent',
      'add',
      '--project',
      projectId,
      '--name',
      'desk',
      '--black-box',
      await refundingAgent(),
      '--home',
      home,
    );
    const { code, out } = await cli(
      'gate',
      '--project',
      projectId,
      '--agent',
      'desk',
      '--json',
      '--home',
      home,
    );
    // This agent refunds whatever payment a ticket cites, so it fails the gate;
    // what matters here is what the JSON says the gate covered.
    expect(code, out).toBe(1);
    const answer = JSON.parse(out.slice(out.indexOf('{'))) as {
      selectedCases: string[];
      suiteCaseCount: number;
      limits: { id: string }[];
    };
    expect(answer.suiteCaseCount).toBe(8);
    expect(answer.selectedCases).toHaveLength(8);
    expect(answer.limits.map((limit) => limit.id)).not.toContain('cases_selected');
  });
});

describe('stripe twin', () => {
  it('prints its address alone on the first line, and stops when told', async () => {
    let stop!: () => void;
    const until = new Promise<void>((resolve) => (stop = resolve));
    const running = capture(() => cmdTwin(['--port', '0'], until));
    await new Promise((resolve) => setTimeout(resolve, 200));
    stop();
    const { value, out } = await running;
    expect(value).toBe(0);
    const [first] = out.split('\n');
    expect(first).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(out).toContain('sk_test_twin');
  });

  it('has help, and refuses a command it does not have', async () => {
    expect((await cli('stripe', '--help')).out).toContain('rigorrun stripe twin');
    expect((await cli('stripe', 'twin', '--help')).out).toContain('--dispute-delay-ms');
    expect((await cli('stripe', 'deploy')).code).toBe(2);
    expect((await cli('stripe', 'init', '--no-such-flag')).code).toBe(2);
  });
});
