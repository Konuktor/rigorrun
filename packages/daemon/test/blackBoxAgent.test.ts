/**
 * `rigorrun/task/1`: sending a case's work to an agent RigorRun does not drive.
 *
 * Remote addresses are allowed here and nowhere else, so most of what is
 * checked is where the work may go: https only off this machine, only to hosts
 * a person named exactly, never along a redirect, never to a status address an
 * answer made up. The rest is that a ticket containing a quote cannot rewrite
 * the request it is put into, and that what the agent says is carried as its
 * claim and nothing more.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AgentRunInput } from '@rigorrun/agents';
import {
  TASK_PROTOCOL,
  assertBlackBoxEndpoint,
  assertBlackBoxUrl,
  claimAt,
  createBlackBoxAgent,
  probeBlackBox,
  redactEndpoint,
  renderBody,
  taskEnvelope,
} from '../src/blackBoxAgent.ts';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
});

function listen(
  handler: (req: IncomingMessage, body: string, res: ServerResponse) => void,
): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => handler(req, body, res));
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
    });
  });
}

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

const input: AgentRunInput = {
  caseId: 'case_1',
  maxSteps: 10,
  task: {
    instruction: 'Refund the order the customer names.',
    inputs: { orderRef: 'ORD-7', message: 'Please refund "all" of it' },
    allowedTools: [],
    tools: [],
    policyBrief: 'Refund at most the amount paid.',
  },
};

const base = {
  id: 'a_1',
  name: 'Support agent',
  allowedHosts: [] as string[],
  bodyTemplate: null,
  completion: 'response' as const,
  claimPath: 'output',
  settleQuietMs: 10,
  timeoutMs: 5000,
};

describe('where the work may go', () => {
  it('allows loopback over http', () => {
    expect(assertBlackBoxUrl('http://127.0.0.1:9/hook', []).hostname).toBe('127.0.0.1');
  });

  it('refuses a remote host over plain http, even when named', () => {
    expect(() => assertBlackBoxUrl('http://agent.example.com/hook', ['agent.example.com'])).toThrow(
      /https/,
    );
  });

  it('refuses a remote host nobody named, and does not match by suffix', () => {
    expect(() => assertBlackBoxUrl('https://agent.example.com/hook', [])).toThrow(/list of hosts/);
    expect(() =>
      assertBlackBoxUrl('https://evil.agent.example.com/hook', ['agent.example.com']),
    ).toThrow(/list of hosts/);
    expect(
      assertBlackBoxUrl('https://agent.example.com/hook', ['Agent.Example.com']).hostname,
    ).toBe('agent.example.com');
  });

  it('refuses credentials in the address', () => {
    expect(() =>
      assertBlackBoxUrl('https://user:pw@agent.example.com/', ['agent.example.com']),
    ).toThrow(/credentials/);
  });
});

describe('credentials in the address', () => {
  it.each([
    'https://agent.example.com/run?api_key=x',
    'https://agent.example.com/run?apiKey=x',
    'https://agent.example.com/run?x-api-key=x',
    'https://agent.example.com/run?key=x',
    'https://agent.example.com/run?token=x',
    'https://agent.example.com/run?access_token=x',
    'https://agent.example.com/run?client_secret=x',
    'https://agent.example.com/run?password=x',
    'https://agent.example.com/run?auth=x',
    'https://agent.example.com/run?signature=x',
    'https://agent.example.com/run?sig=x',
    'https://agent.example.com/run?tenant=sk_test_51abc',
    'https://agent.example.com/run?tenant=rk_live_51abc',
    'https://agent.example.com/run?tenant=pk_test_51abc',
    'https://agent.example.com/run?hook=whsec_abc',
  ])('refuses %s as an agent’s address, without echoing the value', (endpoint) => {
    expect(() => assertBlackBoxEndpoint(endpoint, ['agent.example.com'])).toThrow(
      /credential in its query/,
    );
    try {
      assertBlackBoxEndpoint(endpoint, ['agent.example.com']);
    } catch (error) {
      expect((error as Error).message).not.toMatch(/=x\b|_51abc|whsec_abc/);
    }
    expect(() =>
      createBlackBoxAgent({ ...base, endpoint, allowedHosts: ['agent.example.com'] }),
    ).toThrow(/credential in its query/);
  });

  it('allows a query that carries none', () => {
    const url = assertBlackBoxEndpoint('https://agent.example.com/run?tenant=acme&mode=fast', [
      'agent.example.com',
    ]);
    expect(url.searchParams.get('tenant')).toBe('acme');
  });

  it('reports the refusal from the probe, before any request', async () => {
    const probe = await probeBlackBox({
      endpoint: 'http://127.0.0.1:9/run?token=abc',
      allowedHosts: [],
      bodyTemplate: null,
    });
    expect(probe).toMatchObject({ ok: false });
    expect(probe.ok ? '' : probe.problem).toMatch(/credential in its query/);
  });

  it('shows an address without its query wherever an agent is described', () => {
    expect(redactEndpoint('https://agent.example.com/run?tenant=acme')).toBe(
      'https://agent.example.com/run?…',
    );
    expect(redactEndpoint('https://agent.example.com/run#frag')).toBe(
      'https://agent.example.com/run#…',
    );
    expect(redactEndpoint('https://agent.example.com/run')).toBe('https://agent.example.com/run');
  });
});

describe('the request', () => {
  it('is the task envelope when there is no template, with the work order as text', () => {
    const envelope = taskEnvelope(input);
    expect(envelope.protocol).toBe(TASK_PROTOCOL);
    expect(envelope.task.text).toContain('Refund the order the customer names.');
    expect(envelope.task.text).toContain('orderRef: ORD-7');
    expect(JSON.parse(renderBody(null, envelope))).toEqual(envelope);
  });

  it('fills a template without letting a quote in the task escape its string', () => {
    const body = renderBody(
      '{"ticket": {"body": "{{inputs.message}}", "ref": "{{inputs.orderRef}}"}}',
      taskEnvelope(input),
    );
    expect(JSON.parse(body)).toEqual({
      ticket: { body: 'Please refund "all" of it', ref: 'ORD-7' },
    });
  });

  it('refuses a template naming something the case does not have', () => {
    expect(() => renderBody('{"x": "{{inputs.nothing}}"}', taskEnvelope(input))).toThrow(
      /does not have/,
    );
  });

  it('reads the claim at a dotted path', () => {
    expect(claimAt({ reply: { text: 'Refunded $25.00' } }, 'reply.text')).toBe('Refunded $25.00');
    expect(claimAt({ reply: {} }, 'reply.text')).toBe('');
  });
});

describe('a case', () => {
  it('posts the work, and carries what the agent said as its claim', async () => {
    const received: unknown[] = [];
    const endpoint = await listen((req, body, res) => {
      received.push({ headers: req.headers, body: JSON.parse(body) });
      json(res, 200, { status: 'completed', output: 'Refunded ORD-7.' });
    });
    const agent = createBlackBoxAgent({ ...base, endpoint });
    const output = await agent.execute(input, undefined as never);
    expect(output.report).toBe('Refunded ORD-7.');
    const [first] = received as { headers: Record<string, string>; body: { caseId: string } }[];
    expect(first?.body.caseId).toBe('case_1');
    expect(first?.headers['idempotency-key']).toMatch(/^case_1\./);
  });

  it('waits on a status address until the agent is finished', async () => {
    let polls = 0;
    const endpoint = await listen((req, _body, res) => {
      if (req.method === 'POST') return json(res, 202, { statusUrl: '/status/1' });
      polls += 1;
      json(
        res,
        200,
        polls < 2 ? { status: 'running' } : { status: 'completed', output: 'Done after polling.' },
      );
    });
    const agent = createBlackBoxAgent({ ...base, endpoint, completion: 'poll' });
    expect((await agent.execute(input, undefined as never)).report).toBe('Done after polling.');
    expect(polls).toBe(2);
  });

  it('never follows a status address off the list', async () => {
    const endpoint = await listen((_req, _body, res) =>
      json(res, 202, { statusUrl: 'https://elsewhere.example.com/s' }),
    );
    const agent = createBlackBoxAgent({ ...base, endpoint, completion: 'poll' });
    await expect(agent.execute(input, undefined as never)).rejects.toThrow(/list of hosts/);
  });

  it('never follows a redirect', async () => {
    const endpoint = await listen((_req, _body, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/' });
      res.end();
    });
    const agent = createBlackBoxAgent({ ...base, endpoint });
    await expect(agent.execute(input, undefined as never)).rejects.toThrow();
  });

  it('refuses to call a 202 Accepted a finished case when it was told the answer is the end', async () => {
    // Read at once, the system would not hold work still on its way, and the
    // agent would be failed for being asynchronous rather than for being wrong.
    let worked = false;
    const endpoint = await listen((_req, _body, res) => {
      json(res, 202, { status: 'queued' });
      setTimeout(() => (worked = true), 25);
    });
    const agent = createBlackBoxAgent({ ...base, endpoint });
    await expect(agent.execute(input, undefined as never)).rejects.toThrow(
      'answered 202 Accepted — the work is not done yet; add the agent with --completion poll ' +
        '(statusUrl) or --completion settle',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(worked).toBe(true);
  });

  it('waits out a 202 when told to settle', async () => {
    const endpoint = await listen((_req, _body, res) => json(res, 202, { output: 'Queued.' }));
    const agent = createBlackBoxAgent({ ...base, endpoint, completion: 'settle' });
    expect((await agent.execute(input, undefined as never)).report).toBe('Queued.');
  });

  it('treats an error status as the agent failing, not as a quiet answer', async () => {
    const endpoint = await listen((_req, _body, res) => json(res, 500, { error: 'boom' }));
    const agent = createBlackBoxAgent({ ...base, endpoint });
    await expect(agent.execute(input, undefined as never)).rejects.toThrow(/500/);
  });
});

describe('the probe', () => {
  it('asks a rigorrun/task/1 endpoint to answer without working', async () => {
    const endpoint = await listen((_req, body, res) =>
      json(res, 200, JSON.parse(body).probe ? { ok: true } : { status: 'completed' }),
    );
    expect(await probeBlackBox({ ...base, endpoint })).toMatchObject({ ok: true });
  });

  it('claims only reachability for an endpoint with its own request shape', async () => {
    const endpoint = await listen((_req, _body, res) => json(res, 405, {}));
    const probe = await probeBlackBox({
      ...base,
      endpoint,
      bodyTemplate: '{"m": "{{task.text}}"}',
    });
    expect(probe).toMatchObject({ ok: true });
    expect(probe.ok && probe.detail).toMatch(/reachable/);
  });
});
