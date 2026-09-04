/**
 * Demonstration → benchmark, for a registered workflow.
 *
 * The same six lines for every workflow. If any one of the five needed a step
 * the others did not, it would show up here as a branch, and there is none —
 * which is the point the `/proof` page is making.
 */
import {
  applyReview,
  fromActionLog,
  rulesAwaitingReview,
  type ActionLogEntry,
  type Benchmark,
  type CanonicalHumanTrace,
  type EnvironmentContract,
} from '@rigorrun/core';
import { induceContract } from '@rigorrun/compiler';
import { generateBenchmark, type GenerationResult } from '@rigorrun/generator';
import type { EnvironmentFixture, EnvironmentRegistration } from '@rigorrun/environment';

export interface WorkflowDefinition {
  /** Short slug used in ids and on the proof page. */
  key: string;
  title: string;
  /** The business function this belongs to, e.g. "Finance". */
  discipline: string;
  registration: EnvironmentRegistration;
  fixtureId: string;
  demonstration: ActionLogEntry[];
  /** A second recording of the same job, used to measure inductive recall. */
  secondDemonstration?: ActionLogEntry[];
  secondFixtureId?: string;
}

export interface CompiledWorkflow {
  definition: WorkflowDefinition;
  fixture: EnvironmentFixture;
  trace: CanonicalHumanTrace;
  draft: EnvironmentContract;
  contract: EnvironmentContract;
  benchmark: Benchmark;
  generation: GenerationResult;
  /** Wall-clock milliseconds for each stage. Measured, never estimated. */
  timings: { record: number; compile: number; review: number; generate: number; total: number };
}

export interface CompileWorkflowOptions {
  /** Rules the reviewer said no to. Their checks are dropped. */
  rejectedRuleIds?: string[];
  createdAt?: string;
  /** Confirm every inferred rule. The default: it is what the demos do. */
  confirmAll?: boolean;
}

/** Replays the recorded actions to capture authoritative state either side. */
export async function recordDemonstration(
  definition: WorkflowDefinition,
  fixtureId = definition.fixtureId,
  steps = definition.demonstration,
): Promise<CanonicalHumanTrace> {
  const adapter = definition.registration.create();
  const fixture = fixtureFor(definition, fixtureId);
  await adapter.seed(fixture.state, fixture.config);
  const before = await adapter.getState();

  for (const step of steps) {
    const result = await adapter.executeAction(step.action, step.args ?? {});
    if (!result.ok) {
      throw new Error(
        `The recorded demonstration for "${definition.key}" could not be replayed: ${step.action} failed with ${result.error?.code}.`,
      );
    }
  }

  return fromActionLog(steps, {
    environmentId: definition.registration.id,
    id: `trace_${definition.key}`,
    name: definition.title,
    recordedAt: '2026-01-20T09:00:00.000Z',
    before,
    after: await adapter.getState(),
  });
}

export async function compileWorkflow(
  definition: WorkflowDefinition,
  options: CompileWorkflowOptions = {},
): Promise<CompiledWorkflow> {
  const createdAt = options.createdAt ?? '2026-01-20T09:05:00.000Z';
  const fixture = fixtureFor(definition, definition.fixtureId);

  const t0 = now();
  const trace = await recordDemonstration(definition);

  const t1 = now();
  const draft = induceContract(definition.registration.create(), trace, {
    contractId: `ec_${definition.key}`,
    name: definition.title,
    createdAt,
  }).contract;

  const t2 = now();
  const rejected = new Set(options.rejectedRuleIds ?? []);
  const contract = applyReview(
    draft,
    {
      confirmedRuleIds: rulesAwaitingReview(draft)
        .map((rule) => rule.id)
        .filter((ruleId) => !rejected.has(ruleId)),
      rejectedRuleIds: [...rejected],
    },
    createdAt,
  );

  const t3 = now();
  const generation = await generateBenchmark(
    definition.registration.create(),
    contract,
    [fixture],
    { benchmarkId: `bm_${definition.key}`, createdAt },
  );
  const t4 = now();

  return {
    definition,
    fixture,
    trace,
    draft,
    contract,
    benchmark: generation.benchmark,
    generation,
    timings: {
      record: round(t1 - t0),
      compile: round(t2 - t1),
      review: round(t3 - t2),
      generate: round(t4 - t3),
      total: round(t4 - t0),
    },
  };
}

export function fixtureFor(definition: WorkflowDefinition, fixtureId: string): EnvironmentFixture {
  const fixture = definition.registration.fixtures.find((candidate) => candidate.id === fixtureId);
  if (!fixture) {
    throw new Error(`Environment "${definition.registration.id}" has no fixture "${fixtureId}".`);
  }
  return fixture;
}

function now(): number {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
