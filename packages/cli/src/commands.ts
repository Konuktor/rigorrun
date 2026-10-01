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
  caseOutcome,
  parseBenchmark,
  parseCanonicalTrace,
  parseEnvironmentContract,
  rulesAwaitingReview,
  type AgentScore,
  type Benchmark,
  type CanonicalHumanTrace,
  type CaseResult,
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
import { BUNDLED_EXAMPLE_FLAG, VERSION } from './help.ts';
import { afterCaseHook } from './afterCase.ts';
import {
  bundledReplay,
  flagshipReplay,
  isBundledExample,
  printReplay,
  readReplayFile,
  verifyReplay,
  type Replay,
} from './replay.ts';

export interface Flags {
  out?: string | undefined;
  /** Which demo job to run, for `rigorrun demo`. */
  workflow?: string | undefined;
  /** `rigorrun demo --live`: run the pipeline now instead of replaying the recorded run. */
  live?: boolean | undefined;
  /** `rigorrun demo`: replay the bundled synthetic example even when the flagship is bundled. */
  bundledExample?: boolean | undefined;
  /**
   * `rigorrun demo --replay <file>`: replay a recording from disk, held to the
   * same checks as a bundled one. Undocumented: it is for looking at a
   * recording before it is bundled, not something a newcomer needs.
   */
  replayFile?: string | undefined;
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
  /** Cases allowed to end without a verdict before the gate refuses to answer. */
  maxInconclusive?: number | undefined;
  /** Wall-clock budget per case for this run, overriding the suite's. */
  caseTimeoutMs?: number | undefined;
  /** A command run after each case has finished and before the next starts. */
  afterCase?: string | undefined;
  /** `--case <id>`, repeatable: run only these cases of a project's suite. */
  caseIds?: string[] | undefined;
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
  // A job or an agent only means something to a run made now, so naming
  // either is asking for one.
  if (!flags.live && !flags.workflow && flags.agent.length === 0) return cmdDemoReplay(flags);
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
  line(c.grey(`Time from "start recording" to a reviewed benchmark: ${fmtMs(timings.total)}.`));
  line(c.grey(`Artefacts in ${outDir}/ · run .rigorrun/runs/${result.runId}.json`));
  if (flags.json) line(JSON.stringify(result, null, 2));
  return result.verdict.winnerAgentId ? 0 : 1;
}

/**
 * `rigorrun demo`: the recorded run, replayed. No key, no network, no model,
 * and a verdict on the screen in the time it takes to read one.
 */
async function cmdDemoReplay(flags: Flags): Promise<number> {
  const replay = await chosenReplay(flags);
  if (flags.json) {
    verifyReplay(replay);
    line(JSON.stringify(replay, null, 2));
    return 0;
  }
  printReplay(replay);
  if (flags.report) {
    await writeText(
      flags.report,
      renderReportHtml(replay.run, {
        generatedAt: replay.recordedAt,
        // Only the bundled example's system is fabricated; a flagship recording
        // ran against a real system or its twin, and its run says which.
        syntheticEnvironment: isBundledExample(replay),
        ...(flags.published ? { mode: 'published' as const } : {}),
      }),
    );
    line();
    line(`${c.bold('Report')}  ${flags.report}`);
  }
  return 0;
}

/**
 * Which recording `rigorrun demo` replays: one named on the command line, the
 * synthetic example when asked for by name, and otherwise the flagship
 * recording when this build carries it.
 */
async function chosenReplay(flags: Flags): Promise<Replay> {
  if (flags.replayFile !== undefined && flags.bundledExample) {
    throw new CliError(`Choose one recording: --replay <file> or --${BUNDLED_EXAMPLE_FLAG}.`);
  }
  if (flags.replayFile !== undefined) return readReplayFile(flags.replayFile);
  if (flags.bundledExample) return bundledReplay();
  return (await flagshipReplay()) ?? bundledReplay();
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
    line(
      JSON.stringify(
        listEnvironments().map((r) => ({ id: r.id, name: r.name })),
        null,
        2,
      ),
    );
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
    adapter
      .getActions()
      .map((action) => [
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
    line(
      JSON.stringify(
        WORKFLOWS.map((w) => ({ key: w.key, title: w.title })),
        null,
        2,
      ),
    );
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
  line(
    `${c.bold('Observed')}  ${draft.observedFacts.length} facts taken straight from what changed`,
  );
  for (const fact of draft.observedFacts.slice(0, 6)) line(`  ${c.grey('·')} ${fact.statement}`);
  line();
  line(
    `${c.bold('Proposed')}  ${draft.rules.length} rules, none of them enforced until you say so`,
  );
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

  return exitCodeForScores(result.scores);
}

/**
 * 0 when every threshold is met; 3 when the only thing that failed is that too
 * many cases reached no verdict — the same code `verify` uses for "ran, but
 * established too little" — and 1 when an agent genuinely fell short.
 */
export function exitCodeForScores(scores: readonly AgentScore[]): number {
  if (scores.every((s) => s.thresholdsPassed)) return 0;
  return scores.every((s) => s.thresholdsPassed || s.inconclusive) ? 3 : 1;
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
      maxInconclusive: flags.maxInconclusive ?? benchmark.thresholds.maxInconclusive,
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

  return exitCodeForScores([score]);
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
  const afterCase = flags.afterCase !== undefined ? afterCaseHook(flags.afterCase) : undefined;
  let finished = 0;

  const onProgress = async (event: RunProgress) => {
    if (event.type !== 'case_finished') return;
    if (!flags.quiet && !flags.json) {
      done += 1;
      const { result } = event;
      const mark = outcomeMark(result);
      line(
        `  ${c.grey(String(done).padStart(String(total).length))}/${total}  ${mark}  ` +
          `${c.grey(result.agentId.padEnd(12))} ${result.caseId.replace(/^case_/, '').padEnd(22)} ${c.grey(fmtMs(result.durationMs))}`,
      );
    }
    // After the case has finished, and before the next one starts.
    if (afterCase) {
      const index = finished;
      finished += 1;
      await afterCase(event.result, index);
    }
  };

  if (!flags.quiet && !flags.json) heading(`Running ${total} case executions`);

  return runBenchmark(benchmark, agents, {
    ...(flags.repeats ? { repeats: flags.repeats } : {}),
    // `!== undefined`, not truthiness: a budget of 0 must be refused, not ignored.
    ...(flags.caseTimeoutMs !== undefined ? { caseTimeoutMs: flags.caseTimeoutMs } : {}),
    onProgress,
    version: VERSION,
  });
}

/** One word per verdict, so a timeout or an abstention never reads as a wrong answer. */
function outcomeMark(result: CaseResult): string {
  const outcome = caseOutcome(result);
  if (result.unsafeActions > 0) return c.red('!');
  switch (outcome) {
    case 'PASS':
      return c.green('ok');
    case 'FAIL':
      return c.red('x');
    case 'ABSTAIN':
      return c.yellow('abstain');
    case 'TIMED_OUT':
      return c.yellow('timeout');
    case 'AGENT_FAILURE':
      return c.red('agent-error');
    case 'HARNESS_FAILURE':
      return c.yellow('harness');
  }
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
  for (const s of result.scores) {
    const undecided = s.abstained + s.timedOut + s.agentFailures + s.harnessFailures;
    if (undecided > 0) {
      line(
        `${c.grey('outcomes')}  ${s.agentName}: ${s.decided ?? s.n}/${s.n} decided · ` +
          `${s.abstained} abstained · ${s.timedOut} timed out · ${s.agentFailures} agent failure(s) · ${s.harnessFailures} harness failure(s)`,
      );
    }
  }
  line(
    `${c.grey('verification')}  ${result.verification}   ${c.grey('isolation')}  ${result.isolation}`,
  );
  for (const limit of result.limits) line(`${c.grey('limit')}  ${limit.limit}`);
  for (const warning of result.suiteQuality?.warnings ?? [])
    line(`${c.yellow('suite')}  ${warning}`);
  line();
  // The reference implementation is handed the answer: a control that shows
  // the suite can be passed, never the headline about the agents.
  if (result.verdict.winnerAgentId === REFERENCE_AGENT_ID) {
    const contenders = result.scores.filter((s) => s.agentId !== REFERENCE_AGENT_ID);
    const passed = contenders.filter((s) => s.thresholdsPassed);
    line(
      `${c.bold('Verdict')}  ` +
        (passed.length > 0
          ? `${passed.map((s) => s.agentName).join(' and ')} met the release thresholds.`
          : `No agent met the release thresholds.`),
    );
    line(
      `  ${c.grey('-')} ${c.grey('The reference implementation passed: the suite can be passed. It is a control, given the answer, not a contender.')}`,
    );
    return;
  }
  line(`${c.bold('Verdict')}  ${result.verdict.outcome ?? ''} ${result.verdict.summary}`);
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
