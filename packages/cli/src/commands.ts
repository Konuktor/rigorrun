/**
 * Command implementations.
 *
 * Every command returns an exit code rather than calling `process.exit`, so
 * they stay testable and so `gate` can be trusted in CI.
 */
import { join } from 'node:path';
import {
  applyReview,
  blockingRules,
  parseBenchmark,
  parseCanonicalTrace,
  parseEnvironmentContract,
  rulesAwaitingReview,
  type Benchmark,
  type CanonicalHumanTrace,
  type EnvironmentContract,
  type RunResult,
} from '@rigorrun/core';
import { induceContract } from '@rigorrun/compiler';
import { REFERENCE_AGENT_ID, createReferenceAgent, generateBenchmark } from '@rigorrun/generator';
import { createEnvironment, listEnvironments } from '@rigorrun/environment';
import { WORKFLOWS, compileWorkflow, workflowByKey } from '@rigorrun/environments';
import { availableAgents, resolveAgent, type AgentAdapter } from '@rigorrun/agents';
import { runBenchmark, type RunProgress } from '@rigorrun/runner';
import { renderReportHtml, sanitizeRunResult } from '@rigorrun/report';
import { envFromProcess } from '@rigorrun/providers';
import { pct } from '@rigorrun/scoring';
import { CliError, readJson, writeJson, writeText, workspaceDir } from './io.ts';
import { c, fmtMs, heading, line, ruleTag, statusTag, table } from './ui.ts';
import { VERSION } from './help.ts';

export interface Flags {
  out?: string | undefined;
  /** Which demo job to run, for `rigorrun demo`. */
  workflow?: string | undefined;
  agent: string[];
  repeats?: number | undefined;
  report?: string | undefined;
  json: boolean;
  quiet: boolean;
  published: boolean;
  port?: number | undefined;
  minSuccess?: number | undefined;
  minPolicy?: number | undefined;
  maxPolicyViolations?: number | undefined;
  maxUnsafe?: number | undefined;
  /** Which project to act on. The product path, as against a benchmark file. */
  project?: string | undefined;
  /** Where the store lives. Overridden in tests and in CI. */
  home?: string | undefined;
  /** The run a comparison is made against, when it is not the saved baseline. */
  baseline?: string | undefined;
  /**
   * Let the reference implementation through `gate`. It is handed the answer,
   * so a gate on it passes by construction and measures nothing about an
   * agent. Checking that a suite is satisfiable at all is the one honest use,
   * and it has to be asked for by name.
   */
  allowReference: boolean;
}

const RUNS_DIR = () => join(workspaceDir(), 'runs');

// --------------------------------------------------------------------- demo

export async function cmdDemo(flags: Flags): Promise<number> {
  const outDir = flags.out ?? '.rigorrun';
  // The first registered example rather than a named one. A default that
  // names a business is a default that has to be edited when the examples
  // change, and this file is one of the two places a domain noun kept coming
  // back in code that is not supposed to know any.
  const key = flags.workflow ?? WORKFLOWS[0]?.key;
  if (!key) throw new CliError('This build ships no example workflows.');
  const definition = workflowByKey(key);
  const pipeline = await compileWorkflow(definition);
  const { draft, contract, benchmark, trace, timings } = {
    draft: pipeline.draft,
    contract: pipeline.contract,
    benchmark: pipeline.benchmark,
    trace: pipeline.trace,
    timings: pipeline.timings,
  };

  if (!flags.quiet) {
    heading(`RigorRun demo — ${definition.title}`);
    line(c.grey('Recorded human workflow -> contract -> benchmark -> agents -> verdict'));
    line();
    line(
      `${c.bold('1. Recorded trace')}   ${trace.steps.length} steps in ${definition.registration.name}`,
    );
    line(
      `${c.bold('2. Contract')}         ${draft.rules.length} proposed rules · ` +
        `${draft.observedFacts.length} observed facts · all awaiting review`,
    );
    line(
      `${c.bold('3. Reviewed')}         ${blockingRules(contract).length} confirmed · ` +
        `${rulesAwaitingReview(contract).length} still open`,
    );
    line(
      `${c.bold('4. Benchmark')}        ${benchmark.cases.length} cases across ` +
        `${new Set(benchmark.cases.map((testCase) => testCase.category)).size} categories`,
    );
    line();
  }

  const agents = agentsFor(benchmark, flags, [
    ...availableAgents(),
    createReferenceAgent(benchmark),
  ]);
  const result = await executeRun(benchmark, agents, flags);

  await writeJson(join(outDir, 'trace.json'), trace);
  await writeJson(join(outDir, 'contract.json'), contract);
  await writeJson(join(outDir, 'benchmark.json'), benchmark);
  await writeJson(join(outDir, 'run.json'), result);
  // Also into the run store, so `rigorrun report <runId>` finds it.
  await writeJson(join(RUNS_DIR(), `${result.runId}.json`), result);
  await writeText(
    join(outDir, 'report.html'),
    renderReportHtml(result, {
      contract,
      benchmark,
      generatedAt: result.finishedAt,
      syntheticEnvironment: isBundledEnvironment(result.environment),
    }),
  );

  // `--quiet` drops the narration, never the result. A demo whose verdict you
  // cannot see in CI output is not a gate.
  line();
  printComparison(result);
  line();
  line(
    c.grey(
      `Time from "start recording" to a reviewed benchmark: ${fmtMs(timings.total)}.`,
    ),
  );
  line(c.grey(`Artefacts in ${outDir}/ · run .rigorrun/runs/${result.runId}.json`));
  if (flags.json) line(JSON.stringify(result, null, 2));
  return result.verdict.winnerAgentId ? 0 : 1;
}

/** `rigorrun environments` — what this installation can point at. */
export function cmdEnvironments(flags: Flags): number {
  const rows = listEnvironments().map((registration) => {
    const adapter = registration.create();
    const schema = adapter.describeEntities();
    return [
      registration.id,
      registration.name,
      `${schema.entities.length} entities`,
      `${adapter.getActions().length} actions`,
      `${registration.fixtures.length} fixtures`,
    ];
  });
  if (flags.json) {
    line(JSON.stringify(listEnvironments().map((r) => ({ id: r.id, name: r.name })), null, 2));
    return 0;
  }
  heading('Environments');
  table(['id', 'name', 'entities', 'actions', 'fixtures'], rows);
  return 0;
}

/** `rigorrun inspect-environment <id>` — the schema an adapter publishes. */
export function cmdInspectEnvironment(id: string | undefined, flags: Flags): number {
  if (!id) throw new CliError('Name an environment. Try `rigorrun environments`.');
  const adapter = createEnvironment(id);
  const schema = adapter.describeEntities();
  if (flags.json) {
    line(JSON.stringify({ schema, actions: adapter.getActions() }, null, 2));
    return 0;
  }

  heading(adapter.name);
  line(c.grey(adapter.description));
  line();
  line(c.bold('Records'));
  table(
    ['entity', 'id field', 'fields', 'roles'],
    schema.entities.map((entity) => [
      entity.name,
      entity.idField,
      String(entity.fields.length),
      [...new Set(entity.fields.map((field) => field.role).filter(Boolean))].join(', '),
    ]),
  );
  line();
  line(c.bold('Links'));
  table(
    ['from', 'name', 'to', 'cardinality'],
    schema.relationships.map((r) => [r.from, r.name, r.to, r.cardinality]),
  );
  line();
  line(c.bold('Actions'));
  table(
    ['action', 'kind', 'changes', 'parameters'],
    adapter.getActions().map((action) => [
      action.name,
      action.readOnly ? 'read' : 'write',
      action.mutates.join(', ') || '—',
      action.params.map((param) => param.name).join(', '),
    ]),
  );
  return 0;
}

/** `rigorrun workflows` — the demo jobs this build ships with. */
export function cmdWorkflows(flags: Flags): number {
  if (flags.json) {
    line(JSON.stringify(WORKFLOWS.map((w) => ({ key: w.key, title: w.title })), null, 2));
    return 0;
  }
  heading('Demo workflows');
  table(
    ['key', 'job', 'function', 'environment'],
    WORKFLOWS.map((w) => [w.key, w.title, w.discipline, w.registration.id]),
  );
  line();
  line(c.grey('Run one with `rigorrun demo --workflow <key>`.'));
  return 0;
}

export async function cmdCompile(tracePath: string | undefined, flags: Flags): Promise<number> {
  if (!tracePath) throw new CliError('Give me a trace file. Try `rigorrun compile trace.json`.');
  const trace = parseTraceOrFail(await readJson(tracePath), tracePath);
  const adapter = createEnvironment(trace.environmentId);
  const draft = induceContract(adapter, trace).contract;

  const outPath = flags.out ?? join('.rigorrun', 'contract.json');
  await writeJson(outPath, draft);

  if (flags.json) {
    line(JSON.stringify(draft, null, 2));
    return 0;
  }

  heading('Contract');
  line(c.grey(draft.goal));
  line();
  line(`${c.bold('Observed')}  ${draft.observedFacts.length} facts taken straight from what changed`);
  for (const fact of draft.observedFacts.slice(0, 6)) line(`  ${c.grey('·')} ${fact.statement}`);
  line();
  line(`${c.bold('Proposed')}  ${draft.rules.length} rules, none of them enforced until you say so`);
  for (const rule of draft.rules) {
    line(`  ${ruleTag(rule.status)} ${rule.statement}`);
    if (rule.question) line(`     ${c.grey(rule.question.text)}`);
  }
  line();
  line(c.grey(`Written to ${outPath}. Confirm rules, then run \`rigorrun generate\`.`));
  return 0;
}

export async function cmdGenerate(contractPath: string | undefined, flags: Flags): Promise<number> {
  if (!contractPath) {
    throw new CliError('Give me a contract file. Try `rigorrun generate contract.json`.');
  }
  const draft = parseContractOrFail(await readJson(contractPath), contractPath);
  // Without an interactive review, every proposed rule is confirmed. The
  // reviewed artefact is what `rigorrun demo` writes; this is the batch path.
  const contract =
    rulesAwaitingReview(draft).length > 0
      ? applyReview(draft, {
          confirmedRuleIds: rulesAwaitingReview(draft).map((rule) => rule.id),
        })
      : draft;

  const registration = listEnvironments().find((r) => r.id === contract.environmentId);
  if (!registration) throw new CliError(`Unknown environment "${contract.environmentId}".`);
  const generation = await generateBenchmark(
    registration.create(),
    contract,
    registration.fixtures,
  );

  const outPath = flags.out ?? join('.rigorrun', 'benchmark.json');
  await writeJson(outPath, generation.benchmark);

  if (flags.json) {
    line(JSON.stringify(generation.benchmark, null, 2));
    return 0;
  }

  heading('Benchmark');
  line(
    `${generation.benchmark.cases.length} cases across ` +
      `${new Set(generation.benchmark.cases.map((testCase) => testCase.category)).size} categories`,
  );
  table(
    ['case', 'category', 'expected'],
    generation.cases.map((entry) => [
      entry.testCase.name,
      entry.testCase.category,
      entry.expected.shouldPerform ? 'do the work' : `refuse — ${entry.expected.refusalReason}`,
    ]),
  );
  for (const conflict of generation.conflicts) {
    line(c.red(`  conflict in ${conflict.caseId}: ${conflict.detail}`));
  }
  line();
  line(c.grey(`Written to ${outPath}.`));
  return generation.conflicts.length > 0 ? 1 : 0;
}

export async function cmdRun(benchmarkPath: string | undefined, flags: Flags): Promise<number> {
  const benchmark = await loadBenchmark(benchmarkPath);
  // No default agent. This used to fall back to the reference implementation,
  // which is given the answer — so `rigorrun run benchmark.json` printed a
  // perfect score and exited 0 without an agent being involved at all.
  if (flags.agent.length === 0) {
    throw new CliError(
      'run needs at least one --agent.\n' +
        '  --agent naive --agent careful   the two bundled examples\n' +
        `  --agent ${REFERENCE_AGENT_ID}              checks the suite is satisfiable, not that an agent is good`,
    );
  }
  const agents = agentsFor(benchmark, flags, []);

  const result = await executeRun(benchmark, agents, flags);
  await writeJson(join('.rigorrun', 'runs', `${result.runId}.json`), result);

  if (flags.json) {
    line(JSON.stringify(result, null, 2));
  } else {
    printComparison(result);
    line();
    line(`${c.grey('run')}  .rigorrun/runs/${result.runId}.json`);
  }

  if (flags.report) {
    const written = await writeText(
      flags.report,
      renderReportHtml(result, {
        benchmark,
        syntheticEnvironment: isBundledEnvironment(result.environment),
      }),
    );
    if (!flags.json) line(`${c.grey('report')}  ${written}`);
  }

  return result.scores.every((s) => s.thresholdsPassed) ? 0 : 1;
}

// ---------------------------------------------------------------------- gate

export async function cmdGate(benchmarkPath: string | undefined, flags: Flags): Promise<number> {
  const benchmark = await loadBenchmark(benchmarkPath);
  if (flags.agent.length !== 1) {
    throw new CliError('gate needs exactly one --agent.');
  }
  // A gate exists to be able to fail. The reference implementation replays the
  // plan the expectation engine derived, so it cannot fail, and a build gated
  // on it is a build with no gate. Allowed only when somebody says that is
  // what they meant.
  if (flags.agent[0] === REFERENCE_AGENT_ID && !flags.allowReference) {
    throw new CliError(
      `gate refuses --agent ${REFERENCE_AGENT_ID}: it is handed the answer, so the gate passes by\n` +
        'construction and tells you nothing about an agent.\n\n' +
        `  rigorrun run <benchmark> --agent ${REFERENCE_AGENT_ID}     is the suite satisfiable?\n` +
        `  rigorrun gate <benchmark> --agent ${REFERENCE_AGENT_ID} --allow-reference\n` +
        '                                              same question, as a gate',
    );
  }
  const agent = agentsFor(benchmark, flags, [])[0]!;

  const gated: Benchmark = {
    ...benchmark,
    thresholds: {
      minTaskSuccess: flags.minSuccess ?? benchmark.thresholds.minTaskSuccess,
      minPolicyCompliance: flags.minPolicy ?? benchmark.thresholds.minPolicyCompliance,
      maxPolicyViolations: flags.maxPolicyViolations ?? benchmark.thresholds.maxPolicyViolations,
      maxUnsafeActions: flags.maxUnsafe ?? benchmark.thresholds.maxUnsafeActions,
    },
  };

  const result = await executeRun(gated, [agent], flags);
  await writeJson(join('.rigorrun', 'runs', `${result.runId}.json`), result);
  const score = result.scores[0]!;

  if (flags.json) {
    line(JSON.stringify({ passed: score.thresholdsPassed, score }, null, 2));
  } else {
    heading(`Gate: ${agent.name}`);
    table(
      ['Metric', 'Observed', 'Required'],
      [
        ['task success', pct(score.taskSuccessRate), `>= ${pct(gated.thresholds.minTaskSuccess)}`],
        [
          'policy compliance',
          pct(score.policyComplianceRate),
          `>= ${pct(gated.thresholds.minPolicyCompliance)}`,
        ],
        [
          'policy violations',
          String(score.policyViolations),
          `<= ${gated.thresholds.maxPolicyViolations}`,
        ],
        ['unsafe actions', String(score.unsafeActions), `<= ${gated.thresholds.maxUnsafeActions}`],
      ],
      [1, 2],
    );
    line();
    line(
      `${statusTag(score.thresholdsPassed)}  n=${score.n} cases · 95% CI ${pct(score.taskSuccessInterval.lower)}-${pct(score.taskSuccessInterval.upper)}`,
    );
    for (const failure of score.failedThresholds) line(`  ${c.red('x')} ${failure}`);
  }

  if (flags.report) {
    await writeText(
      flags.report,
      renderReportHtml(result, {
        benchmark: gated,
        syntheticEnvironment: isBundledEnvironment(result.environment),
      }),
    );
  }

  return score.thresholdsPassed ? 0 : 1;
}

// -------------------------------------------------------------------- report

export async function cmdReport(target: string | undefined, flags: Flags): Promise<number> {
  if (!target) throw new CliError('report needs a run file or a run id.');

  const path = target.endsWith('.json') ? target : join('.rigorrun', 'runs', `${target}.json`);
  const run = (await readJson<RunResult>(path)) as RunResult;
  const html = renderReportHtml(flags.published ? sanitizeRunResult(run) : run, {
    mode: flags.published ? 'published' : 'full',
    syntheticEnvironment: isBundledEnvironment(run.environment),
  });

  const out =
    flags.out ?? join('.rigorrun', `${run.runId}${flags.published ? '.published' : ''}.html`);
  const written = await writeText(out, html);
  line(`${c.grey('report')}  ${written}`);
  if (flags.published) {
    line(
      c.yellow('Sanitised: task inputs, tool arguments, evidence and agent prose were removed.'),
    );
  }
  return 0;
}

// -------------------------------------------------------------- agents/doctor

export function cmdAgents(flags: Flags): number {
  const agents = availableAgents({ env: envFromProcess(process.env) });
  if (flags.json) {
    line(
      JSON.stringify(
        agents.map(({ id, name, kind, description }) => ({ id, name, kind, description })),
        null,
        2,
      ),
    );
    return 0;
  }
  heading('Available agents');
  table(
    ['Id', 'Kind', 'Name', 'Description'],
    agents.map((a) => [a.id, a.kind, a.name, a.description]),
  );
  return 0;
}

// ------------------------------------------------------------------- helpers

async function executeRun(
  benchmark: Benchmark,
  agents: ReturnType<typeof resolveAgent>[],
  flags: Flags,
): Promise<RunResult> {
  const total = benchmark.cases.length * agents.length * Math.max(1, flags.repeats ?? 1);
  let done = 0;

  const onProgress = (event: RunProgress) => {
    if (flags.quiet || flags.json) return;
    if (event.type === 'case_finished') {
      done += 1;
      const { result } = event;
      const mark =
        result.unsafeActions > 0
          ? c.red('!')
          : result.taskSuccess && result.policyCompliant
            ? c.green('ok')
            : c.red('x');
      line(
        `  ${c.grey(String(done).padStart(String(total).length))}/${total}  ${mark}  ` +
          `${c.grey(result.agentId.padEnd(12))} ${result.caseId.replace(/^case_/, '').padEnd(22)} ${c.grey(fmtMs(result.durationMs))}`,
      );
    }
  };

  if (!flags.quiet && !flags.json) heading(`Running ${total} case executions`);

  return runBenchmark(benchmark, agents, {
    ...(flags.repeats ? { repeats: flags.repeats } : {}),
    onProgress,
    version: VERSION,
  });
}

function printComparison(result: RunResult): void {
  heading('Head to head');
  table(
    ['Agent', 'Task success', 'Policy', 'Unsafe', 'Median', 'p95', 'Steps', 'Cost', 'Gate'],
    result.scores.map((s) => [
      s.agentName,
      `${pct(s.taskSuccessRate)} ${c.grey(`[${pct(s.taskSuccessInterval.lower)}-${pct(s.taskSuccessInterval.upper)}]`)}`,
      pct(s.policyComplianceRate),
      s.unsafeActions === 0 ? c.green('0') : c.red(String(s.unsafeActions)),
      fmtMs(s.medianLatencyMs),
      fmtMs(s.p95LatencyMs),
      s.avgSteps.toFixed(1),
      s.totalCostUsd === null ? c.grey('unavailable') : `$${s.totalCostUsd.toFixed(2)}`,
      statusTag(s.thresholdsPassed),
    ]),
    [1, 2, 3, 4, 5, 6, 7],
  );
  line();
  line(
    `${c.grey(`n=${result.scores[0]?.n ?? 0} cases per agent. Ranges are 95% Wilson intervals.`)}`,
  );
  line();
  line(`${c.bold('Verdict')}  ${result.verdict.summary}`);
  for (const reason of result.verdict.rationale) line(`  ${c.grey('-')} ${c.grey(reason)}`);
}

/** Surfaces the case that makes the product's point in one screen. */
async function loadBenchmark(path: string | undefined): Promise<Benchmark> {
  if (!path) throw new CliError('This command needs a benchmark file.');
  const raw = await readJson<unknown>(path);
  try {
    return parseBenchmark(raw);
  } catch (error) {
    throw new CliError(`${path} is not a valid benchmark: ${firstIssue(error)}`);
  }
}

function parseTraceOrFail(raw: unknown, path: string): CanonicalHumanTrace {
  try {
    return parseCanonicalTrace(raw);
  } catch (error) {
    throw new CliError(`${path} is not a valid trace: ${firstIssue(error)}`);
  }
}

function parseContractOrFail(raw: unknown, path: string): EnvironmentContract {
  try {
    return parseEnvironmentContract(raw);
  } catch (error) {
    throw new CliError(`${path} is not a valid contract: ${firstIssue(error)}`);
  }
}

/**
 * The agents to run.
 *
 * `reference` is built from the benchmark's own private plans, so it is only
 * available once a benchmark is loaded — and it is an oracle, which is why it
 * is not in the general registry.
 */
function agentsFor(benchmark: Benchmark, flags: Flags, fallback: AgentAdapter[]): AgentAdapter[] {
  if (flags.agent.length === 0) return fallback;
  return flags.agent.map((id) =>
    id === REFERENCE_AGENT_ID ? createReferenceAgent(benchmark) : resolveAgentOrFail(id),
  );
}

/**
 * Is this environment one of RigorRun's own bundled examples?
 *
 * The report footer used to declare every environment synthetic, which meant a
 * report of a run against somebody's real system said in print that all of its
 * records were fabricated. Derived from the registry rather than asserted, so
 * it cannot drift from what is actually bundled.
 */
export function isBundledEnvironment(environmentId: string): boolean {
  return WORKFLOWS.some((workflow) => workflow.registration.id === environmentId);
}

function resolveAgentOrFail(id: string) {
  try {
    return resolveAgent(id, { env: envFromProcess(process.env) });
  } catch (error) {
    throw new CliError((error as Error).message);
  }
}



function firstIssue(error: unknown): string {
  const issues = (error as { issues?: { path?: (string | number)[]; message: string }[] }).issues;
  if (issues?.[0]) return `${(issues[0].path ?? []).join('.')} ${issues[0].message}`.trim();
  return (error as Error).message;
}
