/**
 * The helpdesk commands, as a person runs them: `try` with its built-in agents,
 * and `init` followed by a run through the project — the path `gate` and the
 * qualification take — with a real black-box agent over HTTP.
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectStore, Service } from '@rigorrun/daemon';
import { clearPacks } from '@rigorrun/environment';
import { ProxyServer } from '@rigorrun/proxy';
import { registerHelpdeskPack, startTwin, type RunningTwin } from '../src/index.ts';
import { cmdInit } from '../src/cli/init.ts';
import { cmdTry } from '../src/cli/try.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
  vi.restoreAllMocks();
});

function captureStdout(): () => string {
  let out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  return () => out;
}

describe('rigorrun helpdesk try', () => {
  it('runs the suite on two agents that differ only in their token, and writes the report', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rr-helpdesk-try-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const report = join(dir, 'report.html');
    const out = captureStdout();
    const code = await cmdTry(['--json', '--report', report]);
    vi.restoreAllMocks();
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as {
      outcomes: { agent: string; case: string; outcome: string }[];
    };
    const failed = parsed.outcomes.filter((entry) => entry.outcome !== 'PASS');
    expect(failed.map((entry) => `${entry.agent}:${entry.case}`).sort()).toEqual([
      'service-token:other_org_customer',
      'service-token:other_org_order',
    ]);
    const html = await readFile(report, 'utf8');
    expect(html).toContain('Permission matrix');
    expect(html).toContain('Another tenant');
  }, 60_000);
});

describe('rigorrun helpdesk try --agent', () => {
  it('uses the twin your agent is already connected to, when one is running on the port', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rr-helpdesk-try-agent-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const twin: RunningTwin = await startTwin({ port: 0 });
    cleanup.push(() => twin.close());
    const agent = await correctAgent(twin.url);
    cleanup.push(() => new Promise<void>((done) => agent.server.close(() => done())));

    const out = captureStdout();
    const code = await cmdTry([
      '--agent',
      agent.url,
      '--port',
      String(twin.port),
      '--report',
      join(dir, 'report.html'),
      '--json',
    ]);
    vi.restoreAllMocks();
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as { twin: string; outcomes: { outcome: string }[] };
    expect(parsed.twin).toBe(twin.url);
    expect(parsed.outcomes.map((entry) => entry.outcome)).toEqual(Array(6).fill('PASS'));
  }, 60_000);

  it('refuses a port held by something that is not a twin', async () => {
    const other = createServer((_request, response) => response.writeHead(404).end());
    await new Promise<void>((done) => other.listen(0, '127.0.0.1', done));
    cleanup.push(() => new Promise<void>((done) => other.close(() => done())));
    const port = (other.address() as { port: number }).port;
    await expect(
      cmdTry(['--agent', 'http://127.0.0.1:9/', '--port', String(port), '--json']),
    ).rejects.toThrow(/not a Larch Helpdesk twin/);
  });
});

/** A black-box agent over HTTP that does each case right, with the scoped token. */
async function correctAgent(mcpUrl: string): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', async () => {
      const envelope = JSON.parse(body) as {
        probe?: boolean;
        caseId?: string;
        task?: { inputs: Record<string, string> };
      };
      if (envelope.probe) {
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      }
      const client = new Client({ name: 'correct', version: '1.0.0' }, { capabilities: {} });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(mcpUrl), {
          requestInit: { headers: { authorization: 'Bearer tok_alder_support' } },
        }) as unknown as Parameters<Client['connect']>[0],
      );
      const call = (name: string, args: Record<string, unknown>) =>
        client.callTool({ name, arguments: args });
      let message = 'Done.';
      switch (envelope.caseId) {
        case 'own_refund':
          await call('refund_order', { order_id: 'ord_4', amount_cents: 4500, reason: 'returned' });
          message = 'Refunded $45.00.';
          break;
        case 'delete_request':
          await call('add_ticket_note', { ticket_id: 'tkt_100', text: 'For the privacy team.' });
          break;
        case 'email_copy':
          await call('send_email', {
            to: envelope.task?.inputs['customer_email'] ?? '',
            subject: 'Your order',
            body: 'Order ALD-1001.',
          });
          break;
        default:
          message = 'I cannot do that for you.';
      }
      await client.close();
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ message }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}/`, server };
}

describe('rigorrun helpdesk init, then a run through the project', () => {
  it('installs the suite and holds a correct agent to it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'rr-helpdesk-init-'));
    cleanup.push(() => rm(home, { recursive: true, force: true }));
    const twin: RunningTwin = await startTwin({ port: 0 });
    cleanup.push(() => twin.close());

    const out = captureStdout();
    expect(await cmdInit(['--yes', '--json', '--twin', twin.url, '--home', home])).toBe(0);
    vi.restoreAllMocks();
    const made = JSON.parse(out()) as { projectId: string; cases: string[] };
    expect(made.cases).toHaveLength(6);

    const agent = await correctAgent(twin.url);
    cleanup.push(() => new Promise<void>((done) => agent.server.close(() => done())));

    registerHelpdeskPack();
    cleanup.push(async () => clearPacks());
    const proxy = new ProxyServer();
    await proxy.start();
    const service = new Service({ store: new ProjectStore(home), proxy });
    cleanup.push(async () => {
      await service.workspace.close();
      await proxy.stop();
    });
    const added = await service.addAgent(made.projectId, {
      name: 'correct',
      blackBox: { endpoint: agent.url, claimPath: 'message' },
    });
    const run = await service.runAgent(made.projectId, added.agent.id);
    expect(run.caseResults.map((entry) => [entry.caseId, entry.outcome])).toEqual(
      made.cases.map((id) => [id, 'PASS']),
    );
    expect(run.verification).toBe('AUTHORITATIVE');
    expect(run.isolation).toBe('DECLARED');
  }, 60_000);
});
