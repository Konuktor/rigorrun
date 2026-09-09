#!/usr/bin/env node
/**
 * Generates the evidence behind the /proof page.
 *
 * Every number on that page comes from this script running the real pipeline
 * over all five workflows: the same compiler, the same generator, the same
 * verifier, the same quality checks. Nothing is written by hand, and the
 * output carries the commit it was produced from so a reader can regenerate it
 * and compare.
 *
 *   node scripts/build-proof.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

const script = `
import { WORKFLOWS, compileWorkflow } from '@rigorrun/environments';
import { createReferenceAgent } from '@rigorrun/generator';
import { GENERIC_AGENTS, naiveAgent } from '@rigorrun/agents';
import { runBenchmark } from '@rigorrun/runner';
import { assessBenchmark } from '@rigorrun/quality';
import { blockingRules, provenanceStrength } from '@rigorrun/core';

const workflows = [];
for (const definition of WORKFLOWS) {
  const compiled = await compileWorkflow(definition);
  const reference = createReferenceAgent(compiled.benchmark);
  const run = await runBenchmark(compiled.benchmark, [...GENERIC_AGENTS, reference], {
    runId: 'proof_' + definition.key,
  });
  const quality = await assessBenchmark({
    benchmark: compiled.benchmark,
    contract: compiled.contract,
    reference,
    naive: naiveAgent,
  });

  workflows.push({
    key: definition.key,
    title: definition.title,
    discipline: definition.discipline,
    environment: definition.registration.name,
    environmentId: definition.registration.id,
    entities: definition.registration.create().describeEntities().entities.length,
    actions: definition.registration.create().getActions().length,
    traceSteps: compiled.trace.steps.length,
    observedFacts: compiled.contract.observedFacts.length,
    rulesProposed: compiled.draft.rules.length,
    rulesConfirmed: blockingRules(compiled.contract).length,
    templates: [...new Set(compiled.contract.rules.map((rule) => rule.template))].sort(),
    provenance: provenanceStrength(compiled.contract),
    cases: compiled.benchmark.cases.length,
    checks: compiled.benchmark.cases.reduce((total, c) => total + c.checks.length, 0),
    categories: [...new Set(compiled.benchmark.cases.map((c) => c.category))].sort(),
    mustPerform: compiled.generation.cases.filter((c) => c.expected.shouldPerform).length,
    mustRefuse: compiled.generation.cases.filter((c) => !c.expected.shouldPerform).length,
    timings: compiled.timings,
    quality: {
      falsePositiveRate: quality.measures.find((m) => m.id === 'false_positive_rate')?.value ?? null,
      caseDiscrimination: quality.measures.find((m) => m.id === 'case_discrimination')?.value ?? null,
      boundaryDiscrimination:
        quality.measures.find((m) => m.id === 'boundary_discrimination')?.value ?? null,
      ruleDecisiveness: quality.measures.find((m) => m.id === 'rule_decisiveness')?.value ?? null,
      mutantKillRate: quality.mutantKillRate,
      independentKillRate: quality.independentKillRate,
      falseAccusationRate:
        quality.measures.find((m) => m.id === 'false_accusation')?.value ?? null,
      replayStable: quality.replayStable,
      hiddenAnswerIsolated: quality.hiddenAnswerIsolated,
      deadRules: quality.deadRules.length,
      wallClockMs: quality.wallClockMs,
    },
    /**
     * One real failing case, whole, from the run just executed.
     *
     * The landing page used to hardcode this — an amount, an order id and a
     * null approval typed into JSX under a comment saying it was
     * real. It *was* real, once, and nothing regenerated it. A fragment a
     * person maintains by hand beside a claim that it is machine-derived is a
     * fragment that goes stale and takes the claim with it.
     */
    failure: (() => {
      const result = run.caseResults.find(
        (entry) => entry.agentId === naiveAgent.id && !entry.policyCompliant,
      );
      if (!result) return null;
      const failed = result.assertions.find((assertion) => assertion.status === 'FAIL');
      if (!failed) return null;
      return {
        caseName: result.caseName,
        check: failed.description,
        // What the agent said about itself, which is never what decides this.
        agentClaimed: result.agentReport,
        // What the system said, which is — narrowed to the records the failed
        // check actually names. Taking the first three keys showed customers
        // on a check about refunds, which is a slice of the right state and
        // the wrong evidence.
        systemState: (() => {
          const named = Object.keys(result.finalStateSummary).filter((entity) =>
            failed.message.includes(entity) || failed.description.includes(entity),
          );
          const keys = named.length > 0 ? named : Object.keys(result.finalStateSummary).slice(0, 2);
          return Object.fromEntries(keys.map((key) => [key, result.finalStateSummary[key]]));
        })(),
        expected: failed.message,
        verificationSource: failed.verificationSource,
      };
    })(),
    mutants: quality.mutants.map((m) => ({
      id: m.id,
      defect: m.defect,
      independence: m.independence,
      expectation: m.expectation,
      caught: m.caught,
      asExpected: m.asExpected,
    })),
    agents: run.scores.map((score) => ({
      id: score.agentId,
      name: score.agentName,
      taskSuccess: score.taskSuccessRate,
      policyCompliance: score.policyComplianceRate,
      unsafeActions: score.unsafeActions,
      passed: score.thresholdsPassed,
    })),
  });
}
process.stdout.write(JSON.stringify(workflows));
`;

const started = Date.now();
// Written to a real .mts file: the pipeline is ESM with top-level await, which
// an inline --eval cannot express.
const scratch = await mkdtemp(join(tmpdir(), 'rigorrun-proof-'));
const scriptPath = join(scratch, 'collect.mts');
await writeFile(scriptPath, script);
let raw;
try {
  raw = execFileSync(tsx, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} finally {
  await rm(scratch, { recursive: true, force: true });
}
const workflows = JSON.parse(raw.slice(raw.indexOf('[')));

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout — the rest of the evidence still stands */
}

const proof = {
  generatedAt: new Date().toISOString(),
  commit,
  generationMs: Date.now() - started,
  workflows,
};

const out = join(root, 'apps', 'site', 'src', 'data', 'proof.json');
const ESC = String.fromCharCode(27);

/**
 * Everything about this evidence except when it was produced and how long it
 * took.
 *
 * The freshness gate used to diff the whole file, which can never pass: three
 * of its fields are a clock. So the gate was red-by-construction, and because
 * it also ran on a branch that does not exist in this repository, it never ran
 * at all — and the page drifted thirteen commits behind HEAD while saying it
 * was what the pipeline produces. Comparing what the pipeline *found* is the
 * check that was meant.
 */
function stable(value) {
  return JSON.stringify(
    {
      workflows: value.workflows.map(({ timings: _timings, quality, ...rest }) => ({
        ...rest,
        // `wallClockMs` is the second clock in this file, nested one level
        // deeper than the obvious one.
        quality: (({ wallClockMs: _wallClockMs, ...q }) => q)(quality),
      })),
    },
    null,
    2,
  );
}

if (process.argv.includes('--check')) {
  let committed;
  try {
    committed = JSON.parse(await readFile(out, 'utf8'));
  } catch {
    console.error(`${ESC}[31mNo ${out} to check against.${ESC}[0m`);
    process.exit(1);
  }
  if (stable(committed) !== stable(proof)) {
    console.error(
      `${ESC}[31mproof.json no longer matches what the pipeline produces.${ESC}[0m\n` +
        'Run `node scripts/build-proof.mjs` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`${ESC}[32mproof.json still matches the pipeline${ESC}[0m at ${commit}.`);
  process.exit(0);
}

await writeFile(out, `${JSON.stringify(proof, null, 2)}\n`);

console.log(`${ESC}[32mProof regenerated${ESC}[0m from ${workflows.length} workflows at ${commit}.`);
for (const workflow of workflows) {
  console.log(
    `  ${workflow.key.padEnd(12)} ${String(workflow.cases).padStart(2)} cases · ` +
      `${workflow.rulesConfirmed} rules · kill ${Math.round(workflow.quality.mutantKillRate * 100)}% · ` +
      `${(workflow.timings.total / 1000).toFixed(1)}s to benchmark`,
  );
}
