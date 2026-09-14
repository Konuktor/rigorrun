/**
 * Audit finding R-2: a verdict that does not rest on the agent's own connection.
 *
 * The project connects to the desk for the agent and attaches a second desk
 * process, sharing the same state, as its verifier. Every nominated read goes
 * through the verifier, so every verdict is labelled INDEPENDENT; the agent is
 * never offered a verifier tool and cannot call one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Benchmark } from '@rigorrun/core';
import type { EnvironmentSchema } from '@rigorrun/environment';
import { ProxyServer } from '@rigorrun/proxy';
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { CAREFUL, runTask } from '../../../fixtures/external/booking-agent/src/agent.ts';
import { ProjectStore, Service } from '../src/index.ts';
import { describeConnector, describeConnectorAction, secretNamesOf, type Project } from '../src/project.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const desk = {
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  url: '',
  secretNames: ['DESK_STATE_FILE'],
};

let scratch: string;
let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;
const servers: { close: () => Promise<void>; url: string }[] = [];

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rigorrun-verifier-state-'));
  home = await mkdtemp(join(tmpdir(), 'rigorrun-verifier-'));
  store = new ProjectStore(home);
  await store.setSecret('DESK_STATE_FILE', join(scratch, 'desk.json'));
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
}, 60_000);

afterAll(async () => {
  for (const entry of servers) await entry.close();
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

describe('a project with an independent verifier', () => {
  it('connects to both, and says so', async () => {
    project = await service.createProject({ name: 'Desk, verified', goal: 'Confirm a held booking.' });
    const connected = await service.connectEnvironment(project.id, { ...desk, verifier: desk }, 'ephemeral');
    project = connected.project;
    const names = connected.tools.map((tool) => tool.name);
    expect(names).toContain('confirm_booking');
    expect(names).toContain('verifier:find_bookings');
    expect(describeConnector(project.connector)).toBe('MCP · stdio · independently verified');
    expect(describeConnectorAction(project.connector!)).toMatch(/to check the result$/);
    expect(secretNamesOf(project.connector!)).toEqual(['DESK_STATE_FILE']);
  }, 60_000);

  it('builds a suite whose reads all go through the verifier, and offers the agent none of its tools', async () => {
    project = (
      await service.configureEnvironment(project.id, {
        readOnlyTools: [
          'list_venues', 'list_organisers', 'find_bookings', 'get_booking',
          'verifier:list_venues', 'verifier:list_organisers', 'verifier:find_bookings', 'verifier:get_booking',
        ],
        verifierReads: [
          { tool: 'verifier:find_bookings' },
          { tool: 'verifier:list_venues' },
          { tool: 'verifier:list_organisers' },
        ],
        reset: { kind: 'tool', tool: 'reset_desk' },
      })
    ).project;
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
    const finished = await service.finishTeaching(project.id);
    expect(finished.schema.entities.map((entity) => entity.name)).toContain('Booking');
    const contract = await service.compile(project.id);
    expect(contract.primaryAction).toBe('confirm_booking');
    await service.review(project.id, { confirmedRuleIds: contract.rules.map((rule) => rule.id) });
    const benchmark: Benchmark = await service.generate(project.id);
    const offered = benchmark.cases.flatMap((entry) => entry.task.tools.map((tool) => tool.name));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.some((name) => name.startsWith('verifier:'))).toBe(false);

    const schema = await store.readArtefact<EnvironmentSchema>(project.id, 'schema');
    const refused = await service.workspace.environment(project, schema!).executeAction('verifier:reset_desk', {});
    expect(refused).toMatchObject({ ok: false, error: { code: 'NOT_AN_ACTION' } });
  }, 180_000);

  it('labels the verdict INDEPENDENT', async () => {
    const served = await serve(
      defineAgent(
        async ({ task, environment }) => ({
          status: 'completed' as const,
          output: await runTask(environment.mcpUrl, task.inputs, CAREFUL),
        }),
        { name: 'booking-agent', version: '1.0.0' },
      ),
    );
    servers.push(served);
    const added = await service.addAgent(project.id, { name: 'Careful agent', endpoint: served.url });
    const result = await service.runAgent(project.id, added.agent.id);
    const happy = result.caseResults.find((entry) => entry.category === 'happy_path')!;
    expect(happy.evidenceIndependence).toBe('INDEPENDENT');
    expect(happy.outcome, happy.outcomeReason).toBe('PASS');
    expect(result.caseResults.every((entry) => entry.evidenceIndependence === 'INDEPENDENT')).toBe(true);
  }, 300_000);
});
