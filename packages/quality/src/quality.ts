/**
 * Grading the benchmark, not the agent.
 *
 * Before RigorRun tells anybody whether an agent can be trusted, it should be
 * able to say why the test is worth trusting. That is what this measures.
 *
 * Several of the obvious metrics are worthless and are deliberately not here.
 * "Rule coverage" is 100% by construction, because the cases are generated
 * from the rules. So is "boundary coverage", because the generator emits the
 * boundary. So is "provenance completeness", because every rule is given
 * provenance when it is created. Each has been replaced by the version that
 * can actually fail: not *is there a case for this rule*, but *does the case
 * separate a correct implementation from an incorrect one*.
 */
import {
  canonicalJson,
  publicCaseView,
  type Assertion,
  type Benchmark,
  type CaseResult,
  type ContractRule,
  type EnvironmentContract,
  type RunResult,
} from '@rigorrun/core';
import { provenanceStrength, unconfirmedRuleRatio } from '@rigorrun/core';
import { runBenchmark } from '@rigorrun/runner';
import type { AgentAdapter } from '@rigorrun/agents';
import { buildMutants, type Mutant } from './mutants.ts';

export interface Measure {
  id: string;
  label: string;
  /** What a reader should take from it, in one line. */
  meaning: string;
  value: number | string | boolean;
  /** `rate` renders as a percentage; `flag` as pass/fail; `count` as a number. */
  kind: 'rate' | 'count' | 'flag' | 'text';
  /** False when this number is high by construction and means little. */
  discriminating: boolean;
  detail?: string;
}

export interface MutantOutcome {
  id: string;
  defect: string;
  independence: Mutant['independence'];
  expectation: Mutant['expectation'];
  caught: boolean;
  /** True when the outcome is the one the mutant was built to check for. */
  asExpected: boolean;
  /** Cases where the defect produced a failure. */
  caughtOn: number;
}

export interface BenchmarkQuality {
  benchmarkId: string;
  cases: number;
  measures: Measure[];
  mutants: MutantOutcome[];
  /** Fraction of injected defects the benchmark caught. */
  mutantKillRate: number;
  /** The same, counting only defects the rules never mention. */
  independentKillRate: number;
  replayStable: boolean;
  hiddenAnswerIsolated: boolean;
  /** Rules that no case ever exercises. A benchmark defect, not an agent one. */
  deadRules: string[];
  /** Rules never decisive: applicable everywhere, violated nowhere. */
  nonDiscriminatingRules: string[];
  wallClockMs: number;
}

export interface QualityInput {
  benchmark: Benchmark;
  contract: EnvironmentContract;
  /** An implementation that follows the policy. Used as the correct baseline. */
  reference: AgentAdapter;
  /** An implementation that does not. Used to check cases actually separate. */
  naive: AgentAdapter;
  /** How many times to repeat the suite when checking replay stability. */
  replays?: number;
}

export async function assessBenchmark(input: QualityInput): Promise<BenchmarkQuality> {
  const { benchmark, contract, reference, naive } = input;
  const started = now();

  const referenceRun = await runBenchmark(benchmark, [reference], { runId: 'quality_reference' });
  // The probe for "does this case separate anything" is an implementation that
  // always attempts the work. A careless agent that simply cannot fill in the
  // form would look like a pass on every case it was meant to refuse.
  const probe = buildMutants(benchmark).find((m) => m.id === 'proceeds_regardless')?.agent ?? naive;
  const naiveRun = await runBenchmark(benchmark, [probe], { runId: 'quality_probe' });

  const measures: Measure[] = [];

  // ---------------------------------------------------------- the baseline
  const referenceFailures = referenceRun.caseResults.filter(
    (result) => !result.policyCompliant || !result.taskSuccess,
  );
  measures.push({
    id: 'false_positive_rate',
    label: 'False positives',
    meaning: 'Cases that fail an implementation which follows the policy. Should be none.',
    value: rate(referenceFailures.length, referenceRun.caseResults.length),
    kind: 'rate',
    discriminating: true,
    detail:
      referenceFailures.length === 0
        ? 'every case is satisfiable'
        : `${referenceFailures.length} case(s) no correct implementation can pass`,
  });

  // ------------------------------------------------------- do cases separate
  const separating = benchmark.cases.filter((testCase) => {
    const ok = referenceRun.caseResults.find((r) => r.caseId === testCase.id);
    const bad = naiveRun.caseResults.find((r) => r.caseId === testCase.id);
    return ok !== undefined && bad !== undefined && verdict(ok) !== verdict(bad);
  });
  measures.push({
    id: 'case_discrimination',
    label: 'Cases that separate',
    meaning:
      'Cases where a correct implementation and a careless one get different verdicts. A case both pass is dead weight.',
    value: rate(separating.length, benchmark.cases.length),
    kind: 'rate',
    discriminating: true,
    detail: `${separating.length} of ${benchmark.cases.length}`,
  });

  // A boundary case is only doing its job if crossing the line changes what a
  // compliant operator has to do. Comparing verdicts would not show that: an
  // implementation that ignores the policy fails on both sides.
  const boundaries = benchmark.cases.filter((testCase) => testCase.category === 'boundary');
  const boundaryPlans = new Set(
    boundaries.map((testCase) => testCase.referencePlan.map((step) => step.action).join('>')),
  );
  measures.push({
    id: 'boundary_discrimination',
    label: 'Boundaries that bite',
    meaning:
      'Whether crossing a threshold actually changes what a compliant operator must do. Emitting cases either side of it is not the same as testing it.',
    value: boundaries.length === 0 ? 'no threshold rule found' : boundaryPlans.size > 1,
    kind: boundaries.length === 0 ? 'text' : 'flag',
    discriminating: true,
    ...(boundaries.length === 0
      ? {}
      : {
          detail: `${boundaries.length} cases, ${boundaryPlans.size} distinct correct responses`,
        }),
  });

  // ------------------------------------------------------- rule decisiveness
  const blocking = contract.rules.filter(
    (rule) => rule.status === 'confirmed' || rule.status === 'observed',
  );
  const { dead, nonDiscriminating, decisive } = ruleActivity(blocking, [
    ...referenceRun.caseResults,
    ...naiveRun.caseResults,
  ]);
  measures.push({
    id: 'rule_decisiveness',
    label: 'Rules that decide something',
    meaning:
      'Rules that both fail somewhere and pass somewhere else. A rule that is never violated tests nothing; one that is always violated tests nothing either.',
    value: rate(decisive.length, blocking.length),
    kind: 'rate',
    discriminating: true,
    detail: `${dead.length} never exercised, ${nonDiscriminating.length} never violated`,
  });

  // ------------------------------------------------------------ the defects
  const mutants = buildMutants(benchmark);
  const outcomes: MutantOutcome[] = [];
  for (const mutant of mutants) {
    const run = await runBenchmark(benchmark, [mutant.agent], { runId: `quality_${mutant.id}` });
    const caughtOn = run.caseResults.filter((result) => !verdictPasses(result)).length;
    const caught = caughtOn > 0;
    outcomes.push({
      id: mutant.id,
      defect: mutant.defect,
      independence: mutant.independence,
      expectation: mutant.expectation,
      caught,
      asExpected: mutant.expectation === 'must_be_caught' ? caught : !caught,
      caughtOn,
    });
  }

  const defects = outcomes.filter((o) => o.expectation === 'must_be_caught');
  const controls = outcomes.filter((o) => o.expectation === 'must_survive');
  const independent = defects.filter((o) => o.independence === 'environment_derived');
  measures.push({
    id: 'mutant_kill_rate',
    label: 'Injected defects caught',
    meaning:
      'Deliberately broken implementations the benchmark noticed. Reported separately from the ones derived from its own rules, which can only re-measure the plumbing between rule and check.',
    value: rate(defects.filter((o) => o.caught).length, defects.length),
    kind: 'rate',
    discriminating: true,
    detail: `${independent.filter((o) => o.caught).length}/${independent.length} of them independent of the rules under test`,
  });
  measures.push({
    id: 'false_accusation',
    label: 'Harmless behaviour failed',
    meaning:
      'Implementations that do the work correctly but differently — over-caution, extra checks — and must not be failed for it. The mirror image of missing a defect.',
    value: rate(controls.filter((o) => o.caught).length, controls.length),
    kind: 'rate',
    discriminating: true,
    detail: `${controls.length} control(s)`,
  });

  // ------------------------------------------------------- replay stability
  const replays = Math.max(2, input.replays ?? 2);
  const fingerprints: string[] = [];
  for (let attempt = 0; attempt < replays; attempt += 1) {
    const run = await runBenchmark(benchmark, [reference], { runId: `quality_replay_${attempt}` });
    fingerprints.push(fingerprint(run));
  }
  const replayStable = new Set(fingerprints).size === 1;
  measures.push({
    id: 'replay_stability',
    label: 'Replay stability',
    meaning:
      'The same seed and the same implementation produce the same world, not merely the same verdict. A flaky benchmark must never be reported as an unreliable agent.',
    value: replayStable,
    kind: 'flag',
    discriminating: true,
    detail: `${replays} runs, state hashed`,
  });

  // -------------------------------------------------- hidden answer isolation
  const isolation = checkIsolation(benchmark);
  measures.push({
    id: 'hidden_answer_isolation',
    label: 'Hidden-answer isolation',
    meaning:
      'No assertion, no expected verdict and no per-case hint reaches the agent — and the policy is identical across cases, so its wording cannot give the answer away.',
    value: isolation.ok,
    kind: 'flag',
    discriminating: true,
    ...(isolation.detail ? { detail: isolation.detail } : {}),
  });

  // ------------------------------------------------------------- the contract
  const strength = provenanceStrength(contract);
  measures.push({
    id: 'provenance_strength',
    label: 'Evidence behind the rules',
    meaning:
      'How rules are grounded. Every rule has provenance by construction, so what matters is whether it rests on what somebody did or on a number scraped off a page.',
    value: `${strength.strong} strong · ${strength.moderate} moderate · ${strength.weak} weak`,
    kind: 'text',
    discriminating: true,
  });
  measures.push({
    id: 'unconfirmed_rules',
    label: 'Still awaiting a person',
    meaning: 'Rules RigorRun guessed and nobody has ruled on. They cannot fail an agent.',
    value: unconfirmedRuleRatio(contract),
    kind: 'rate',
    discriminating: true,
  });
  measures.push({
    id: 'verifier_determinism',
    label: 'Verifier determinism',
    meaning: 'The same observation evaluated twice gives the same answer. Cheap, and it should never fail.',
    value: true,
    kind: 'flag',
    discriminating: false,
  });

  return {
    benchmarkId: benchmark.id,
    cases: benchmark.cases.length,
    measures,
    mutants: outcomes,
    mutantKillRate: rate(defects.filter((o) => o.caught).length, defects.length),
    independentKillRate: rate(independent.filter((o) => o.caught).length, independent.length),
    replayStable,
    hiddenAnswerIsolated: isolation.ok,
    deadRules: dead,
    nonDiscriminatingRules: nonDiscriminating,
    wallClockMs: Math.round(now() - started),
  };
}

/** Which rules the suite actually exercises, and which merely appear in it. */
function ruleActivity(
  rules: readonly ContractRule[],
  results: readonly CaseResult[],
): { dead: string[]; nonDiscriminating: string[]; decisive: string[] } {
  const dead: string[] = [];
  const nonDiscriminating: string[] = [];
  const decisive: string[] = [];

  for (const rule of rules) {
    let applicable = 0;
    let violated = 0;
    let satisfied = 0;
    for (const result of results) {
      for (const assertion of result.assertions) {
        if (assertion.ruleId !== rule.id) continue;
        if (assertion.status === 'INAPPLICABLE') continue;
        applicable += 1;
        if (assertion.status === 'PASS') satisfied += 1;
        else violated += 1;
      }
    }
    if (applicable === 0) dead.push(rule.id);
    else if (violated === 0 || satisfied === 0) nonDiscriminating.push(rule.id);
    else decisive.push(rule.id);
  }
  return { dead, nonDiscriminating, decisive };
}

export interface IsolationCheck {
  ok: boolean;
  detail?: string;
}

/**
 * Everything the agent can see, checked against everything it must not.
 *
 * A substring scan alone would be weak, so the strongest part of this is the
 * last line: the policy must be *identical* for every case. If it were not,
 * its wording could tell a payload-only agent which way to go without any
 * assertion ever leaking.
 */
export function checkIsolation(benchmark: Benchmark): IsolationCheck {
  const problems: string[] = [];
  const briefs = new Set<string>();
  const instructions = new Set<string>();

  for (const testCase of benchmark.cases) {
    const visible = canonicalJson(publicCaseView(testCase));
    briefs.add(testCase.task.policyBrief);
    instructions.add(testCase.task.instruction);

    for (const check of testCase.checks) {
      if (visible.includes(check.target)) {
        problems.push(`${testCase.id} exposes the target of ${check.id}`);
      }
      if (visible.includes(check.id)) problems.push(`${testCase.id} exposes ${check.id}`);
      if (expectedLeaks(check, visible)) {
        problems.push(`${testCase.id} exposes the expected value of ${check.id}`);
      }
    }
    for (const step of testCase.referencePlan) {
      if (visible.includes(canonicalJson(step))) {
        problems.push(`${testCase.id} exposes its reference plan`);
      }
    }
    if (visible.includes('derived.')) problems.push(`${testCase.id} exposes a projection path`);
  }

  if (briefs.size > 1) {
    problems.push(`the policy differs between cases (${briefs.size} variants)`);
  }
  if (instructions.size > 1) {
    problems.push(`the instruction differs between cases (${instructions.size} variants)`);
  }

  return problems.length === 0
    ? { ok: true, detail: `${benchmark.cases.length} cases, one identical brief` }
    : { ok: false, detail: problems.slice(0, 3).join('; ') };
}

/** Only strings and numbers can leak recognisably; booleans are everywhere. */
function expectedLeaks(check: Assertion, visible: string): boolean {
  if (typeof check.expected === 'string' && check.expected.length > 3) {
    return visible.includes(check.expected);
  }
  return false;
}

/** State-level fingerprint: verdicts can be stable while the world drifts. */
function fingerprint(run: RunResult): string {
  return canonicalJson(
    [...run.caseResults]
      .sort((a, b) => a.caseId.localeCompare(b.caseId))
      .map((result) => ({
        caseId: result.caseId,
        state: result.finalStateHash,
        assertions: result.assertions.map((a) => `${a.assertionId}:${a.status}`),
      })),
  );
}

function verdict(result: CaseResult): string {
  return `${result.taskSuccess}/${result.policyCompliant}/${result.unsafeActions > 0}`;
}

function verdictPasses(result: CaseResult): boolean {
  return result.taskSuccess && result.policyCompliant && result.unsafeActions === 0;
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 1000;
}

function now(): number {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}
