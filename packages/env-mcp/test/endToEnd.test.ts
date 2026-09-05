/**
 * The whole loop, against a server RigorRun did not write.
 *
 * Connect. Watch a person do the job once. Work out what the records are. Let
 * the person correct it. Compile a contract. Generate a suite. Run an agent.
 * Read the system back and grade what actually happened.
 *
 * Nothing here is bundled: the environment is a separate npm package spawned as
 * a child process, and it is reached over a real protocol. If this passes,
 * RigorRun works on somebody else's system. If it does not, everything upstream
 * of it is machinery in search of a use.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  McpConnection,
  applySchemaAnswers,
  induceSchema,
  type PayloadObservation,
  type SchemaAnswer,
} from '@rigorrun/mcp';
import {
  clearEnvironments,
  registerEnvironment,
  type EnvironmentFixture,
} from '@rigorrun/environment';
import { applyReview, fromActionLog, rulesAwaitingReview } from '@rigorrun/core';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark, createReferenceAgent } from '@rigorrun/generator';
import { runBenchmark } from '@rigorrun/runner';
import { McpEnvironment, type McpEnvironmentConfig } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Read-only as far as the *operator* is concerned, not as far as the server claims. */
const READ_ONLY = ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'];

const CONFIG: McpEnvironmentConfig = {
  id: 'venue-desk',
  name: 'Venue desk',
  description: 'A booking system reached over MCP.',
  verifierReads: [
    { tool: 'find_bookings', entity: 'Booking' },
    { tool: 'list_venues', entity: 'Venue' },
    { tool: 'list_organisers', entity: 'Organiser' },
  ],
  reset: { kind: 'tool', tool: 'reset_desk' },
  safety: 'ephemeral',
  readOnlyTools: READ_ONLY,
};

/**
 * What a person answers on the "review what RigorRun learned" screen.
 *
 * Three of these are things no amount of data could have revealed: that the
 * deposit is money, that a sign-off names a person, and that the note is
 * written by somebody outside the organisation. The last is the one with teeth
 * — it is what tells RigorRun where to put an injection payload.
 */
const ANSWERS: SchemaAnswer[] = [
  { questionId: 'q_unit_Booking_depositAmount', value: 'currency' },
  { questionId: 'q_role_Booking_signedOffBy', value: 'actor' },
  { questionId: 'q_untrusted_Booking_note', value: 'yes' },
  { questionId: 'q_role_Booking_note', value: 'freetext' },
  { questionId: 'q_rel_Booking_venueId', value: 'required' },
  { questionId: 'q_rel_Booking_organiserId', value: 'required' },
];

interface Built {
  connection: McpConnection;
  environment: McpEnvironment;
  fixture: EnvironmentFixture;
  outstanding: number;
  contract: Awaited<ReturnType<typeof compile>>['contract'];
  benchmark: Awaited<ReturnType<typeof generateBenchmark>>['benchmark'];
}

async function compile(environment: McpEnvironment, trace: ReturnType<typeof fromActionLog>) {
  const draft = induceContract(environment, trace, {
    contractId: 'ec_venue',
    createdAt: '2026-02-01T09:00:00.000Z',
  }).contract;
  const contract = applyReview(draft, {
    confirmedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id),
  });
  return { draft, contract };
}

let built: Built;

beforeAll(async () => {
  const connection = await McpConnection.open({
    transport: 'stdio',
    command: join(root, 'node_modules', '.bin', 'tsx'),
    args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  });

  // --- the person does the job once, and RigorRun watches ------------------
  const observations: PayloadObservation[] = [];
  const watch = async (tool: string, args: Record<string, unknown> = {}) => {
    const result = await connection.call(tool, args);
    if (result.structured !== undefined) observations.push({ tool, payload: result.structured });
    return result;
  };

  await connection.call('reset_desk', {});
  await watch('list_venues');
  await watch('list_organisers');
  await watch('find_bookings');
  await watch('get_booking', { bookingId: 'BKG-4001' });
  await watch('record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
  await watch('confirm_booking', { bookingId: 'BKG-4001' });
  await watch('get_booking', { bookingId: 'BKG-4001' });

  // --- what RigorRun learned, and what the person corrected ----------------
  const induced = induceSchema(observations);
  const { schema, outstanding } = applySchemaAnswers(induced, ANSWERS);

  const environment = new McpEnvironment(connection, schema, CONFIG);
  clearEnvironments();

  // --- the world these cases start from ------------------------------------
  await environment.reset();
  const before = await environment.getState();

  const fixture: EnvironmentFixture = {
    id: 'desk',
    title: 'The desk as reset leaves it',
    summary: 'Whatever the reset tool restores.',
    state: before,
    config: {},
    request: { bookingId: 'BKG-4001', approver: 'Dana Whitlock' },
  };

  registerEnvironment({
    id: CONFIG.id,
    name: CONFIG.name,
    description: CONFIG.description,
    fixtures: [fixture],
    create: () => new McpEnvironment(connection, schema, CONFIG),
  });

  // --- the demonstration, replayed against the real system ------------------
  await environment.reset();
  const demoBefore = await environment.getState();
  await environment.executeAction('record_signoff', {
    bookingId: 'BKG-4001',
    approver: 'Dana Whitlock',
  });
  await environment.executeAction('confirm_booking', { bookingId: 'BKG-4001' });
  const demoAfter = await environment.getState();

  const trace = fromActionLog(
    [
      {
        at: 0,
        action: 'record_signoff',
        args: { bookingId: 'BKG-4001', approver: 'Dana Whitlock' },
      },
      { at: 1000, action: 'confirm_booking', args: { bookingId: 'BKG-4001' } },
    ],
    {
      environmentId: CONFIG.id,
      id: 'trace_venue',
      name: 'Confirm a held booking',
      before: demoBefore,
      after: demoAfter,
    },
  );

  const { contract } = await compile(environment, trace);
  const { benchmark } = await generateBenchmark(
    new McpEnvironment(connection, schema, CONFIG),
    contract,
    [fixture],
  );

  built = {
    connection,
    environment,
    fixture,
    outstanding: outstanding.length,
    contract,
    benchmark,
  };
}, 180_000);

describe('an environment RigorRun was pointed at rather than shipped with', () => {
  it('knows exactly how much it can and cannot do', () => {
    expect(built.environment.capabilities()).toEqual({
      discovery: 'tools-only',
      stateRead: 'designated-reads',
      seed: 'none',
      reset: 'tool',
      events: 'proxy-log',
      safety: 'ephemeral',
    });
  });

  it('will not vouch for a tool just because the server did', () => {
    const actions = built.environment.getActions();
    const readOnly = actions.filter((action) => action.readOnly).map((action) => action.name).sort();
    expect(readOnly).toEqual([...READ_ONLY].sort());

    // The server annotated `reset_desk` and `confirm_booking`; neither is on
    // the operator's list, so both count as writing.
    expect(actions.find((a) => a.name === 'confirm_booking')?.readOnly).toBe(false);
    expect(actions.find((a) => a.name === 'reset_desk')?.readOnly).toBe(false);
  });

  it('reads the system back through the nominated reads', async () => {
    await built.environment.reset();
    const state = await built.environment.getState();
    expect(Object.keys(state.entities).sort()).toEqual(['Booking', 'Organiser', 'Venue']);
    expect(state.entities['Booking']?.['BKG-4001']).toMatchObject({
      bookingStatus: 'held',
      depositAmount: 900,
      signedOffBy: null,
    });
  });

  it('puts the system back, so one case cannot poison the next', async () => {
    await built.environment.reset();
    await built.environment.executeAction('confirm_booking', { bookingId: 'BKG-4002' });
    const dirty = await built.environment.getState();
    expect(dirty.entities['Booking']?.['BKG-4002']).toMatchObject({
      bookingStatus: 'confirmed',
    });

    await built.environment.reset();
    const clean = await built.environment.getState();
    expect(clean.entities['Booking']?.['BKG-4002']).toMatchObject({ bookingStatus: 'held' });
  });
});

describe('a benchmark built from one demonstration on that system', () => {
  it('builds cases out of the situations the system already contains', () => {
    // Nothing can be installed here, so nothing was. Every case beyond the
    // demonstrated one is a different record that was already sitting in the
    // desk — including the booking carrying text an outsider wrote, and the one
    // somebody had already confirmed.
    expect(built.benchmark.cases.length).toBeGreaterThan(3);
    const names = built.benchmark.cases.map((entry) => entry.name);
    expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/BKG-4004/)]));
    expect(new Set(built.benchmark.cases.map((entry) => entry.category)).size).toBeGreaterThan(1);
  });

  it('never claims a case started from a world it could not install', () => {
    // The seed on every case is the world the reset produces, and the runner
    // is told not to install it. A case that recorded a different starting
    // state would be describing something that never happened.
    for (const testCase of built.benchmark.cases) {
      expect(testCase.seed.state).toEqual(built.fixture.state);
    }
  });

  it('says which coverage this system cost it, rather than quietly shrinking', () => {
    // Everything needing a world that cannot be installed is named here.
    expect(built.benchmark.notTestable.length).toBeGreaterThan(0);
    const reasons = built.benchmark.notTestable.map((entry) => entry.reason).join(' ');
    expect(reasons).toMatch(/cannot put it in|cannot be seeded|worked out from what came back/);
  });

  it('learned rules from the demonstration rather than from a fixture', () => {
    expect(built.contract.rules.length).toBeGreaterThan(0);
    // The contract is about this system's records, which RigorRun had never
    // heard of an hour ago.
    const text = built.contract.rules.map((rule) => rule.statement).join(' ');
    expect(text).toMatch(/Booking|booking/);
  });
});

describe('grading an agent on it', () => {
  it('reads the real system afterwards, and labels how sure it is', async () => {
    const reference = createReferenceAgent(built.benchmark);
    const result = await runBenchmark(built.benchmark, [reference], { runId: 'run_venue' });

    // The verdict rests on what the desk said afterwards, through the reads the
    // operator nominated — which is genuinely partial, and says so.
    expect(result.verification).toBe('PARTIAL');
    expect(result.isolation).toBe('RESET');
    expect(result.caseResults.length).toBe(built.benchmark.cases.length);

    const limits = result.limits.map((limit) => limit.id);
    expect(limits).toEqual(expect.arrayContaining(['partial_state_read', 'no_seed']));
  }, 120_000);
});
