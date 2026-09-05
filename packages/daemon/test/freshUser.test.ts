/**
 * A person who has never seen this source, from nothing to a verdict.
 *
 * No project, no contract, no benchmark, no bundled environment, no bundled
 * agent. Every step goes through the same service functions the UI and the CLI
 * call, in the order a person would meet them, and the run at the end is the
 * customer's own agent working in the customer's own system.
 *
 * The number this test exists to produce is at the bottom: time from creating a
 * project to a first pass or fail. Everything else is the product working;
 * that is the product being *usable*.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { CAREFUL, CARELESS, runTask } from '../../../fixtures/external/booking-agent/src/agent.ts';
import { ProjectStore, Service, nextSteps, timeToFirstVerdictMs } from '../src/index.ts';
import type { Project } from '../src/project.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
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
const servers: { close: () => Promise<void>; url: string }[] = [];

async function startAgent(behaviour: typeof CAREFUL) {
  const served = await serve(
    defineAgent(
      async ({ task, environment }) => ({
        status: 'completed' as const,
        output: await runTask(environment.mcpUrl, task.inputs, behaviour),
      }),
      { name: 'booking-agent', version: '1.0.0' },
    ),
  );
  servers.push(served);
  return served;
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-fresh-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
}, 60_000);

afterAll(async () => {
  for (const server of servers) await server.close();
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('from nothing', () => {
  it('starts with no projects at all', async () => {
    expect(await service.listProjects()).toEqual([]);
  });

  it('makes one, and is told the first thing to do', async () => {
    project = await service.createProject({
      name: 'Venue desk agent',
      goal: 'Confirm a held booking.',
    });
    expect(project.id).toMatch(/^p_/);

    const steps = nextSteps(project);
    expect(steps[0]?.id).toBe('connect_environment');
  });

  it('connects a system nobody at RigorRun wrote, and sees what is there', async () => {
    const connected = await service.connectEnvironment(project.id, DESK, 'ephemeral');
    project = connected.project;

    expect(connected.serverName).toBe('venue-desk');
    expect(connected.tools.map((tool) => tool.name)).toContain('confirm_booking');
    expect(connected.latencyMs).toBeGreaterThanOrEqual(0);

    // And the connection is only saved because it worked.
    expect((await store.read(project.id)).connector).toMatchObject({ command: DESK.command });
    expect(project.timings.environmentConnectedAt).not.toBeNull();
  }, 60_000);

  it('is told what it still needs before it can verify anything', async () => {
    expect(nextSteps(project).map((step) => step.id)).toEqual([
      'nominate_reads',
      'teach_a_job',
      'generate',
      'connect_agent',
    ]);
  });

  it('takes the operator’s word for what reads, and how to put things back', async () => {
    const configured = await service.configureEnvironment(project.id, {
      readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
      // Only the tools. Which record type each returns is worked out from what
      // they return, because at this moment those types do not exist yet.
      verifierReads: [
        { tool: 'find_bookings' },
        { tool: 'list_venues' },
        { tool: 'list_organisers' },
      ],
      reset: { kind: 'tool', tool: 'reset_desk' },
    });
    project = configured.project;
    expect(project.verifierReads).toHaveLength(3);
    // Nothing to warn about: these reads answer, and they answer with records.
    expect(configured.readsProblem).toBe('');
  });
});

describe('showing it the job once', () => {
  it('records what a person did, and works out what the records are', async () => {
    await service.startTeaching(project.id);

    // Exactly what somebody at the desk would do, through the tools the desk
    // publishes. Reads are watched; only the writes become the job.
    await service.teachStep(project.id, 'find_bookings', {});
    await service.teachStep(project.id, 'list_venues', {});
    await service.teachStep(project.id, 'list_organisers', {});
    await service.teachStep(project.id, 'get_booking', { bookingId: 'BKG-4001' });
    await service.teachStep(project.id, 'record_signoff', {
      bookingId: 'BKG-4001',
      approver: 'Dana Whitlock',
    });
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
    await service.teachStep(project.id, 'get_booking', { bookingId: 'BKG-4001' });

    const finished = await service.finishTeaching(project.id);
    project = finished.project;

    expect(finished.schema.entities.map((entity) => entity.name).sort()).toEqual([
      'Booking',
      'Organiser',
      'Venue',
    ]);
    // And it asks about the things no data could have told it.
    const kinds = new Set(finished.questions.map((question) => question.kind));
    expect(kinds).toContain('unit');
    expect(kinds).toContain('untrusted');
  }, 120_000);

  it('keeps a person’s corrections', async () => {
    project = await service.answerSchema(project.id, [
      { questionId: 'q_unit_Booking_depositAmount', value: 'currency' },
      { questionId: 'q_role_Booking_signedOffBy', value: 'actor' },
      { questionId: 'q_untrusted_Booking_note', value: 'yes' },
    ]);
    expect((await store.read(project.id)).schemaAnswers).toHaveLength(3);
  });
});

describe('ruling on what it learned', () => {
  it('proposes rules and enforces none of them', async () => {
    const draft = await service.compile(project.id);
    expect(draft.rules.length).toBeGreaterThan(0);
    for (const rule of draft.rules) {
      expect(rule.status).not.toBe('confirmed');
      expect(rule.question?.text).toBeTruthy();
    }
  }, 60_000);

  it('refuses to build a suite while a rule is still a guess', async () => {
    await expect(service.generate(project.id)).rejects.toThrow(/waiting on a decision/);
  }, 60_000);

  it('builds one once a person has ruled', async () => {
    const draft = await service.compile(project.id);
    await service.review(project.id, { confirmedRuleIds: draft.rules.map((rule) => rule.id) });

    const benchmark = await service.generate(project.id);
    expect(benchmark.cases.length).toBeGreaterThan(1);
    // And says what it could not cover here, rather than quietly shrinking.
    expect(benchmark.notTestable.length).toBeGreaterThan(0);
    project = await store.read(project.id);
  }, 120_000);
});

describe('connecting an agent and getting an answer', () => {
  it('will not accept an agent that does not answer', async () => {
    const { agent } = await service.addAgent(project.id, {
      name: 'Nobody',
      endpoint: 'http://127.0.0.1:1/',
    });
    expect(agent.lastProbeOk).toBe(false);
    await expect(service.runAgent(project.id, agent.id)).rejects.toThrow(/connection test/);
  }, 60_000);

  it('runs the customer’s own agent and reads the desk back to grade it', async () => {
    const served = await startAgent(CAREFUL);
    const added = await service.addAgent(project.id, {
      name: 'Booking agent',
      endpoint: served.url,
    });
    project = added.project;
    expect(added.agent.lastProbeOk).toBe(true);

    const result = await service.runAgent(project.id, added.agent.id);
    expect(result.caseResults.length).toBeGreaterThan(0);
    expect(result.verification).toBe('PARTIAL');
    expect(result.isolation).toBe('RESET');

    // The agent drove itself through the proxy; these are its own calls.
    const tools = result.caseResults.flatMap((entry) => entry.steps.map((step) => step.tool));
    expect(tools).toContain('confirm_booking');

    project = await store.read(project.id);
    expect(project.runs).toHaveLength(1);
    expect(project.timings.firstVerdictAt).not.toBeNull();
  }, 180_000);

  it('has nothing left to tell this person to do', () => {
    expect(nextSteps(project)).toEqual([]);
  });
});

describe('the reason to come back tomorrow', () => {
  it('names the case that broke when the agent changed', async () => {
    const broken = await startAgent(CARELESS);
    const added = await service.addAgent(project.id, {
      name: 'Booking agent (changed)',
      endpoint: broken.url,
    });
    const after = await service.runAgent(project.id, added.agent.id);

    const comparison = await service.compare(project.id, after.runId);
    expect(comparison.comparable).toBe(true);
    expect(comparison.regressed.length).toBeGreaterThan(0);
    expect(comparison.headline).toMatch(/regressed/);
    // Specific enough to act on, rather than a number that moved.
    expect(comparison.regressed[0]?.detail).toBeTruthy();
  }, 240_000);

  it('reports how long the whole thing took', async () => {
    project = await store.read(project.id);
    const ms = timeToFirstVerdictMs(project);
    expect(ms).not.toBeNull();
    process.stdout.write(
      `\n    time to first real verdict: ${(ms! / 1000).toFixed(1)}s ` +
        `(project created -> own agent graded against own system)\n`,
    );
  });
});
