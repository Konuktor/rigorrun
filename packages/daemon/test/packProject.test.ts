/**
 * A project connected through a pack, from the connector to a verdict.
 *
 * The pack is a fake that knows nothing about any business (a Record holds
 * Items). What is under test is the daemon's side: a pack connector is stored
 * and described like any other, one session is opened per connection and a
 * fresh adapter is built per case over it, the credential reaches the pack
 * without ever being in the project, production is refused wherever a case's
 * records would be made, the pack's own suite is installed with only confirmed
 * rules able to fail an agent, and a run can be narrowed to named cases.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hashValue,
  type Benchmark,
  type EnvironmentContract,
  type RunResult,
} from '@rigorrun/core';
import {
  PackEnvironment,
  clearPacks,
  createEnvironment,
  registerPack,
  type EnvironmentSchema,
} from '@rigorrun/environment';
import { ProxyServer } from '@rigorrun/proxy';
import {
  ConnectorSchema,
  ProjectStore,
  Service,
  describeConnector,
  describeConnectorAction,
  nextSteps,
  secretNamesOf,
  selectCases,
  stricterSafety,
  type Project,
} from '../src/index.ts';
import {
  DEFAULT_KEY_SECRET,
  PACK_ID,
  blackBoxAgent,
  fakeItemsPack,
  type FakeItemsPack,
} from './packFixture.ts';

const EMPTY_SCHEMA: EnvironmentSchema = { entities: [], relationships: [] };

let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let fake: FakeItemsPack;
const servers: Server[] = [];

beforeAll(async () => {
  proxy = new ProxyServer();
  await proxy.start();
});

afterAll(async () => {
  await proxy?.stop();
});

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-pack-project-'));
  store = new ProjectStore(home);
  service = new Service({ store, proxy });
  fake = fakeItemsPack();
  registerPack(fake.pack);
});

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  await service.workspace.close();
  clearPacks();
  delete process.env['RIGORRUN_SECRET__FAKE_ITEMS_KEY'];
  await rm(home, { recursive: true, force: true });
});

async function packProject(
  safety: Project['safety'] = 'ephemeral',
  connector: Record<string, unknown> = {},
): Promise<Project> {
  const project = await service.createProject({ name: 'Items', goal: 'Add what was asked.' });
  return (
    await service.connectEnvironment(
      project.id,
      { kind: 'pack', pack: PACK_ID, mode: 'twin', ...connector } as Parameters<
        Service['connectEnvironment']
      >[1],
      safety,
    )
  ).project;
}

describe('a pack connector, as a project stores it', () => {
  it('is accepted with a pack and a mode, and nothing else is required', () => {
    const parsed = ConnectorSchema.parse({
      kind: 'pack',
      pack: PACK_ID,
      mode: 'live',
      keySecret: 'my_key',
    });
    expect(parsed).toEqual({ kind: 'pack', pack: PACK_ID, mode: 'live', keySecret: 'my_key' });
  });

  it('refuses one without a mode, with a mode it does not know, or without a pack', () => {
    expect(ConnectorSchema.safeParse({ kind: 'pack', pack: PACK_ID }).success).toBe(false);
    expect(
      ConnectorSchema.safeParse({ kind: 'pack', pack: PACK_ID, mode: 'sandbox' }).success,
    ).toBe(false);
    expect(ConnectorSchema.safeParse({ kind: 'pack', pack: '', mode: 'twin' }).success).toBe(false);
  });

  it('cannot carry a command, a header or a credential value', () => {
    const parsed = ConnectorSchema.parse({
      kind: 'pack',
      pack: PACK_ID,
      mode: 'twin',
      command: '/bin/sh',
      headers: { authorization: 'secret_name' },
    });
    expect(parsed).not.toHaveProperty('command');
    expect(parsed).not.toHaveProperty('headers');
  });

  it('names the one credential it uses, and none when the pack default applies', () => {
    expect(
      secretNamesOf(
        ConnectorSchema.parse({ kind: 'pack', pack: PACK_ID, mode: 'twin', keySecret: 'k' }),
      ),
    ).toEqual(['k']);
    expect(
      secretNamesOf(ConnectorSchema.parse({ kind: 'pack', pack: PACK_ID, mode: 'twin' })),
    ).toEqual([]);
  });

  it('is described by the pack itself, and still described when this build lacks the pack', () => {
    const connector = ConnectorSchema.parse({
      kind: 'pack',
      pack: PACK_ID,
      mode: 'twin',
      keySecret: 'k',
    });
    expect(describeConnector(connector)).toBe('Pack · Fake items · local twin');
    expect(describeConnectorAction(connector)).toBe(
      'call the fake system (twin) with the key in k',
    );

    const missing = ConnectorSchema.parse({
      kind: 'pack',
      pack: 'not-in-this-build',
      mode: 'live',
    });
    expect(describeConnector(missing)).toBe('Pack · not-in-this-build · live');
    expect(describeConnectorAction(missing)).toMatch(/does not include/);
  });

  it('asks for no reads and no demonstration, only the pack’s suite and an agent', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject();
    expect(nextSteps(project).map((step) => step.id)).toEqual(['install_suite', 'connect_agent']);
  });
});

describe('a pack connection', () => {
  it('opens one session, hands over the named credential, and lists the pack’s operations', async () => {
    await store.setSecret('my_key', 'k-value');
    const project = await service.createProject({ name: 'Items' });
    const connected = await service.connectEnvironment(
      project.id,
      {
        kind: 'pack',
        pack: PACK_ID,
        mode: 'twin',
        keySecret: 'my_key',
        options: { flavour: 'plain' },
      },
      'ephemeral',
    );
    expect(fake.opened).toEqual([
      { mode: 'twin', baseUrl: undefined, keySecret: 'my_key', options: { flavour: 'plain' } },
    ]);
    expect(fake.keys).toEqual(['k-value']);
    expect(connected.serverName).toBe('The fake system');
    expect(connected.tools.map((tool) => tool.name)).toEqual(['addItem']);
    expect(connected.tools[0]?.risk.level).toBe('write');
    // The value never reaches the project.
    expect(JSON.stringify(await store.read(project.id))).not.toContain('k-value');
  });

  it('finds the pack’s default credential in the store, or in the environment when nothing is stored', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'stored-default');
    await packProject();
    expect(fake.keys).toEqual(['stored-default']);

    await service.workspace.close();
    await store.deleteSecret(DEFAULT_KEY_SECRET);
    process.env['RIGORRUN_SECRET__FAKE_ITEMS_KEY'] = 'from-ci';
    await packProject();
    expect(fake.keys).toEqual(['stored-default', 'from-ci']);
  });

  it('fails to connect, and stores nothing, when the pack has no credential', async () => {
    const project = await service.createProject({ name: 'Items' });
    await expect(
      service.connectEnvironment(
        project.id,
        { kind: 'pack', pack: PACK_ID, mode: 'twin' },
        'ephemeral',
      ),
    ).rejects.toThrow(/No key/);
    expect((await store.read(project.id)).connector).toBeNull();
  });

  it('builds a fresh adapter per case over the one session, and closes the session once', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject();
    const first = service.workspace.environment(project, EMPTY_SCHEMA);
    const second = service.workspace.environment(project, EMPTY_SCHEMA);
    expect(first).toBeInstanceOf(PackEnvironment);
    expect(second).not.toBe(first);
    // The pack's schema, whatever was asked for: a pack declares its records.
    expect(first.describeEntities().entities.map((entity) => entity.name)).toEqual([
      'Record',
      'Item',
    ]);

    const ctx = { runId: 'run_1', agentId: 'agent_1', attempt: 0 };
    const a = await first.materialize!({ recipe: {} }, { ...ctx, caseId: 'case_a' });
    const b = await second.materialize!({ recipe: {} }, { ...ctx, caseId: 'case_b' });
    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0]!.made.map((made) => made.ctx.caseId)).toEqual(['case_a', 'case_b']);
    // Each adapter holds only its own case's scope.
    expect(Object.keys((await first.getState()).entities['Record'] ?? {})).toEqual([
      a.bindings['record'],
    ]);
    expect(Object.keys((await second.getState()).entities['Record'] ?? {})).toEqual([
      b.bindings['record'],
    ]);

    await service.workspace.close();
    expect(fake.closed).toBe(1);
  });

  it('holds the session to the project’s safety when that is stricter, and refuses every write on production', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject('production');
    const environment = service.workspace.environment(project, EMPTY_SCHEMA);
    // The pack said ephemeral; the person said production; production stands.
    expect(environment.capabilities().safety).toBe('production');
    await expect(
      environment.materialize!(
        { recipe: {} },
        { runId: 'r', caseId: 'c', agentId: 'a', attempt: 0 },
      ),
    ).rejects.toThrow(/production/);
    const refused = await environment.executeAction('addItem', { record: 'rec_0001', units: 5 });
    expect(refused).toMatchObject({ ok: false, error: { code: 'WRITE_REFUSED' } });
    expect(fake.sessions[0]!.made).toEqual([]);
    expect(fake.sessions[0]!.executed).toEqual([]);
  });

  it('keeps the pack’s own safety when it is the stricter one', () => {
    expect(stricterSafety('staging', 'ephemeral')).toBe('staging');
    expect(stricterSafety('ephemeral', 'production')).toBe('production');
  });

  it('refuses a demonstration, nominated reads, compiling and generating', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject();
    await expect(service.startTeaching(project.id)).rejects.toThrow(/ships its own suite/);
    await expect(
      service.configureEnvironment(project.id, {
        readOnlyTools: [],
        verifierReads: [{ tool: 'addItem' }],
        reset: { kind: 'none' },
      }),
    ).rejects.toThrow(/no nominated reads/);
    await expect(service.compile(project.id)).rejects.toThrow(/ships its own suite/);
    await expect(service.generate(project.id)).rejects.toThrow(/ships its own suite/);
    // Budgets still apply.
    const configured = await service.configureEnvironment(project.id, {
      readOnlyTools: [],
      verifierReads: [],
      reset: { kind: 'none' },
      budgets: { caseMs: 90_000 },
    });
    expect(configured.project.budgets.caseMs).toBe(90_000);
    expect(configured.readsProblem).toBe('');
  });
});

describe('installing a pack’s suite', () => {
  it('stores it where a generated suite goes, addressed to the project, with only confirmed rules gating', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject();
    const installed = await service.installPackSuite(
      project.id,
      {},
      { confirmedRuleIds: ['items.exact'] },
    );

    const contract = await store.readArtefact<EnvironmentContract>(project.id, 'contract');
    const benchmark = await store.readArtefact<Benchmark>(project.id, 'benchmark');
    expect(contract).toEqual(installed.contract);
    expect(benchmark).toEqual(installed.benchmark);
    expect(contract?.environmentId).toBe(project.id);
    expect(benchmark?.environment).toBe(project.id);
    expect(benchmark?.contractHash).toBe(await hashValue(contract));
    expect(contract?.rules.map((rule) => [rule.id, rule.status])).toEqual([
      ['items.exact', 'confirmed'],
      ['items.no_other', 'inferred'],
    ]);

    const checks = benchmark!.cases[0]!.checks;
    const blocking = Object.fromEntries(checks.map((check) => [check.id, check.blocking]));
    // Confirmed rule: gates. Unconfirmed: explores. No rule cited: as the pack wrote it.
    expect(blocking).toEqual({ added: true, no_other_size: false, at_most_one: undefined });

    const updated = await store.read(project.id);
    expect(updated.timings.benchmarkGeneratedAt).not.toBeNull();
    expect(nextSteps(updated).map((step) => step.id)).toEqual(['connect_agent']);
  });

  it('refuses a confirmation of a rule the suite does not have, and stores nothing', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject();
    await expect(
      service.installPackSuite(project.id, {}, { confirmedRuleIds: ['items.invented'] }),
    ).rejects.toThrow(/no rule items\.invented/);
    expect(await store.readArtefact(project.id, 'benchmark')).toBeUndefined();
  });

  it('refuses to confirm a rule the suite has no check for, which would gate nothing', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject();
    const original = fake.pack.suite!;
    // A pack that leaves an unconfirmed rule's checks out, built with no rule
    // confirmed and then confirmed here: the confirmation would be a promise
    // with nothing behind it.
    fake.pack.suite = (params) => {
      const made = original(params);
      const benchmark = made.benchmark as unknown as {
        cases: { checks: { ruleId?: string }[] }[];
      };
      for (const testCase of benchmark.cases) {
        testCase.checks = testCase.checks.filter((check) => check.ruleId !== 'items.no_other');
      }
      return made;
    };
    await expect(
      service.installPackSuite(project.id, {}, { confirmedRuleIds: ['items.no_other'] }),
    ).rejects.toThrow(/no check for items\.no_other/);
    expect(await store.readArtefact(project.id, 'benchmark')).toBeUndefined();
  });

  it('refuses a suite whose check cites a rule its contract does not have', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject();
    const original = fake.pack.suite!;
    fake.pack.suite = (params) => {
      const made = original(params);
      const benchmark = made.benchmark as unknown as { cases: { checks: { ruleId?: string }[] }[] };
      benchmark.cases[0]!.checks[0]!.ruleId = 'items.nowhere';
      return made;
    };
    await expect(service.installPackSuite(project.id, {})).rejects.toThrow(
      /citing rule items\.nowhere/,
    );
  });

  it('refuses a suite that is not a suite', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject();
    fake.pack.suite = () =>
      ({ contract: { nope: true }, benchmark: {} }) as unknown as ReturnType<
        NonNullable<typeof fake.pack.suite>
      >;
    await expect(service.installPackSuite(project.id, {})).rejects.toThrow(
      /contract RigorRun cannot use/,
    );
  });

  it('is refused for a project that is not connected through a pack', async () => {
    const project = await service.createProject({ name: 'Not a pack' });
    await expect(service.installPackSuite(project.id, {})).rejects.toThrow(
      /not connected through a pack/,
    );
  });

  it('is not checked with synthetic agents, which cannot make a case’s records', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject();
    await service.installPackSuite(
      project.id,
      {},
      { confirmedRuleIds: ['items.exact', 'items.no_other'] },
    );
    await expect(service.assessSuite(project.id)).rejects.toThrow(/written by hand/);
  });
});

describe('running a pack project', () => {
  async function ready(safety: Project['safety'] = 'ephemeral', units = 5) {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject(safety);
    await service.installPackSuite(
      project.id,
      {},
      { confirmedRuleIds: ['items.exact', 'items.no_other'] },
    );
    const endpoint = await blackBoxAgent(
      () => fake.sessions[fake.sessions.length - 1]!,
      units,
      servers,
    );
    const added = await service.addAgent(project.id, {
      name: `adds ${units}`,
      blackBox: { endpoint },
    });
    expect(added.agent.lastProbeOk, added.agent.lastProbeProblem).toBe(true);
    return { project, agentId: added.agent.id };
  }

  it('makes each case’s records through a fresh adapter, and judges each case on its own', async () => {
    const { project, agentId } = await ready();
    const result = await service.runAgent(project.id, agentId);
    expect(result.caseResults.map((entry) => [entry.caseId, entry.outcome])).toEqual([
      ['case_a', 'PASS'],
      ['case_b', 'PASS'],
      ['case_c', 'PASS'],
    ]);
    expect(result.isolation).toBe('FRESH_OBJECTS');
    expect(result.limits.map((limit) => limit.id)).not.toContain('cases_selected');
    // One session for the run, one materialization per case.
    const session = fake.sessions[fake.sessions.length - 1]!;
    expect(session.made.map((made) => made.ctx.caseId)).toEqual(['case_a', 'case_b', 'case_c']);
    expect(new Set(session.made.map((made) => made.bindings['record'])).size).toBe(3);
    expect(createEnvironment(project.id)).not.toBe(createEnvironment(project.id));
    expect((await store.read(project.id)).baselineRunId).toBe(result.runId);
  });

  it('fails a case on what the system holds, not on what the agent said', async () => {
    const { project, agentId } = await ready('ephemeral', 7);
    const result = await service.runAgent(project.id, agentId, { caseIds: ['case_a'] });
    expect(result.caseResults[0]?.outcome).toBe('FAIL');
    expect(result.caseResults[0]?.reality?.lines.join(' ')).toMatch(/7 units/);
  });

  it('runs only the named cases, in the suite’s order, and says so on the result', async () => {
    const { project, agentId } = await ready();
    const finished: string[] = [];
    const result: RunResult = await service.runAgent(project.id, agentId, {
      caseIds: ['case_c', 'case_a', 'case_c'],
      afterCase: async (entry, index) => {
        finished.push(
          `${index}:${entry.caseId}:${Object.keys(entry.materialized ?? {}).join(',')}`,
        );
      },
    });
    expect(result.caseResults.map((entry) => entry.caseId)).toEqual(['case_a', 'case_c']);
    expect(finished).toEqual(['0:case_a:record,label', '1:case_c:record,label']);
    const session = fake.sessions[fake.sessions.length - 1]!;
    expect(session.made.map((made) => made.ctx.caseId)).toEqual(['case_a', 'case_c']);

    const limit = result.limits.find((entry) => entry.id === 'cases_selected');
    expect(limit?.limit).toMatch(/Ran 2 of the suite's 3 cases.*case_a, case_c/);
    // Sealed over the added limit, exactly as the runner seals a result.
    expect(result.resultHash).toBe(await hashValue({ ...result, resultHash: '' }));
    expect(await store.readRun<RunResult>(project.id, result.runId)).toEqual(result);

    const updated = await store.read(project.id);
    expect(updated.runs[updated.runs.length - 1]?.caseCount).toBe(2);
    // A few cases never become what the whole suite is measured against.
    expect(updated.baselineRunId).toBeNull();
  });

  it('refuses a case id the suite does not have, before anything runs', async () => {
    const { project, agentId } = await ready();
    await expect(
      service.runAgent(project.id, agentId, { caseIds: ['case_a', 'case_z'] }),
    ).rejects.toThrow(/no case case_z\. Its cases: case_a, case_b, case_c/);
    expect(fake.sessions.flatMap((session) => session.made)).toEqual([]);
  });

  it('refuses to run against a project marked production, before any record is made', async () => {
    await store.setSecret(DEFAULT_KEY_SECRET, 'k');
    const project = await packProject('production');
    await service.installPackSuite(project.id, {}, { confirmedRuleIds: ['items.exact'] });
    const endpoint = await blackBoxAgent(() => fake.sessions[0]!, 5, servers);
    const added = await service.addAgent(project.id, { name: 'adds', blackBox: { endpoint } });
    await expect(service.runAgent(project.id, added.agent.id)).rejects.toThrow(/marked production/);
    expect(fake.sessions.flatMap((session) => session.made)).toEqual([]);
  });
});

describe('selectCases', () => {
  const suite = { cases: [{ id: 'one' }, { id: 'two' }] } as unknown as Benchmark;

  it('is the whole suite when nothing is named', () => {
    expect(selectCases(suite, [])).toBe(suite);
  });

  it('keeps the suite’s order and drops repeats', () => {
    expect(selectCases(suite, ['two', 'one', 'two']).cases.map((entry) => entry.id)).toEqual([
      'one',
      'two',
    ]);
  });
});
