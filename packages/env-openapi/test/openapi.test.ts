/**
 * An HTTP API, as a system RigorRun can grade against.
 *
 * The test that carries the most weight here is the counting one. Against MCP,
 * RigorRun only ever calls tools the operator has ticked. Against an OpenAPI
 * document every operation arrives at once, described by a file, and `POST
 * /bookings` looks exactly like `GET /bookings` to anything not reading the
 * method — so "RigorRun does not write to your system while you are setting it
 * up" stops being obvious and starts being something to prove.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { SystemEnvironment, isConfirmedReadOnly, mayMutate } from '@rigorrun/connector';
import { OpenApiConnection, WriteRefusedDuringSetup, operationsFrom, loadDocument } from '../src/index.ts';

/**
 * A small API in a business RigorRun has never seen.
 *
 * Deliberately not one of the six bundled domains and not the dogfood
 * fixture's: if any of these words reached generic code, the point of the
 * exercise would be gone.
 */
const SPEC = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Allotment registry', version: '2.1.0' },
  paths: {
    '/plots': {
      get: {
        operationId: 'listPlots',
        summary: 'Every plot on the site.',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    plots: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Plot' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPlot',
        responses: { '201': { description: 'made' } },
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['plotRef', 'rods'],
                properties: {
                  plotRef: { type: 'string' },
                  rods: { type: 'number', multipleOf: 0.5 },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    '/plots/{plotRef}': {
      parameters: [{ name: 'plotRef', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getPlot', responses: { '200': { description: 'one' } } },
      delete: { operationId: 'releasePlot', responses: { '204': { description: 'gone' } } },
      patch: {
        operationId: 'reassignPlot',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { tenantRef: { type: 'string' }, standing: { type: 'string', enum: ['good', 'lapsed'] } },
              },
            },
          },
        },
        responses: { '200': { description: 'done' } },
      },
    },
    '/legacy': {
      get: { operationId: 'oldWay', deprecated: true, responses: { '200': { description: 'old' } } },
    },
  },
  components: {
    schemas: {
      Plot: {
        type: 'object',
        properties: {
          plotRef: { type: 'string' },
          rods: { type: 'number' },
          tenantRef: { type: 'string' },
          standing: { type: 'string', enum: ['good', 'lapsed'] },
        },
      },
    },
  },
});

/** Counts what RigorRun actually sent, by method. */
const seen: { method: string; url: string }[] = [];
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push({ method: request.method ?? '', url: request.url ?? '' });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        plots: [
          { plotRef: 'PLOT-14', rods: 5, tenantRef: 'TEN-2', standing: 'good' },
          { plotRef: 'PLOT-15', rods: 2.5, tenantRef: 'TEN-9', standing: 'lapsed' },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('reading an OpenAPI document', () => {
  it('finds the operations, resolving the references it is given', async () => {
    const operations = operationsFrom(await loadDocument(SPEC));
    expect(operations.map((entry) => entry.name).sort()).toEqual([
      'createPlot',
      'getPlot',
      'listPlots',
      'oldWay',
      'reassignPlot',
      'releasePlot',
    ]);

    // A `$ref` into components was followed, so the declared response shape is
    // there — better evidence for what a record looks like than sampling one.
    const list = operations.find((entry) => entry.name === 'listPlots')!;
    expect(JSON.stringify(list.responseSchema)).toContain('plotRef');
  });

  it('reads arguments from three different places into one shape', async () => {
    const operations = operationsFrom(await loadDocument(SPEC));
    const patch = operations.find((entry) => entry.name === 'reassignPlot')!;
    const byName = Object.fromEntries(patch.tool.params.map((param) => [param.name, param]));

    // A path parameter and two body properties, and nothing downstream needs
    // to know they arrived differently.
    expect(byName['plotRef']).toMatchObject({ type: 'string', required: true });
    expect(byName['tenantRef']).toMatchObject({ type: 'string' });
    expect(byName['standing']).toMatchObject({ type: 'enum', enumValues: ['good', 'lapsed'] });
    expect(patch.placement).toMatchObject({ plotRef: 'path', tenantRef: 'body' });
  });

  it('takes the method as evidence, and still not as permission', async () => {
    const connection = await OpenApiConnection.open({ spec: SPEC, baseUrl });
    const tools = Object.fromEntries(connection.discovery.tools.map((tool) => [tool.name, tool]));

    // RFC 9110 makes GET safe as a requirement rather than a suggestion, so
    // this is better evidence than an annotation — and it is recorded as
    // coming from the protocol rather than from the system's own opinion.
    expect(tools['listPlots']!.risk).toMatchObject({ level: 'read', source: 'protocol' });
    expect(tools['releasePlot']!.risk).toMatchObject({ level: 'destructive', source: 'protocol' });
    expect(tools['createPlot']!.risk).toMatchObject({ level: 'write', source: 'protocol' });

    // And still nothing is confirmed. A system can misuse GET, so a person has
    // to say so — exactly as with an MCP hint.
    for (const tool of connection.discovery.tools) {
      expect(isConfirmedReadOnly(tool.risk)).toBe(false);
      expect(mayMutate(tool.risk)).toBe(true);
    }
  });

  it('does not offer an operation the document has deprecated', async () => {
    const connection = await OpenApiConnection.open({ spec: SPEC, baseUrl });
    expect(connection.discovery.tools.map((tool) => tool.name)).not.toContain('oldWay');
  });
});

describe('talking to the API', () => {
  it('sends the request the document describes, and reads the answer back', async () => {
    seen.length = 0;
    const connection = await OpenApiConnection.open({ spec: SPEC, baseUrl });
    const result = await connection.call('getPlot', { plotRef: 'PLOT-14' });

    expect(result.ok).toBe(true);
    expect(seen).toEqual([{ method: 'GET', url: '/plots/PLOT-14' }]);
    expect(JSON.stringify(result.structured)).toContain('PLOT-14');
  });

  it('encodes a path argument rather than letting it choose the route', async () => {
    seen.length = 0;
    const connection = await OpenApiConnection.open({ spec: SPEC, baseUrl });
    await connection.call('getPlot', { plotRef: '../../admin' });
    // The traversal is spent as a value, not as path structure.
    expect(seen[0]!.url).toBe('/plots/..%2F..%2Fadmin');
  });

  it('refuses to write to somebody’s system while they are setting it up', async () => {
    seen.length = 0;
    const connection = await OpenApiConnection.open({ spec: SPEC, baseUrl });

    for (const write of ['createPlot', 'releasePlot', 'reassignPlot']) {
      await expect(connection.call(write, { plotRef: 'PLOT-14' })).rejects.toThrow(
        WriteRefusedDuringSetup,
      );
    }
    // The assertion that matters: not one request left the process.
    expect(seen).toEqual([]);

    // Reads are fine throughout, which is what setup actually needs.
    await connection.call('listPlots', {});
    expect(seen.map((entry) => entry.method)).toEqual(['GET']);

    // And once a run begins, writing is the entire point.
    connection.allowWrites();
    await connection.call('createPlot', { plotRef: 'PLOT-16', rods: 3 });
    expect(seen.map((entry) => entry.method)).toEqual(['GET', 'POST']);
  });

  it('never sends a non-GET across a whole setup, whatever is asked of it', async () => {
    seen.length = 0;
    const connection = await OpenApiConnection.open({ spec: SPEC, baseUrl });
    // Everything a setup does: discover, then try every operation there is.
    for (const tool of connection.discovery.tools) {
      await connection.call(tool.name, { plotRef: 'PLOT-14' }).catch(() => undefined);
    }
    expect(seen.filter((entry) => entry.method !== 'GET')).toEqual([]);
  });
});

describe('as an environment', () => {
  it('is the same adapter an MCP connection gets', async () => {
    const connection = await OpenApiConnection.open({ spec: SPEC, baseUrl });
    const schema = {
      entities: [
        {
          name: 'Plot',
          idField: 'plotRef',
          fields: [
            { name: 'plotRef', type: 'id' as const },
            { name: 'rods', type: 'quantity' as const, precision: 0.5 },
            { name: 'standing', type: 'enum' as const, enumValues: ['good', 'lapsed'] },
          ],
        },
      ],
      relationships: [],
    };

    const environment = new SystemEnvironment(connection, schema, {
      id: 'allotments',
      name: 'Allotment registry',
      description: 'Plots and who holds them.',
      verifierReads: [{ tool: 'listPlots' }],
      reset: { kind: 'none' },
      safety: 'staging',
      readOnlyTools: ['listPlots', 'getPlot'],
    });

    // Nothing about this class knows a second connector arrived.
    expect(environment.capabilities()).toMatchObject({
      stateRead: 'designated-reads',
      seed: 'none',
      reset: 'none',
      safety: 'staging',
    });
    const state = await environment.getState();
    expect(Object.keys(state.entities['Plot'] ?? {})).toEqual(['PLOT-14', 'PLOT-15']);
  });
});
