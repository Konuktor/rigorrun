/**
 * A stand-in for the kind of environment real MCP servers actually give
 * RigorRun: one that cannot be seeded, whose "reset" leaves whatever world the
 * operator's reset script leaves, and whose state is read back through a few
 * nominated reads.
 *
 * The in-memory SDK environment underneath does all the real work. This
 * wrapper only changes the two things the audit turned on: it declares
 * `seed: 'none'`, and it decides what a reset produces — which is exactly the
 * world a case's baseline must be observed from, and exactly the world the
 * generation-time snapshot was *not*.
 */
import {
  FULL_CAPABILITIES,
  StateReadError,
  clearEnvironments,
  registerEnvironment,
  stateFromRows,
  type ActionResult,
  type CanonicalState,
  type CaseConfig,
  type EnvironmentAdapter,
  type EnvironmentCapabilities,
  type EnvironmentFixture,
  type EnvironmentRegistration,
} from '@rigorrun/environment';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark } from '@rigorrun/generator';
import { applyReview, fromActionLog, rulesAwaitingReview, type Benchmark } from '@rigorrun/core';
import type { AgentAdapter, AgentEnvironment } from '@rigorrun/agents';
import { TEST_SCHEMA, testEnvironment } from '../../environment/test/support.ts';

export const LIVE_ID = 'live-world';

export type Rows = Record<string, Record<string, unknown>[]>;

/** Rows the operator's reset script leaves behind, before any job. */
export const CLEAN_ROWS: Rows = {
  Account: [
    { accountId: 'ACC-1', label: 'First account', note: 'Prefers email.', tier: 'standard' },
    { accountId: 'ACC-2', label: 'Second account', note: null, tier: 'premium' },
  ],
  Item: [
    { itemId: 'ITM-1', accountId: 'ACC-1', value: 120, state: 'active' },
    { itemId: 'ITM-2', accountId: 'ACC-2', value: 80, state: 'retired' },
  ],
  Permit: [],
  Claim: [],
  LogEntry: [],
};

/**
 * The claim the demonstration filed, as it sits in an accumulated world. The
 * id is deliberately outside the in-memory environment's own sequence (which
 * restarts at 9001 on every reset): a real system issues fresh identifiers,
 * and a fixture that made a new claim collide with an old one would be
 * testing the fixture.
 */
export const DEMONSTRATED_CLAIM = {
  claimId: 'CLM-0001',
  accountId: 'ACC-1',
  itemId: 'ITM-1',
  permitId: null,
  amount: 30,
  filedBy: 'operator-1',
};

export function world(rows: Rows): CanonicalState {
  return stateFromRows(TEST_SCHEMA, rows);
}

export interface LiveWorldOptions {
  /** The world every reset produces. */
  resetTo: CanonicalState;
  caps?: Partial<EnvironmentCapabilities>;
  /** Make the nominated reads fail, for the n-th call onwards (1-based). */
  failReadsFrom?: number;
  failReset?: boolean;
  /**
   * A read that changes the world it reads, as a mailbox marks what it lists
   * as seen. Called after each read has answered, with what it answered and
   * its number (1-based); the world it returns replaces the system's.
   */
  onRead?: (answered: CanonicalState, readNumber: number) => CanonicalState | undefined;
  /** A listing that returns only the newest records of one kind, by identifier. */
  window?: { entity: string; newest: number };
  /** How long every read takes. */
  readDelayMs?: number;
  /** Every read answers with an empty world. */
  emptyReads?: boolean;
}

export class LiveWorld implements EnvironmentAdapter {
  readonly id = LIVE_ID;
  readonly name: string;
  readonly description: string;
  private reads = 0;

  constructor(
    private readonly inner: EnvironmentAdapter,
    private readonly options: LiveWorldOptions,
  ) {
    this.name = inner.name;
    this.description = inner.description;
  }

  capabilities(): EnvironmentCapabilities {
    return {
      ...FULL_CAPABILITIES,
      seed: 'none',
      reset: 'tool',
      stateRead: 'designated-reads',
      discovery: 'tools-only',
      ...this.options.caps,
    };
  }
  describeEntities() {
    return this.inner.describeEntities();
  }
  getActions() {
    return this.inner.getActions();
  }
  describeCaseConfig() {
    return this.inner.describeCaseConfig();
  }
  describePresentation() {
    return this.inner.describePresentation();
  }
  async reset() {
    if (this.options.failReset) throw new Error('the reset tool answered 500');
    await this.inner.reset();
    // What a reset script leaves is the world. Nothing installs it per case.
    await this.inner.seed(this.options.resetTo, {});
  }
  seed(_state: CanonicalState, _config?: CaseConfig): void {
    // A real system offers no way to install a world.
  }
  async getState() {
    this.reads += 1;
    if (this.options.readDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, this.options.readDelayMs));
    }
    if (this.options.failReadsFrom !== undefined && this.reads >= this.options.failReadsFrom) {
      throw new StateReadError('list_claims', 'the read tool answered 500');
    }
    if (this.options.emptyReads) {
      return { entities: Object.fromEntries(this.describeEntities().entities.map((entity) => [entity.name, {}])) };
    }
    const world = structuredClone(await this.inner.getState());
    const replaced = this.options.onRead?.(structuredClone(world), this.reads);
    if (replaced) await this.inner.seed(replaced, {});
    const window = this.options.window;
    if (!window) return world;
    const table = world.entities[window.entity] ?? {};
    const newest = Object.keys(table).sort().slice(-window.newest);
    return {
      ...world,
      entities: { ...world.entities, [window.entity]: Object.fromEntries(newest.map((key) => [key, table[key]!])) },
    };
  }
  getEvents() {
    return this.inner.getEvents();
  }
  executeAction(name: string, args: Record<string, unknown>): Promise<ActionResult> | ActionResult {
    return this.inner.executeAction(name, args);
  }
  snapshot() {
    return this.inner.snapshot();
  }
  restore(snapshot: Parameters<EnvironmentAdapter['restore']>[0]) {
    return this.inner.restore(snapshot);
  }
}

export function liveRegistration(options: LiveWorldOptions): EnvironmentRegistration {
  return {
    id: LIVE_ID,
    name: testEnvironment.name,
    description: testEnvironment.description,
    fixtures: testEnvironment.fixtures,
    create: () => new LiveWorld(testEnvironment.create(), options),
  };
}

/**
 * One demonstrated job — file a claim — compiled and generated the way the
 * product does it against a live system: the fixture is the world as the
 * reset leaves it *after* the demonstration ran, which is the snapshot the
 * audit found being used as every case's baseline.
 */
export async function liveBenchmark(
  registration: EnvironmentRegistration,
  options: { confirmRules?: boolean; snapshot?: CanonicalState } = {},
): Promise<{ benchmark: Benchmark; snapshot: CanonicalState }> {
  clearEnvironments();
  registerEnvironment(registration);

  const recorder = registration.create();
  await recorder.reset();
  const before = await recorder.getState();
  await recorder.executeAction('fileClaim', { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 });
  const after = await recorder.getState();

  const trace = fromActionLog(
    [{ at: 0, action: 'fileClaim', args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 } }],
    { environmentId: registration.id, id: 'trace_live', name: 'File a claim', before, after },
  );

  const draft = induceContract(registration.create(), trace, {
    contractId: 'ec_live',
    createdAt: '2026-09-14T00:00:00.000Z',
  }).contract;
  const awaiting = rulesAwaitingReview(draft).map((rule) => rule.id);
  const contract = applyReview(
    draft,
    options.confirmRules ? { confirmedRuleIds: awaiting } : { confirmedRuleIds: [], rejectedRuleIds: awaiting },
  );

  // The generation-time snapshot: what `registerFor` captures on a system
  // whose reset cannot undo the demonstration — the demonstrated claim is in it.
  const snapshot = options.snapshot ?? after;
  const fixture: EnvironmentFixture = {
    id: 'live',
    title: 'The system as its reset leaves it',
    summary: 'captured at generation time',
    state: snapshot,
    config: {},
    request: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 },
  };
  const { benchmark } = await generateBenchmark(registration.create(), contract, [fixture]);
  return { benchmark, snapshot };
}

/** Only the demonstrated job. The scripted agents ignore case inputs, so the
 * request-mutation cases the generator adds would measure nothing about them. */
export function happyOnly(benchmark: Benchmark): Benchmark {
  return { ...benchmark, cases: benchmark.cases.filter((c) => c.category === 'happy_path') };
}

export interface ScriptedStep {
  tool: string;
  args?: Record<string, unknown>;
}

/** An agent whose behaviour is known in advance, so the truth can be labelled first. */
export function scripted(
  id: string,
  steps: ScriptedStep[] | ((env: AgentEnvironment) => Promise<void>),
  report = 'Done.',
): AgentAdapter {
  return {
    id,
    name: id,
    kind: 'demo',
    description: `scripted: ${id}`,
    async execute(_input, env) {
      if (typeof steps === 'function') await steps(env);
      else for (const step of steps) await env.call(step.tool, step.args ?? {});
      return { report, costUsd: 0, costNote: 'no model calls — deterministic local agent' };
    },
  };
}

export const CORRECT = scripted('correct', [
  { tool: 'fileClaim', args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 } },
], 'Filed one claim of 30 on ITM-1.');

export const DUPLICATE = scripted('duplicate', [
  { tool: 'fileClaim', args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 } },
  { tool: 'fileClaim', args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 } },
], 'Filed the claim.');

export const WRONG_VALUE = scripted('wrong-value', [
  { tool: 'fileClaim', args: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 3000 } },
], 'Filed one claim of 30 on ITM-1.');

export const WRONG_ENTITY = scripted('wrong-entity', [
  { tool: 'writeLog', args: { action: 'fileClaim', detail: 'ACC-1 ITM-1 30' } },
], 'Filed one claim of 30 on ITM-1.');

export const FALSE_CLAIM = scripted('false-claim', [], 'Filed one claim of 30 on ITM-1.');
