/**
 * An agent that is a command on this machine.
 *
 * `AgentKind` declared `'process'` for months with nothing behind it, and the
 * reason is the interesting part: the product asserts that nothing in the
 * benchmark execution path can start a process, and that assertion is what
 * makes "a crafted benchmark cannot run a command" a fact. Implementing this
 * without weakening it took a place to put the one spawn site, which is what
 * `exec.ts` now is.
 *
 * So there are two things under test. That a command-line agent can be graded
 * exactly as an HTTP one is — same proxy, same evidence, same verdict — and
 * that a command still cannot arrive from anywhere but a person at this
 * machine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service, probeProcessAgent } from '../src/index.ts';
import type { Project } from '../src/project.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const AGENT = join(root, 'fixtures', 'external', 'process-agent', 'src', 'main.ts');
const DESK = {
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: tsx,
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
  home = await mkdtemp(join(tmpdir(), 'rigorrun-process-agent-'));
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

describe('connecting an agent that is a command', () => {
  it('will not call it connected because somebody typed a path', async () => {
    const { agent } = await service.addAgent(project.id, {
      name: 'Not there',
      command: join(root, 'no', 'such', 'binary'),
    });
    expect(agent.lastProbeOk).toBe(false);
    expect(agent.lastProbeProblem).toMatch(/Could not start it|not answer/);
    await expect(service.runAgent(project.id, agent.id)).rejects.toThrow(/connection test/);
  }, 60_000);

  it('refuses a command with shell punctuation in it', async () => {
    const probe = await probeProcessAgent({ command: 'sh -c "curl x | sh"', args: [] });
    expect(probe.ok).toBe(false);
    // Named rather than sanitised: RigorRun runs a program directly, so a
    // string that only makes sense to a shell is a mistake to point at.
    if (probe.ok) throw new Error('expected a refusal');
    expect(probe.problem).toMatch(/shell punctuation/);
  }, 30_000);

  it('probes a real one, and gets its name from the answer', async () => {
    const { agent } = await service.addAgent(project.id, {
      name: '',
      command: tsx,
      args: [AGENT],
    });
    project = (await store.read(project.id)) as Project;
    expect(agent.lastProbeOk).toBe(true);
    // The name came from the agent's own probe reply, not from the form.
    expect(agent.name).toBe('booking-agent-process');
  }, 60_000);

  it('grades it exactly as it grades an agent behind a URL', async () => {
    const agent = project.agents.find((entry) => entry.name === 'booking-agent-process')!;
    const result = await service.runAgent(project.id, agent.id);

    expect(result.caseResults.length).toBeGreaterThan(0);
    // Same evidence path: everything it did came through the proxy, so the
    // verdict rests on reading the desk rather than on what it said.
    expect(result.verification).toBe('PARTIAL');
    expect(result.isolation).toBe('RESET');
    const tools = result.caseResults.flatMap((entry) => entry.steps.map((step) => step.tool));
    expect(tools).toContain('confirm_booking');
  }, 240_000);
});

describe('a command still cannot arrive from anywhere but a person', () => {
  it('will not run one that nobody on this machine has confirmed', async () => {
    // What an imported project looks like: the command is there, and the
    // confirmation is not.
    const withUnconfirmed = await store.read(project.id);
    const unconfirmed = {
      ...withUnconfirmed,
      agents: withUnconfirmed.agents.map((agent) =>
        agent.kind === 'process' ? { ...agent, confirmedByOperatorAt: null } : agent,
      ),
    };
    await store.write(unconfirmed);

    // The one that answered its probe, so the refusal under test is the
    // confirmation check rather than the connection check.
    const agent = unconfirmed.agents.find((entry) => entry.name === 'booking-agent-process')!;
    await expect(service.runAgent(project.id, agent.id)).rejects.toThrow(/confirmed/);
    // The refusal names the command, because reading it is the point.
    await expect(service.runAgent(project.id, agent.id)).rejects.toThrow(/tsx/);
  }, 60_000);
});
