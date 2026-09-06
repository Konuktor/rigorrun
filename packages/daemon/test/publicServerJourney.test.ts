/**
 * The whole journey, against software nobody here wrote.
 *
 * `thirdParty.test.ts` proves discovery and the honest refusal against
 * `@modelcontextprotocol/server-filesystem`, whose reads answer in prose. This
 * goes further, against `@modelcontextprotocol/server-memory`, whose reads
 * answer in records: connect, teach a job, induce a schema, compile a
 * contract, build a suite, run an agent, get a verdict.
 *
 * Unmodified, from npm, pinned in the lockfile, pointed at a file that lives
 * for the length of the test. Nobody here chose its tools, its argument names,
 * its annotations, or the shape of what it returns — and the domain is a
 * knowledge graph, which is not one of the six bundled workflows nor the
 * dogfood fixture's business.
 *
 * It has no reset tool, and that is left alone rather than worked around. The
 * verdict says `ISOLATION: NONE`, which is the honest reading of a system that
 * cannot be put back, and demonstrating that against real public software is
 * worth more than arranging for it not to happen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { ProjectStore, Service } from '../src/index.ts';
import type { Project } from '../src/project.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const server = join(repo, 'node_modules', '.bin', 'mcp-server-memory');

let graphFile: string;
let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;
const servers: { close: () => Promise<void>; url: string }[] = [];

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'rigorrun-public-'));
  graphFile = join(scratch, 'memory.json');
  home = await mkdtemp(join(tmpdir(), 'rigorrun-public-home-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });

  // Where this server keeps its graph, in its own environment variable. Stored
  // as a credential because that is the mechanism: the connector names it, and
  // the value is fetched by the runner when it opens the connection. It is a
  // path rather than a token here, and the arrangement is the same.
  await store.setSecret('MEMORY_FILE_PATH', graphFile);
}, 120_000);

afterAll(async () => {
  for (const entry of servers) await entry.close();
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
  await rm(graphFile, { force: true });
});

describe('a public MCP server, all the way to a verdict', () => {
  it('connects to it, unmodified, from npm', async () => {
    project = await service.createProject({
      name: 'Graph agent',
      goal: 'Record that a plot is held by a tenant.',
    });
    const connected = await service.connectEnvironment(
      project.id,
      {
        kind: 'mcp',
        transport: 'stdio',
        command: server,
        args: [],
        url: '',
        // Its own configuration, in its own environment variable, which is how
        // this server is meant to be pointed at a file.
        secretNames: ['MEMORY_FILE_PATH'],
      },
      'ephemeral',
    );
    project = connected.project;

    expect(connected.serverName).toBe('memory-server');
    expect(connected.tools.map((tool) => tool.name)).toContain('read_graph');
    // It annotates carefully, and RigorRun still will not act on it.
    const read = connected.tools.find((tool) => tool.name === 'read_graph')!;
    expect(read.hints.readOnly).toBe(true);
    expect(read.risk.source).toBe('server-hint');
  }, 120_000);

  it('finds records in what its reads return', async () => {
    const configured = await service.configureEnvironment(project.id, {
      readOnlyTools: ['read_graph', 'search_nodes', 'open_nodes'],
      verifierReads: [{ tool: 'read_graph' }],
      // It publishes no way to put itself back. Left as it is.
      reset: { kind: 'none' },
    });
    project = configured.project;
    // The graph is empty at this point, and RigorRun says so — which is a
    // different thing from the filesystem server's reads answering in prose,
    // and reporting them the same way would send somebody to fix something
    // that is not broken.
    expect(configured.readsProblem).toMatch(/nothing in this system yet/);
    expect(configured.readsProblem).toMatch(/Nothing to do here/);
  }, 120_000);

  it('learns the job from one demonstration', async () => {
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'read_graph', {});
    await service.teachStep(project.id, 'create_entities', {
      entities: [
        { name: 'PLOT-14', entityType: 'plot', observations: ['five rods'] },
        { name: 'TEN-3', entityType: 'tenant', observations: ['good standing'] },
      ],
    });
    await service.teachStep(project.id, 'create_relations', {
      relations: [{ from: 'PLOT-14', to: 'TEN-3', relationType: 'held_by' }],
    });
    const finished = await service.finishTeaching(project.id);
    project = finished.project;

    // A schema induced from what a server nobody here wrote handed back, using
    // structure only — never the names of its fields.
    expect(finished.schema.entities.length).toBeGreaterThan(0);
    process.stdout.write(
      `\n  induced from a public server: ${finished.schema.entities
        .map((entity) => `${entity.name}(${entity.fields.map((f) => f.name).join(',')})`)
        .join(' ')}\n`,
    );
  }, 180_000);

  it('compiles a contract and builds a suite out of it', async () => {
    const draft = await service.compile(project.id);
    expect(draft.rules.length).toBeGreaterThan(0);
    await service.review(project.id, { confirmedRuleIds: draft.rules.map((rule) => rule.id) });

    const benchmark = await service.generate(project.id);
    expect(benchmark.cases.length).toBeGreaterThan(0);
    // And it says what this system cost the suite, rather than quietly
    // shrinking: no reset means no isolation, and it is on the artefact.
    expect(benchmark.notTestable.length).toBeGreaterThan(0);
    project = await store.read(project.id);
  }, 180_000);

  it('grades an agent against it, and says isolation is NONE', async () => {
    // A customer's agent: the public SDK, and nothing else of RigorRun's.
    const served = await serve(
      defineAgent(
        async ({ task }) => {
          const inputs = task.inputs as Record<string, unknown>;
          return { status: 'completed' as const, output: `Worked on ${JSON.stringify(inputs)}` };
        },
        { name: 'graph-agent', version: '1.0.0' },
      ),
    );
    servers.push(served);

    const added = await service.addAgent(project.id, { name: 'Graph agent', endpoint: served.url });
    expect(added.agent.lastProbeOk).toBe(true);

    const result = await service.runAgent(project.id, added.agent.id);
    expect(result.caseResults.length).toBeGreaterThan(0);
    // The two honesty labels, against real public software:
    expect(result.verification).toBe('PARTIAL');
    // No reset tool, so cases inherit whatever the last one left. Said, not
    // arranged around.
    expect(result.isolation).toBe('NONE');
    expect(result.limits.some((limit) => /isolat|reset/i.test(limit.limit))).toBe(true);
  }, 300_000);
});
