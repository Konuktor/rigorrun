/**
 * A production failure becoming a permanent case.
 *
 * This closes the lifecycle. RigorRun's whole argument is that it works
 * *before* there is traffic — somebody demonstrates a job once and gets a
 * suite. Then traffic arrives, and something goes wrong in a way nobody thought
 * to generate. That failure should stop being a bug report somebody closes.
 *
 * What is under test is the discipline, not the plumbing: only the *situation*
 * comes from the incident, and what should have happened is computed from the
 * confirmed rules. A trace is the agent's own record of what it sent, and
 * believing it would mean adding the agent's account of itself to the thing
 * that exists to check the agent's account of itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '../src/index.ts';
import type { Project } from '../src/project.ts';
import type { Benchmark } from '@rigorrun/core';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const DESK = {
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  url: '',
  secretNames: [],
};

const ns = (ms: number): string => String(ms * 1e6);

/** What a runtime emitted while an agent got a booking wrong at 3am. */
const INCIDENT = JSON.stringify({
  resourceSpans: [
    {
      scopeSpans: [
        {
          spans: [
            {
              traceId: 'incident-4021',
              spanId: 'root',
              name: 'confirm a held booking',
              startTimeUnixNano: ns(0),
              endTimeUnixNano: ns(2400),
              status: { code: 2, message: 'confirmed without a sign-off on record' },
            },
            {
              traceId: 'incident-4021',
              spanId: 'a',
              parentSpanId: 'root',
              name: 'execute_tool',
              startTimeUnixNano: ns(100),
              endTimeUnixNano: ns(300),
              attributes: [
                { key: 'gen_ai.tool.name', value: { stringValue: 'get_booking' } },
                {
                  key: 'gen_ai.tool.call.arguments',
                  value: { stringValue: '{"bookingId":"BKG-4002"}' },
                },
              ],
            },
            {
              traceId: 'incident-4021',
              spanId: 'b',
              parentSpanId: 'root',
              name: 'execute_tool',
              startTimeUnixNano: ns(400),
              endTimeUnixNano: ns(2300),
              attributes: [
                { key: 'gen_ai.tool.name', value: { stringValue: 'confirm_booking' } },
                {
                  key: 'gen_ai.tool.call.arguments',
                  value: { stringValue: '{"bookingId":"BKG-4002"}' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;
let casesBefore = 0;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-trace-'));
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
  const benchmark = await service.generate(project.id);
  casesBefore = benchmark.cases.length;
  project = await store.read(project.id);
}, 180_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('reading what a runtime emitted', () => {
  it('says what the agent called, and what went wrong', async () => {
    const trace = service.reviewTrace(INCIDENT);
    expect(trace.traceId).toBe('incident-4021');
    expect(trace.calls.map((call) => call.tool)).toEqual(['get_booking', 'confirm_booking']);
    expect(trace.failures[0]?.message).toMatch(/without a sign-off/);

    // And nothing was added. Reading is a separate act from deciding, because
    // a trace is the agent's own record of what it sent.
    const benchmark = await store.readArtefact<Benchmark>(project.id, 'benchmark');
    expect(benchmark?.cases).toHaveLength(casesBefore);
  });
});

describe('turning it into a case', () => {
  it('works out what should have happened from the rules, not from the trace', async () => {
    const trace = service.reviewTrace(INCIDENT);
    // The situation: what the agent was working on. The only thing taken.
    const request = trace.calls.at(-1)!.args;

    const added = await service.addFailureToSuite(project.id, {
      name: 'the 3am page — booking confirmed without a sign-off',
      reason: 'Reported by the duty manager on 14 March.',
      request,
    });

    expect(added.caseId).toMatch(/^case_incident_/);
    expect(added.cases).toBe(casesBefore + 1);
    // The verdict on this situation came from the confirmed rules. Nothing in
    // the trace said whether the work should have been done.
    expect(typeof added.shouldPerform).toBe('boolean');
  }, 120_000);

  it('is in the suite, and stays there', async () => {
    const benchmark = (await store.readArtefact<Benchmark>(project.id, 'benchmark'))!;
    const added = benchmark.cases.find((entry) => entry.id.startsWith('case_incident_'));

    expect(added).toBeDefined();
    expect(added!.seed.scenarioId).toBe('from-a-real-failure');
    // Checks derived from rules, exactly as a generated case's are — so this
    // is satisfiable by construction rather than by hope.
    expect(added!.checks.length).toBeGreaterThan(0);
    // And the reason it exists is recorded without being allowed to decide
    // anything.
    expect(added!.description).toContain('14 March');
    expect(JSON.stringify(added!.checks)).not.toContain('14 March');
  });

  it('refuses to add one to a project with no suite', async () => {
    const bare = await service.createProject({ name: 'Nothing yet', goal: 'x' });
    await expect(
      service.addFailureToSuite(bare.id, { name: 'x', reason: 'y', request: {} }),
    ).rejects.toThrow(/Build a suite first/);
  });
});
