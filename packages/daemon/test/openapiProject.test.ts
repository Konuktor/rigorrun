/**
 * A project connected to an HTTP API rather than an MCP server.
 *
 * The point of this test is that almost nothing in it is about OpenAPI. It goes
 * through the same service functions the interface calls, in the same order,
 * and reaches the same place — which is the whole claim: there is one engine
 * and several ways to reach a system, rather than a second engine for the
 * second connector.
 *
 * The API below is an allotment registry, which is not one of the six bundled
 * domains and not the dogfood fixture's business either. If any of its words
 * turned up in generic code the exercise would be pointless.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '../src/index.ts';
import type { Project } from '../src/project.ts';

const SPEC = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Allotment registry', version: '2.1.0' },
  paths: {
    '/plots': {
      get: { operationId: 'listPlots', responses: { '200': { description: 'all' } } },
    },
    '/tenants': {
      get: { operationId: 'listTenants', responses: { '200': { description: 'all' } } },
    },
    '/plots/{plotRef}/tenant': {
      parameters: [{ name: 'plotRef', in: 'path', required: true, schema: { type: 'string' } }],
      put: {
        operationId: 'assignTenant',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantRef'],
                properties: { tenantRef: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'done' } },
      },
    },
  },
});

/** State the API actually holds, so a read really reads something. */
const plots = new Map<string, Record<string, unknown>>([
  ['PLOT-14', { plotRef: 'PLOT-14', rods: 5, tenantRef: null, standing: 'vacant' }],
  ['PLOT-15', { plotRef: 'PLOT-15', rods: 3, tenantRef: 'TEN-9', standing: 'held' }],
  ['PLOT-16', { plotRef: 'PLOT-16', rods: 8, tenantRef: 'TEN-2', standing: 'held' }],
]);
const tenants = [
  { tenantRef: 'TEN-2', tenantName: 'Ada Fenwick', arrears: 0 },
  { tenantRef: 'TEN-3', tenantName: 'Bo Lindqvist', arrears: 0 },
  { tenantRef: 'TEN-9', tenantName: 'Casper Voight', arrears: 12 },
];
const methodsSeen: string[] = [];

let api: Server;
let baseUrl: string;
let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;

beforeAll(async () => {
  api = createServer((request, response) => {
    methodsSeen.push(request.method ?? '');
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'PUT') {
      const ref = url.pathname.split('/')[2] ?? '';
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as {
          tenantRef?: string;
        };
        const plot = plots.get(ref);
        if (plot) {
          plot['tenantRef'] = body.tenantRef ?? null;
          plot['standing'] = body.tenantRef ? 'held' : 'vacant';
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(plot ?? {}));
      });
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      url.pathname === '/tenants'
        ? JSON.stringify({ tenants })
        : JSON.stringify({ plots: [...plots.values()] }),
    );
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  home = await mkdtemp(join(tmpdir(), 'rigorrun-openapi-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
}, 60_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await rm(home, { recursive: true, force: true });
});

describe('a project whose system is an HTTP API', () => {
  it('connects, and finds the operations the document publishes', async () => {
    project = await service.createProject({
      name: 'Allotment agent',
      goal: 'Assign a vacant plot to a tenant.',
    });
    const connected = await service.connectEnvironment(
      project.id,
      {
        kind: 'openapi',
        spec: SPEC,
        specUrl: '',
        baseUrl,
        headers: {},
        secretNames: [],
      },
      'staging',
    );
    project = connected.project;

    expect(connected.serverName).toBe('Allotment registry');
    expect(connected.tools.map((tool) => tool.name).sort()).toEqual([
      'assignTenant',
      'listPlots',
      'listTenants',
    ]);
    // The method is evidence, recorded as coming from the protocol.
    const write = connected.tools.find((tool) => tool.name === 'assignTenant')!;
    expect(write.risk).toMatchObject({ level: 'write', source: 'protocol' });
  }, 60_000);

  it('knows a client id is a credential without being told twice', async () => {
    // The bug this pins: naming a client id in the sign-in and not repeating it
    // in the credentials list produced "REGISTRY_CLIENT_ID is not in this
    // machine's credential store" while it was sitting in the store. The names
    // a connector needs are derived from the connector, not typed alongside it.
    const other = await service.createProject({ name: 'Signed in', goal: 'Assign a plot.' });
    await store.setSecret('REGISTRY_CLIENT_ID', 'a-client');
    await store.setSecret('REGISTRY_CLIENT_SECRET', 'a-secret');

    const connected = await service.connectEnvironment(
      other.id,
      {
        kind: 'openapi',
        spec: SPEC,
        specUrl: '',
        baseUrl,
        headers: {},
        oauth: {
          tokenUrl: `${baseUrl}/oauth/token`,
          clientIdSecret: 'REGISTRY_CLIENT_ID',
          clientSecretSecret: 'REGISTRY_CLIENT_SECRET',
          scope: '',
        },
        secretNames: [],
      },
      'staging',
    );
    expect(connected.serverName).toBe('Allotment registry');

    // And one that is genuinely absent still says so, naming it.
    const third = await service.createProject({ name: 'Not signed in', goal: 'Assign a plot.' });
    await expect(
      service.connectEnvironment(
        third.id,
        {
          kind: 'openapi',
          spec: SPEC,
          specUrl: '',
          baseUrl,
          headers: {},
          oauth: {
            tokenUrl: `${baseUrl}/oauth/token`,
            clientIdSecret: 'REGISTRY_CLIENT_ID',
            clientSecretSecret: 'A_NAME_NOBODY_SET',
            scope: '',
          },
          secretNames: [],
        },
        'staging',
      ),
    ).rejects.toThrow(/A_NAME_NOBODY_SET/);
  }, 60_000);

  it('survives a restart, because the document is kept rather than fetched', async () => {
    // A spec behind a URL that has since moved would make an old project
    // unopenable. It is stored, so reconnecting needs nothing but the disk.
    const saved = await store.read(project.id);
    expect(saved.connector?.kind).toBe('openapi');
    if (saved.connector?.kind !== 'openapi') throw new Error('expected openapi');
    expect(saved.connector.spec.length).toBeGreaterThan(100);
  });

  it('reads the API back and finds records in it', async () => {
    const configured = await service.configureEnvironment(project.id, {
      readOnlyTools: ['listPlots', 'listTenants'],
      verifierReads: [{ tool: 'listPlots' }, { tool: 'listTenants' }],
      reset: { kind: 'none' },
    });
    project = configured.project;
    // The reads answer with records, so there is nothing to warn about.
    expect(configured.readsProblem).toBe('');
  }, 60_000);

  it('learns the job from the same demonstration flow MCP uses', async () => {
    methodsSeen.length = 0;
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'listPlots', {});
    await service.teachStep(project.id, 'listTenants', {});
    await service.teachStep(project.id, 'assignTenant', {
      plotRef: 'PLOT-14',
      tenantRef: 'TEN-3',
    });
    const finished = await service.finishTeaching(project.id);
    project = finished.project;

    // Records induced from what the API returned, with no schema declared to
    // RigorRun and no vocabulary brought to it.
    expect(finished.schema.entities.map((entity) => entity.name).sort()).toEqual([
      'Plot',
      'Tenant',
    ]);
    // And the write really happened: this is the state the verdict rests on.
    expect(plots.get('PLOT-14')?.['tenantRef']).toBe('TEN-3');
  }, 120_000);

  it('never sent a write before the demonstration began', async () => {
    // Everything up to `startTeaching` — connecting, probing the reads,
    // sampling to induce records — happened against this API. All of it GET.
    expect(methodsSeen.length).toBeGreaterThan(0);
    expect(methodsSeen.filter((method) => method !== 'GET' && method !== 'PUT')).toEqual([]);
  });

  it('compiles a contract out of what changed', async () => {
    const draft = await service.compile(project.id);

    // What actually changed, read back out of the API rather than taken from
    // the request that changed it. Note the second fact: the link between a
    // plot and a tenant was never described to RigorRun. It was worked out
    // from the shape of two unrelated reads, through a connector that did not
    // exist a day ago, in a business none of this code has heard of.
    const facts = draft.observedFacts.map((fact) => fact.statement).join(' ');
    expect(facts).toContain('standing changed');
    expect(facts).toContain('was linked to');
    expect(draft.rules.length).toBeGreaterThan(0);
    // Nothing is enforced until a person says so, exactly as with MCP.
    for (const rule of draft.rules) expect(rule.status).not.toBe('confirmed');

    // And a suite comes out the other end, which is the point of all of it.
    await service.review(project.id, { confirmedRuleIds: draft.rules.map((rule) => rule.id) });
    const benchmark = await service.generate(project.id);
    expect(benchmark.cases.length).toBeGreaterThan(1);
  }, 120_000);
});
