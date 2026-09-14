/**
 * What a live system's state read makes of what its reads answer.
 *
 * Records, from structured content or from JSON inside text, are the world.
 * An error, or prose where records were nominated, is an unknown world and
 * throws StateReadError, which the runner turns into an abstention. An empty
 * answer is an empty world. And a verifier's tools are never actions.
 */
import { describe, expect, it } from 'vitest';
import { StateReadError, type EnvironmentSchema } from '@rigorrun/environment';
import {
  SystemEnvironment,
  type CallResult,
  type DiscoveredTool,
  type SystemConnection,
  type SystemEnvironmentConfig,
} from '../src/index.ts';

const SCHEMA: EnvironmentSchema = {
  entities: [
    {
      name: 'Item',
      idField: 'itemId',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'itemId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'label', type: 'string', nullable: false, role: 'freetext' },
      ],
    },
  ],
  relationships: [],
};

const ROWS = [
  { itemId: 'I-1', label: 'first' },
  { itemId: 'I-2', label: 'second' },
];

function connection(answer: (name: string) => CallResult, toolNames = ['read_items', 'write_item']): SystemConnection {
  return {
    discovery: {
      serverName: 'fake',
      serverVersion: '1',
      protocolVersion: '',
      latencyMs: 0,
      tools: toolNames.map(
        (name) =>
          ({ name, description: name, params: [], unsupported: [], schemaTruncated: false, hints: {}, risk: {} }) as unknown as DiscoveredTool,
      ),
    },
    childPid: null,
    call: async (name) => answer(name),
    close: async () => undefined,
  };
}

function config(reads: string[]): SystemEnvironmentConfig {
  return {
    id: 'fake',
    name: 'Fake',
    description: '',
    verifierReads: reads.map((tool) => ({ tool })),
    reset: { kind: 'none' },
    safety: 'local',
    readOnlyTools: ['read_items'],
  };
}

const environment = (answer: CallResult, reads = ['read_items']) =>
  new SystemEnvironment(connection(() => answer), SCHEMA, config(reads));

describe('SystemEnvironment.getState', () => {
  it('reads records from structured content', async () => {
    const state = await environment({ ok: true, durationMs: 0, structured: { items: ROWS } }).getState();
    expect(Object.keys(state.entities['Item'] ?? {})).toEqual(['I-1', 'I-2']);
  });

  it('reads records from JSON inside a text block', async () => {
    const state = await environment({ ok: true, durationMs: 0, content: [{ type: 'text', text: JSON.stringify(ROWS) }] }).getState();
    expect(Object.keys(state.entities['Item'] ?? {})).toEqual(['I-1', 'I-2']);
  });

  it('throws StateReadError, naming the read, when a read fails', async () => {
    const failing = environment({ ok: false, durationMs: 0, error: { code: 'call_failed', message: 'HTTP 503' } });
    await expect(failing.getState()).rejects.toBeInstanceOf(StateReadError);
    await expect(failing.getState()).rejects.toThrow(/read_items did not answer: HTTP 503/);
  });

  it('throws StateReadError when a read answers in prose, rather than reporting an empty world', async () => {
    const prose = environment({ ok: true, durationMs: 0, content: [{ type: 'text', text: 'There are 2 items.' }] });
    await expect(prose.getState()).rejects.toThrow(/answered with text rather than records/);
  });

  it('reads an empty answer as an empty world', async () => {
    const state = await environment({ ok: true, durationMs: 0, content: [] }).getState();
    expect(state.entities['Item']).toEqual({});
    const emptyList = await environment({ ok: true, durationMs: 0, content: [{ type: 'text', text: '[]' }] }).getState();
    expect(emptyList.entities['Item']).toEqual({});
  });
});

describe('a verifier connection seen through SystemEnvironment', () => {
  it('offers no verifier tool as an action and refuses to call one', async () => {
    const env = new SystemEnvironment(
      connection(() => ({ ok: true, durationMs: 0, structured: {} }), ['read_items', 'write_item', 'verifier:read_items']),
      SCHEMA,
      config(['verifier:read_items']),
    );
    expect(env.getActions().map((action) => action.name)).toEqual(['read_items', 'write_item']);
    expect(await env.executeAction('verifier:read_items', {})).toMatchObject({ ok: false, error: { code: 'NOT_AN_ACTION' } });
  });

  it('labels reads independent only when every nominated read goes through the verifier', () => {
    const answer = () => ({ ok: true, durationMs: 0, structured: {} });
    const tools = ['read_items', 'verifier:read_items'];
    expect(new SystemEnvironment(connection(answer, tools), SCHEMA, config(['verifier:read_items'])).capabilities().stateReadIndependence).toBe('independent');
    expect(new SystemEnvironment(connection(answer, tools), SCHEMA, config(['verifier:read_items', 'read_items'])).capabilities().stateReadIndependence).toBe('self-reported');
    expect(new SystemEnvironment(connection(answer, tools), SCHEMA, config([])).capabilities().stateReadIndependence).toBe('self-reported');
  });
});
