/**
 * An agent written in Python, graded the same way as one written in anything.
 *
 * The claim is that the protocol is small enough to be a non-event in another
 * language: one line of JSON in, one line out, and an MCP endpoint the agent
 * connects to however it already connects to MCP. If that is true, this test
 * needs no adapter, no bridge and no special case — RigorRun runs a command,
 * and the command happens to be `python3`.
 *
 * The fixture hand-rolls its MCP client rather than taking a dependency. The
 * point being proved is that an agent already speaking MCP needs nothing from
 * RigorRun, and proving it with somebody's SDK would prove something about the
 * SDK instead.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '../src/index.ts';
import type { Project } from '../src/project.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const AGENT = join(root, 'fixtures', 'external', 'python-agent', 'agent.py');
const DESK = {
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  url: '',
  secretNames: [],
};

let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-python-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });

  project = await service.createProject({ name: 'Desk', goal: 'Confirm a held booking.' });
  await service.connectEnvironment(project.id, DESK, 'ephemeral');
  await service.configureEnvironment(project.id, {
    readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
    verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
    reset: { kind: 'tool', tool: 'reset_desk' },
  });
  await service.startTeaching(project.id);
  await service.teachStep(project.id, 'find_bookings', {});
  await service.teachStep(project.id, 'get_booking', { bookingId: 'BKG-4001' });
  await service.teachStep(project.id, 'record_signoff', {
    bookingId: 'BKG-4001',
    approver: 'Dana Whitlock',
  });
  await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
  await service.finishTeaching(project.id);
  await service.answerSchema(project.id, [
    { questionId: 'q_unit_Booking_depositAmount', value: 'currency' },
    { questionId: 'q_role_Booking_signedOffBy', value: 'actor' },
    { questionId: 'q_untrusted_Booking_note', value: 'yes' },
  ]);
  const draft = await service.compile(project.id);
  await service.review(project.id, { confirmedRuleIds: draft.rules.map((rule) => rule.id) });
  await service.generate(project.id);
  project = await store.read(project.id);
}, 180_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('an agent written in Python', () => {
  it('answers a probe, and names itself', async () => {
    const { agent } = await service.addAgent(project.id, {
      name: '',
      command: 'python3',
      args: [AGENT],
    });
    project = await store.read(project.id);
    expect(agent.lastProbeOk).toBe(true);
    // From the agent's own reply, not from the form.
    expect(agent.name).toBe('python-booking-agent');
  }, 60_000);

  it('does the job through the MCP endpoint it was handed', async () => {
    const agent = project.agents.find((entry) => entry.name === 'python-booking-agent')!;
    const result = await service.runAgent(project.id, agent.id);

    // The evidence is the proxy's, so it is identical to an agent written in
    // anything else — which is the whole claim.
    const tools = result.caseResults.flatMap((entry) => entry.steps.map((step) => step.tool));
    expect(tools).toContain('confirm_booking');
    expect(result.verification).toBe('PARTIAL');
    // The desk nominates a reset tool and nothing has called it twice to
    // check, so the honest answer is that it was declared, not measured.
    expect(result.isolation).toBe('DECLARED');
    expect(result.caseResults.length).toBeGreaterThan(0);
  }, 240_000);
});
