/**
 * The product loop, with nothing of RigorRun's on either side.
 *
 * The environment is a separate package reached over MCP. The agent is a
 * separate package reached over HTTP, which drives itself through the proxy
 * using its own MCP client. RigorRun supplies the cases, the channel and the
 * verdict, and reads the desk afterwards to decide what happened.
 *
 * Then the agent is broken on purpose and run again, and RigorRun has to say
 * so without being told what changed. That last part is the reason anybody
 * would come back tomorrow.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { McpConnection, applySchemaAnswers, induceSchema, type PayloadObservation } from '@rigorrun/mcp';
import { clearEnvironments, registerEnvironment, type EnvironmentFixture } from '@rigorrun/environment';
import { applyReview, fromActionLog, rulesAwaitingReview, type Benchmark } from '@rigorrun/core';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { runBenchmark } from '@rigorrun/runner';
import { createHttpV2Agent, probeAgent } from '@rigorrun/agents';
import { ProxyServer } from '@rigorrun/proxy';
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { CARELESS, CAREFUL, runTask } from '../../../fixtures/external/booking-agent/src/agent.ts';
import { McpEnvironment, type McpEnvironmentConfig } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

const CONFIG: McpEnvironmentConfig = {
  id: 'venue-desk-agent',
  name: 'Venue desk',
  description: 'A booking system reached over MCP.',
  verifierReads: [
    { tool: 'find_bookings', entity: 'Booking' },
    { tool: 'list_venues', entity: 'Venue' },
    { tool: 'list_organisers', entity: 'Organiser' },
  ],
  reset: { kind: 'tool', tool: 'reset_desk' },
  safety: 'ephemeral',
  readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
};

let connection: McpConnection;
let proxy: ProxyServer;
let benchmark: Benchmark;
const servers: { close: () => Promise<void> }[] = [];

/** Starts the customer's agent, in one behaviour or the other. */
async function startAgent(behaviour: typeof CAREFUL) {
  const agent = defineAgent(
    async ({ task, environment }) => ({
      status: 'completed' as const,
      output: await runTask(environment.mcpUrl, task.inputs, behaviour),
    }),
    { name: 'booking-agent', version: '1.0.0' },
  );
  const served = await serve(agent);
  servers.push(served);
  return served;
}

beforeAll(async () => {
  connection = await McpConnection.open({
    transport: 'stdio',
    command: join(root, 'node_modules', '.bin', 'tsx'),
    args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  });
  proxy = new ProxyServer();
  await proxy.start();

  const observations: PayloadObservation[] = [];
  const watch = async (tool: string, args: Record<string, unknown> = {}) => {
    const result = await connection.call(tool, args);
    if (result.structured !== undefined) observations.push({ tool, payload: result.structured });
  };

  await connection.call('reset_desk', {});
  for (const tool of ['list_venues', 'list_organisers', 'find_bookings']) await watch(tool);
  await watch('get_booking', { bookingId: 'BKG-4001' });
  await watch('record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
  await watch('confirm_booking', { bookingId: 'BKG-4001' });
  await watch('get_booking', { bookingId: 'BKG-4001' });

  const { schema } = applySchemaAnswers(induceSchema(observations), [
    { questionId: 'q_unit_Booking_depositAmount', value: 'currency' },
    { questionId: 'q_role_Booking_signedOffBy', value: 'actor' },
    { questionId: 'q_untrusted_Booking_note', value: 'yes' },
  ]);

  const build = () => new McpEnvironment(connection, schema, CONFIG);
  const environment = build();
  clearEnvironments();

  await environment.reset();
  const world = await environment.getState();
  const fixture: EnvironmentFixture = {
    id: 'desk',
    title: 'The desk as reset leaves it',
    summary: 'Whatever the reset tool restores.',
    state: world,
    config: {},
    request: { bookingId: 'BKG-4001', approver: 'Dana Whitlock' },
  };
  registerEnvironment({ ...CONFIG, fixtures: [fixture], create: build });

  await environment.reset();
  const before = await environment.getState();
  await environment.executeAction('record_signoff', {
    bookingId: 'BKG-4001',
    approver: 'Dana Whitlock',
  });
  await environment.executeAction('confirm_booking', { bookingId: 'BKG-4001' });
  const after = await environment.getState();

  const trace = fromActionLog(
    [
      { at: 0, action: 'record_signoff', args: { bookingId: 'BKG-4001', approver: 'Dana Whitlock' } },
      { at: 1000, action: 'confirm_booking', args: { bookingId: 'BKG-4001' } },
    ],
    {
      environmentId: CONFIG.id,
      id: 'trace_agent',
      name: 'Confirm a held booking',
      before,
      after,
    },
  );

  const draft = induceContract(build(), trace, {
    contractId: 'ec_agent',
    createdAt: '2026-02-01T09:00:00.000Z',
  }).contract;
  const contract = applyReview(draft, {
    confirmedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id),
  });
  benchmark = (await generateBenchmark(build(), contract, [fixture])).benchmark;
}, 180_000);

afterAll(async () => {
  for (const server of servers) await server.close();
  await proxy?.stop();
  await connection?.close();
  clearEnvironments();
});

describe('connecting an agent nobody at RigorRun wrote', () => {
  it('will not call it connected until it answers', async () => {
    const served = await startAgent(CAREFUL);
    const good = await probeAgent({ endpoint: served.url });
    expect(good).toMatchObject({ ok: true, name: 'booking-agent', version: '1.0.0' });

    // A URL that parses is not a connection. This is the check that stops an
    // agent being marked CONNECTED because somebody typed something plausible.
    const dead = await probeAgent({ endpoint: 'http://127.0.0.1:1/' });
    expect(dead.ok).toBe(false);
  }, 60_000);

  it('refuses an endpoint off this machine unless somebody says otherwise', async () => {
    const remote = await probeAgent({ endpoint: 'https://agent.example.com/run' });
    expect(remote).toMatchObject({ ok: false });
    expect((remote as { problem: string }).problem).toMatch(/loopback|remote/i);
  }, 30_000);
});

describe('running the customer’s agent against the customer’s system', () => {
  it('drives itself through the proxy, and the desk is read back to grade it', async () => {
    const served = await startAgent(CAREFUL);
    const agent = createHttpV2Agent({
      id: 'booking-agent',
      name: 'Booking agent',
      endpoint: served.url,
      proxy,
    });

    const result = await runBenchmark(benchmark, [agent], { runId: 'run_careful' });

    expect(result.verification).toBe('PARTIAL');
    expect(result.caseResults).toHaveLength(benchmark.cases.length);

    // It really went through the proxy: the steps recorded are the agent's own
    // MCP calls, arriving on the case's bounded channel.
    const steps = result.caseResults.flatMap((entry) => entry.steps);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((step) => step.tool)).toEqual(
      expect.arrayContaining(['get_booking', 'confirm_booking']),
    );

    // And the verdict does not rest on what it said about itself.
    const reports = result.caseResults.map((entry) => entry.agentReport).join(' ');
    expect(reports).toMatch(/Confirmed|already confirmed|cancelled/);
  }, 180_000);
});

describe('a regression the customer introduced', () => {
  it('is caught by comparing two runs, without being told what changed', async () => {
    const careful = await startAgent(CAREFUL);
    const careless = await startAgent(CARELESS);

    const before = await runBenchmark(
      benchmark,
      [createHttpV2Agent({ id: 'a', name: 'Booking agent', endpoint: careful.url, proxy })],
      { runId: 'run_before' },
    );
    const after = await runBenchmark(
      benchmark,
      [createHttpV2Agent({ id: 'a', name: 'Booking agent', endpoint: careless.url, proxy })],
      { runId: 'run_after' },
    );

    const scoreOf = (run: typeof before) => run.scores[0]!;
    // The careless build stops recording a sign-off before confirming a
    // deposit over the limit. Nothing told RigorRun that; it read the desk.
    expect(scoreOf(after).policyComplianceRate).toBeLessThan(scoreOf(before).policyComplianceRate);

    // And the failure points at a specific case rather than a lower number.
    const regressed = after.caseResults.filter((entry) => {
      const was = before.caseResults.find((other) => other.caseId === entry.caseId);
      return was?.policyCompliant === true && entry.policyCompliant === false;
    });
    expect(regressed.length).toBeGreaterThan(0);

    process.stdout.write(
      `\n    regression: policy compliance ${(scoreOf(before).policyComplianceRate * 100).toFixed(1)}%` +
        ` -> ${(scoreOf(after).policyComplianceRate * 100).toFixed(1)}%,` +
        ` unsafe ${scoreOf(before).unsafeActions} -> ${scoreOf(after).unsafeActions},` +
        ` ${regressed.length} case(s) regressed: ${regressed.map((r) => r.caseId).join(', ')}\n`,
    );
  }, 240_000);
});
