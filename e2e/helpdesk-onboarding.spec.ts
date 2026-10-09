/**
 * User-visible release-check regression against a CLI-launched daemon/twin.
 * The narrow HTTP control uses public task text, inputs and live MCP responses;
 * it never imports cases, assertions, expected verdicts or reference agents.
 * This is deterministic, model-free validation, not a live LLM run.
 */
import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectNoOverflow, expectNoOffOriginRequests, watchPage } from './support/journeys.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, 'packages/cli/src/bin.ts');
let scratch: string;
let home: string;
let pairedUrl: string;
let twinUrl: string;
let agentUrl: string;
let badUrl: string;
const children = new Set<ChildProcess>();
const servers: Server[] = [];
const envelopes: Record<string, unknown>[] = [];

async function launch(args: string[], ready: RegExp): Promise<string> {
  const child = spawn(process.execPath, ['--import', 'tsx', bin, ...args], {
    cwd: root,
    env: {
      PATH: process.env['PATH'] ?? '',
      RIGORRUN_HOME: home,
      RIGORRUN_SECRET_BACKEND: 'file',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.once('close', () => children.delete(child));
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI startup timed out: ${args.join(' ')} ${errors}`));
    }, 30_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = ready.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`CLI exited ${code}: ${errors}`));
    });
  });
}

async function control(mcpUrl: string, failProbe = false): Promise<string> {
  const server = createServer((request, response) => {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const envelope = JSON.parse(body) as Record<string, unknown>;
      envelopes.push(envelope);
      if (envelope['probe']) {
        response
          .writeHead(failProbe ? 503 : 200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: !failProbe }));
        return;
      }
      const task = envelope['task'] as { inputs: Record<string, string> };
      const input = task.inputs;
      const message = input['message'] ?? '';
      let session = '';
      let rpcId = 0;
      const rpc = async (method: string, params: Record<string, unknown>, notification = false) => {
        const id = ++rpcId;
        const reply = await fetch(mcpUrl, {
          method: 'POST',
          headers: {
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            authorization: 'Bearer tok_alder_support',
            ...(session ? { 'mcp-session-id': session } : {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
        });
        session = reply.headers.get('mcp-session-id') ?? session;
        const text = await reply.text();
        if (!reply.ok) throw new Error(`MCP answered ${reply.status}`);
        if (notification) return undefined;
        const messages = reply.headers.get('content-type')?.includes('text/event-stream')
          ? text
              .split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => JSON.parse(line.slice(5)))
          : [JSON.parse(text)];
        const answer = messages.find((entry) => entry.id === id);
        if (answer?.error) throw new Error(answer.error.message);
        return answer?.result as { isError?: boolean; content?: { text?: string }[] };
      };
      await rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'onboarding-http-control', version: '1.0' },
      });
      await rpc('notifications/initialized', {}, true);
      const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
        const result = await rpc('tools/call', { name, arguments: args });
        if (result?.isError) return null;
        return JSON.parse((result?.content ?? []).map((part) => part.text ?? '').join(''));
      };
      try {
        const ref = message.match(/\b(?:ALD|BIR)-\d+\b/)?.[0];
        if (/\bdelete\b/i.test(message)) {
          await call('add_ticket_note', {
            ticket_id: input['ticket_id'],
            text: 'Deletion request for the privacy team.',
          });
        } else if (ref) {
          const result = (await call('find_orders', { ref })) as {
            orders?: Record<string, unknown>[];
          } | null;
          const order = result?.orders?.[0];
          if (order && /\brefund\b/i.test(message)) {
            await call('refund_order', {
              order_id: order['id'],
              amount_cents: Number(order['amount_cents']) - Number(order['refunded_cents']),
              reason: 'Customer request',
            });
          } else if (order && /\bemail\b/i.test(message) && /\bcopy\b/i.test(message)) {
            await call('send_email', {
              to: input['customer_email'],
              subject: `Order ${ref}`,
              body: JSON.stringify(order),
            });
          }
        }
      } finally {
        await fetch(mcpUrl, {
          method: 'DELETE',
          headers: { 'mcp-session-id': session, authorization: 'Bearer tok_alder_support' },
        });
      }
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ output: 'Scripted control finished; inspect the system evidence.' }));
    })().catch((error: unknown) => {
      response
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: String(error) }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
}

test.beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rigorrun-helpdesk-browser-'));
  home = join(scratch, 'store');
  envelopes.length = 0;
  twinUrl = await launch(['helpdesk', 'twin', '--port', '0'], /http:\/\/127\.0\.0\.1:\d+\/mcp/);
  pairedUrl = await launch(
    ['--port', '0', '--no-open'],
    /http:\/\/127\.0\.0\.1:\d+\/\?code=[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/,
  );
  agentUrl = await control(twinUrl);
  badUrl = await control(twinUrl, true);
});

test.afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise<void>((resolve) => {
          child.once('close', () => resolve());
          child.kill('SIGTERM');
        }),
    ),
  );
  // Kept outside the repo for inspecting run/state evidence and screenshots.
  console.info(`Helpdesk browser artifacts: ${scratch}`);
});

async function create(page: Page, name = 'My Helpdesk agent'): Promise<string> {
  await page.goto(page.url() === 'about:blank' ? pairedUrl : new URL('/', pairedUrl).href);
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByTestId('project-name').fill(name);
  await page
    .getByTestId('project-goal')
    .fill('Resolve customer tickets within support permissions.');
  await page.getByTestId('create-project').click();
  await page.getByTestId('workflow-helpdesk').click();
  await expect(
    page.getByRole('heading', { name: 'Helpdesk release check', exact: true }),
  ).toBeVisible();
  return page.url().split('/projects/')[1]!;
}

async function draft(page: Page): Promise<void> {
  await page.getByTestId('pack-url').fill(twinUrl);
  await expect(page.getByTestId('pack-connect')).toBeDisabled();
  await page.getByTestId('pack-safety').selectOption('ephemeral');
  await page.getByTestId('pack-connect').click();
  await expect(page.getByTestId('pack-rules')).toBeVisible();
}

async function decide(page: Page, reject = ''): Promise<void> {
  const decisions = page.locator('[data-testid^="pack-decision-"]');
  await expect(decisions).toHaveCount(6);
  for (const select of await decisions.all()) {
    const id = await select.getAttribute('data-testid');
    await select.selectOption(id === `pack-decision-${reject}` ? 'rejected' : 'confirmed');
  }
  await page.getByTestId('pack-save-rules').click();
  await expect(page.getByTestId('pack-readiness')).toContainText('Ready for the checked suite');
}

async function addAgent(page: Page, endpoint = agentUrl, name = 'My HTTP control'): Promise<void> {
  await page.getByTestId('agent-name').fill(name);
  await page.getByTestId('blackbox-endpoint').fill(endpoint);
  await page.getByTestId('add-agent').click();
}

test('Helpdesk draft, explicit review, own endpoint, evidence, reload and repeat', async ({
  page,
}) => {
  const watched = watchPage(page);
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  const id = await create(page);
  await expect(page).toHaveTitle('Project — RigorRun');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.screenshot({ path: join(scratch, 'desktop-first-viewport.png') });
  await draft(page);
  await expect(page.getByTestId('pack-save-rules')).toBeDisabled();
  await expect(page.getByTestId('pack-readiness')).toContainText('Not ready');
  expect(envelopes).toEqual([]);
  await decide(page, 'helpdesk.no_deletion');
  await expect(page.getByTestId('pack-decision-helpdesk.no_deletion')).toHaveValue('rejected');
  await addAgent(page);
  await expect(page.getByText('answering', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run My HTTP control', exact: true }).click();
  await expect(page.getByTestId('verdict')).toHaveText('YES');
  await page.getByTestId('case-own_refund').click();
  await expect(page.getByTestId('evidence-own_refund')).toContainText(
    'What Larch Helpdesk (twin) shows',
  );
  await expect(page.getByTestId('evidence-own_refund')).toContainText('refund');
  await expect(page.getByTestId('pack-history')).toContainText('My HTTP control');
  await expectNoOverflow(page);
  await page.getByTestId('verdict').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(scratch, 'desktop-evidence-viewport.png') });
  await page.addStyleTag({ content: 'header { position: static !important; }' });
  await page.screenshot({ path: join(scratch, 'desktop.png'), fullPage: true });
  for (const envelope of envelopes.filter((entry) => !entry['probe'])) {
    expect(envelope).not.toHaveProperty('checks');
    expect(envelope).not.toHaveProperty('expected');
    expect(envelope).not.toHaveProperty('referencePlan');
  }
  const project = JSON.parse(await readFile(join(home, 'projects', id, 'project.json'), 'utf8'));
  expect(project.connector).toEqual({
    kind: 'pack',
    pack: 'helpdesk',
    mode: 'twin',
    baseUrl: twinUrl,
  });
  await page.reload();
  await expect(page.getByTestId('pack-id')).toHaveText('Helpdesk · local twin');
  await expect(page.getByTestId('pack-url')).toHaveValue(twinUrl);
  await expect(page.getByTestId('pack-safety')).toHaveValue('ephemeral');
  await expect(page.getByTestId('pack-decision-helpdesk.no_deletion')).toHaveValue('rejected');
  await expect(page.getByTestId('pack-readiness')).toContainText('Ready for the checked suite');
  await expect(page.getByTestId('pack-history')).toContainText('My HTTP control');
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run My HTTP control', exact: true }).click();
  await expect(page.getByTestId('verdict')).toHaveText('YES');
  await expect(page.getByTestId('pack-history').locator('li')).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(scratch, 'mobile-first-viewport.png') });
  await page.getByTestId('verdict').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(scratch, 'mobile-evidence-viewport.png') });
  await page.addStyleTag({ content: 'header { position: static !important; }' });
  await page.screenshot({ path: join(scratch, 'mobile.png'), fullPage: true });
  expect(watched.pageErrors).toEqual([]);
  expect(watched.consoleErrors).toEqual([]);
  expect(warnings).toEqual([]);
  expectNoOffOriginRequests(watched, pairedUrl);
});

test('failed probe and pending or changed twin block run without reusing evidence', async ({
  page,
}) => {
  await create(page);
  await draft(page);
  await decide(page);
  await addAgent(page, badUrl, 'Unavailable agent');
  await expect(page.getByText('not answering', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Run Unavailable agent', exact: true }),
  ).toHaveCount(0);
  await addAgent(page);
  await page.getByRole('button', { name: 'Run My HTTP control', exact: true }).click();
  await expect(page.getByTestId('verdict')).toHaveText('YES');
  await page.getByTestId('pack-url').fill('http://127.0.0.1:1/mcp');
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await expect(page.getByTestId('pack-history')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run My HTTP control', exact: true })).toHaveCount(
    0,
  );
  await page.getByTestId('pack-connect').click();
  await expect(page.getByTestId('pack-rules')).toBeVisible();
  await expect(page.getByTestId('pack-readiness')).toContainText('Not ready');
  await expect(page.getByTestId('add-agent')).toHaveCount(0);
  await expect(page.getByTestId('verdict')).toHaveCount(0);
});

test('late readiness or probe cannot publish after URL or project switching', async ({ page }) => {
  const firstId = await create(page, 'First project');
  await draft(page);
  await decide(page);
  let releaseReady!: () => void;
  const heldReady = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });
  await page.route(`**/api/projects/${firstId}/gate-readiness`, async (route) => {
    const response = await route.fetch();
    await heldReady;
    await route.fulfill({ response });
  });
  await page.getByTestId('pack-check-readiness').click();
  await page.getByTestId('pack-url').fill('http://127.0.0.1:1/mcp');
  releaseReady();
  await expect(page.getByTestId('pack-readiness')).toHaveCount(0);
  await expect(page.getByTestId('add-agent')).toHaveCount(0);
  await page.unroute(`**/api/projects/${firstId}/gate-readiness`);
  await page.getByTestId('pack-url').fill(twinUrl);
  await expect(page.getByTestId('pack-readiness')).toHaveCount(0);
  await page.getByTestId('pack-connect').click();
  await decide(page);
  let releaseProbe!: () => void;
  const heldProbe = new Promise<void>((resolve) => {
    releaseProbe = resolve;
  });
  await page.route(`**/api/projects/${firstId}/agents`, async (route) => {
    const response = await route.fetch();
    await heldProbe;
    await route.fulfill({ response });
  });
  await addAgent(page, agentUrl, 'Late first agent');
  await page.getByRole('button', { name: 'All projects', exact: false }).click();
  const secondId = await create(page, 'Second project');
  expect(secondId).not.toBe(firstId);
  releaseProbe();
  await expect(page.getByRole('heading', { name: 'Second project', exact: true })).toBeVisible();
  await expect(page.getByText('Late first agent', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('pack-rules')).toHaveCount(0);
  await expect(page.getByTestId('verdict')).toHaveCount(0);
});

test('readiness refusal after an external suite change stops before the candidate', async ({
  page,
}) => {
  const id = await create(page);
  await draft(page);
  await decide(page);
  await addAgent(page);
  await expect(page.getByText('answering', { exact: true })).toBeVisible();
  // Simulate another operator reviewing the stored contract: the published suite
  // is invalidated by the real service, rather than a fabricated readiness answer.
  const status = await page.evaluate(async (projectId) => {
    const response = await fetch(`/api/projects/${projectId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmedRuleIds: [], rejectedRuleIds: [] }),
    });
    return response.status;
  }, id);
  expect(status).toBe(200);
  await page.getByRole('button', { name: 'Run My HTTP control', exact: true }).click();
  await expect(page.getByTestId('pack-readiness')).toContainText('Not ready');
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  expect(envelopes.filter((envelope) => !envelope['probe'])).toEqual([]);
  const project = JSON.parse(await readFile(join(home, 'projects', id, 'project.json'), 'utf8'));
  expect(project.runs).toEqual([]);
});

test('a late completed run cannot replace another project or changed URL evidence', async ({
  page,
}) => {
  const firstId = await create(page, 'First run project');
  await draft(page);
  await decide(page);
  await addAgent(page);
  await expect(page.getByText('answering', { exact: true })).toBeVisible();
  let releaseRun!: () => void;
  let runFetched!: () => void;
  const heldRun = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const fetchedRun = new Promise<void>((resolve) => {
    runFetched = resolve;
  });
  await page.route(`**/api/projects/${firstId}/runs`, async (route) => {
    const response = await route.fetch();
    runFetched();
    await heldRun;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Run My HTTP control', exact: true }).click();
  await fetchedRun;
  await page.getByTestId('pack-url').fill('http://127.0.0.1:1/mcp');
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await page.getByRole('button', { name: 'All projects', exact: false }).click();
  const secondId = await create(page, 'Second run project');
  expect(secondId).not.toBe(firstId);
  releaseRun();
  await expect(
    page.getByRole('heading', { name: 'Second run project', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await expect(page.getByTestId('pack-history')).toHaveCount(0);
  await expect(page.getByText('My HTTP control', { exact: true })).toHaveCount(0);
});
