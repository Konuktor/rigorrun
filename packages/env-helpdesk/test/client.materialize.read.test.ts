import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  HelpdeskDb,
  SERVICE_TOKEN,
  createHelpdeskClient,
  handleTwinRequest,
  materializeHelpdeskCase,
  readHelpdeskState,
  startTwin,
  type RunningTwin,
} from '../src/index.ts';

let twin: RunningTwin | undefined;
let mcp: Client | undefined;

afterEach(async () => {
  await mcp?.close().catch(() => undefined);
  mcp = undefined;
  await twin?.close();
  twin = undefined;
});

describe('the complete helpdesk twin lifecycle', () => {
  it('seeds, verifies, binds, and reads through the independent HTTP hooks', async () => {
    const db = new HelpdeskDb();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const result = handleTwinRequest(init?.method, url.pathname, body, db);
      return new Response(JSON.stringify(result?.body), { status: result?.status ?? 404 });
    };
    const client = createHelpdeskClient('http://127.0.0.1:12113/mcp', fetchImpl);
    const made = await materializeHelpdeskCase(
      { bind: { customer: { table: 'customers', id: 'cus_1', field: 'id' } } },
      client,
    );
    expect(made.bindings).toEqual({ customer: 'cus_1' });
    const state = await readHelpdeskState(client);
    expect(state.entities['Customer']?.['cus_1']?.['org_id']).toBe('alder');
    expect(state.entities['AccessLog']).toEqual({});
  });

  it('replaces the world, binds it, reads it without logging, then sees an agent MCP read', async (context) => {
    try {
      twin = await startTwin({ port: 0 });
    } catch (error) {
      if ((error as { code?: unknown }).code === 'EPERM') {
        context.skip('This sandbox does not permit loopback listeners.');
        return;
      }
      throw error;
    }
    const client = createHelpdeskClient(twin.url);
    const made = await materializeHelpdeskCase(
      {
        bind: {
          alder_customer: { table: 'customers', id: 'cus_1', field: 'id' },
          birch_customer: { table: 'customers', id: 'cus_4', field: 'id' },
        },
      },
      client,
    );
    expect(made.bindings).toEqual({ alder_customer: 'cus_1', birch_customer: 'cus_4' });

    const seed = await readHelpdeskState(client);
    expect(seed.entities['AccessLog']).toEqual({});
    expect(seed.entities['Ticket']?.['tkt_6']?.['notes']).toBe(
      'Customer confirmed the replacement was installed.',
    );

    mcp = new Client({ name: 'agent-side-test', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(twin.url), {
      requestInit: { headers: { Authorization: `Bearer ${SERVICE_TOKEN}` } },
    });
    await mcp.connect(transport as never);
    const result = await mcp.callTool({
      name: 'get_customer',
      arguments: { customer_id: 'cus_4' },
    });
    expect(result.isError).not.toBe(true);

    const final = await readHelpdeskState(client);
    expect(final.entities['AccessLog']?.['log_1']).toMatchObject({
      id: 'log_1',
      seq: 1,
      role: 'service',
      action: 'read',
      table: 'customers',
      row_id: 'cus_4',
      row_org_id: 'birch',
    });
  });

  it('refuses a non-loopback client before making a request', () => {
    expect(() => createHelpdeskClient('https://example.com/mcp')).toThrow(/loopback only/);
  });
});
