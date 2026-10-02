/**
 * A pack for testing the daemon's side of packs: a connector, a session per
 * connection, a suite the pack writes itself, and a command line of its own.
 *
 * Built on the runner's in-memory fake (a Record holds Items), so the names
 * mean nothing and nothing here could pass by understanding a business. What
 * this adds is what the daemon touches: the credential the pack asks for, how
 * often it is opened and closed, and the suite it ships.
 */
import { createServer, type Server } from 'node:http';
import {
  BENCHMARK_SCHEMA_VERSION,
  ENVIRONMENT_CONTRACT_SCHEMA_VERSION,
  type ContractRule,
  type EnvironmentContract,
} from '@rigorrun/core';
import type { PackDefinition, PackOpenOptions, SafetyMode } from '@rigorrun/environment';
import {
  FAKE_SCHEMA,
  fakeCase,
  fakeSession,
  type FakeSession,
} from '../../runner/test/fakePack.ts';

export const PACK_ID = 'fake-items';
export const DEFAULT_KEY_SECRET = 'fake_items_key';

export interface FakeItemsPack {
  pack: PackDefinition;
  /** Every session opened, in order. One per connection, never one per case. */
  sessions: FakeSession[];
  /** What each open was handed, minus the lookup itself. */
  opened: Omit<PackOpenOptions, 'secret'>[];
  /** The credential each open was given, as the pack received it. */
  keys: (string | undefined)[];
  closed: number;
  cliCalls: string[][];
}

const rule = (id: string, statement: string): ContractRule => ({
  id,
  statement,
  template: 'target_state',
  status: 'inferred',
  confidence: 0.6,
  provenance: [{ kind: 'developer_rule', ref: PACK_ID, detail: 'written with the pack' }],
  implications: [],
  generatedAssertions: [],
  generatedCases: [],
  predicate: {
    kind: 'row_constraint',
    entity: 'Item',
    scope: 'created',
    when: [],
    then: [{ field: 'units', op: 'eq', value: 5, describe: 'the item has the units asked for' }],
  },
});

/** The suite the pack ships: three cases, each check citing a rule except one. */
export function packSuite(): { contract: EnvironmentContract; benchmark: unknown } {
  const contract: EnvironmentContract = {
    schemaVersion: ENVIRONMENT_CONTRACT_SCHEMA_VERSION,
    id: 'ec_fake_items',
    name: 'Add what was asked',
    description: '',
    goal: 'Add one item of the size asked for to the record named.',
    environmentId: PACK_ID,
    primaryAction: 'addItem',
    focusEntity: 'Item',
    focusScope: 'created',
    remedyActions: [],
    completionActions: [],
    demonstratedArgs: {},
    projectionFocus: ['Item'],
    observedFacts: [],
    argumentBindings: [],
    rules: [
      rule('items.exact', 'An item of exactly the size asked for is added.'),
      rule('items.no_other', 'No item of any other size is added.'),
    ],
    successAssertions: [],
    policyAssertions: [],
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  const cases = ['case_a', 'case_b', 'case_c'].map((id) => {
    const base = fakeCase({ id, name: `Add one item (${id})` }) as {
      checks: Record<string, unknown>[];
    };
    return {
      ...base,
      checks: base.checks.map((check) =>
        check['id'] === 'added'
          ? { ...check, ruleId: 'items.exact' }
          : check['id'] === 'no_other_size'
            ? { ...check, ruleId: 'items.no_other' }
            : check,
      ),
    };
  });
  return {
    contract,
    benchmark: {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      id: 'bm_fake_items',
      name: 'Fake items suite',
      environment: PACK_ID,
      contractId: contract.id,
      contractHash: 'written-by-the-pack',
      createdAt: '2026-10-01T00:00:00.000Z',
      cases,
    },
  };
}

export function fakeItemsPack(
  options: { sessionSafety?: SafetyMode; cliExit?: number; replacedWorld?: boolean } = {},
): FakeItemsPack {
  const handle: FakeItemsPack = {
    pack: undefined as unknown as PackDefinition,
    sessions: [],
    opened: [],
    keys: [],
    closed: 0,
    cliCalls: [],
  };
  handle.pack = {
    id: PACK_ID,
    name: 'Fake items',
    description: 'Records that hold items, in memory.',
    schema: FAKE_SCHEMA,
    async open(opened) {
      const { secret, ...rest } = opened;
      handle.opened.push(rest);
      // Asked before anything is created, as a real pack's key guard asks.
      const key = secret(opened.keySecret ?? DEFAULT_KEY_SECRET);
      handle.keys.push(key);
      if (key === undefined) throw new Error('No key for the fake system.');
      const made = fakeSession({
        safety: options.sessionSafety ?? 'ephemeral',
        simulated: true,
      });
      const session = options.replacedWorld
        ? Object.assign(made, { isolation: 'replaced-world' as const, completeRead: true })
        : made;
      const close = session.close.bind(session);
      session.close = async () => {
        handle.closed += 1;
        await close();
      };
      handle.sessions.push(session);
      return session;
    },
    describeAction: (config) =>
      `call the fake system (${config.mode}) with the key in ${config.keySecret ?? DEFAULT_KEY_SECRET}`,
    suite: () => packSuite() as ReturnType<NonNullable<PackDefinition['suite']>>,
    async cli(argv) {
      handle.cliCalls.push([...argv]);
      return options.cliExit ?? 0;
    },
  };
  return handle;
}

/**
 * A black-box agent on loopback that adds `units` to the record its task
 * names, writing to the fake system directly — never through RigorRun.
 */
export function blackBoxAgent(
  world: () => FakeSession,
  units: number,
  servers: Server[],
): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => (text += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.method !== 'POST') return res.end('{}');
        const body = JSON.parse(text) as {
          probe?: boolean;
          task?: { inputs: Record<string, unknown> };
        };
        if (body.probe) return res.end(JSON.stringify({ ok: true }));
        const record = String(body.task?.inputs['record'] ?? '');
        if (units > 0) world().world.addItem(record, units);
        res.end(
          JSON.stringify({ status: 'completed', output: `Added one item of ${units} units.` }),
        );
      });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
    });
  });
}
