/**
 * A server that answers with JSON inside a text block, and nothing else.
 *
 * That is the most common MCP result shape there is — no `outputSchema`, no
 * `structuredContent`, just `content:[{type:'text', text:'{…}'}]`. The audit
 * found (R-8) that the setup probe accepted it, the demonstration capture did
 * not, and compile refused with "returned text rather than structured
 * records" after the person had done the whole job. The refusal was wrong in
 * both directions: the reads were fine, and had they been prose the probe
 * should have said so before anybody recorded anything.
 *
 * The venue desk is spawned with `DESK_RESULT_SHAPE=text-json` — the same
 * server, answering the common way — and once more with `prose`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { CAREFUL, runTask } from '../../../fixtures/external/booking-agent/src/agent.ts';
import { ProjectStore, Service } from '../src/index.ts';
import type { Project } from '../src/project.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const DESK = {
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  url: '',
  secretNames: ['DESK_RESULT_SHAPE'],
};

let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
const servers: { close: () => Promise<void>; url: string }[] = [];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-textjson-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
}, 60_000);

afterAll(async () => {
  for (const entry of servers) await entry.close();
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

async function connected(shape: string): Promise<Project> {
  await store.setSecret('DESK_RESULT_SHAPE', shape);
  const project = await service.createProject({ name: `Desk (${shape})`, goal: 'Confirm a held booking.' });
  const result = await service.connectEnvironment(project.id, DESK, 'ephemeral');
  return result.project;
}

const READS = {
  readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
  verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
  reset: { kind: 'tool' as const, tool: 'reset_desk' },
};

describe('JSON in a text block is data', () => {
  let project: Project;

  it('passes the read probe, for the right reason', async () => {
    project = await connected('text-json');
    const configured = await service.configureEnvironment(project.id, READS);
    project = configured.project;
    expect(configured.readsProblem).toBe('');
  }, 60_000);

  it('captures the demonstration and compiles a contract from it', async () => {
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'find_bookings', {});
    await service.teachStep(project.id, 'record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
    const finished = await service.finishTeaching(project.id);
    project = finished.project;
    expect(finished.schema.entities.map((e) => e.name).sort()).toEqual(['Booking', 'Organiser', 'Venue']);

    // This is the call that used to refuse with "text rather than structured
    // records" after the job had been demonstrated.
    const draft = await service.compile(project.id);
    expect(draft.focusEntity).toBe('Booking');
    await service.review(project.id, { confirmedRuleIds: draft.rules.map((rule) => rule.id) });
    const benchmark = await service.generate(project.id);
    expect(benchmark.cases.length).toBeGreaterThan(0);
  }, 120_000);

  it('reaches a verdict against it', async () => {
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
    expect(added.agent.lastProbeOk).toBe(true);

    const result = await service.runAgent(project.id, added.agent.id);
    expect(result.verification).toBe('PARTIAL');
    // Nobody checked this suite, and the run says so beside the verdict.
    expect(result.suiteQuality?.assessed).toBe(false);
    expect(result.limits.map((limit) => limit.id)).toContain('suite_quality_unassessed');
    expect(result.verdict.rationale.some((reason) => reason.startsWith('Suite quality:'))).toBe(true);
    const happy = result.caseResults.find((entry) => entry.category === 'happy_path');
    expect(happy).toBeDefined();
    // The state was read back through the same normaliser, so the verdict
    // rests on records, not on an empty world.
    expect(Object.keys(happy!.finalStateSummary)).toContain('Booking');
    // Decided on those records, not abstained: the confirmation the agent made
    // is seen. (This agent misreads the deposit from the text block and skips
    // the sign-off, which the suite now fails it for — the point here is only
    // that the records were read.)
    expect(happy!.outcome).not.toBe('ABSTAIN');
    expect(
      happy!.assertions.find((a) => a.kind === 'state_change' && a.description.includes('bookingStatus'))?.status,
    ).toBe('PASS');
    // Read back through the connection the agent used: not independent.
    expect(happy!.evidenceIndependence).toBe('SELF_REPORTED');
  }, 300_000);
});

describe('prose is not data, and the probe says so first', () => {
  it('warns before anybody records a job', async () => {
    const project = await connected('prose');
    const configured = await service.configureEnvironment(project.id, READS);
    expect(configured.readsProblem).toMatch(/text back/);
    expect(configured.readsProblem).toMatch(/cannot check the result/);
  }, 60_000);
});
