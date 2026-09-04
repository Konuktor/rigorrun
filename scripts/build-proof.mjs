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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const out = join(root, 'apps', 'web', 'src', 'proof.json');
await writeFile(out, `${JSON.stringify(proof, null, 2)}\n`);

const ESC = String.fromCharCode(27);
console.log(`${ESC}[32mProof regenerated${ESC}[0m from ${workflows.length} workflows at ${commit}.`);
for (const workflow of workflows) {
  console.log(
    `  ${workflow.key.padEnd(12)} ${String(workflow.cases).padStart(2)} cases · ` +
      `${workflow.rulesConfirmed} rules · kill ${Math.round(workflow.quality.mutantKillRate * 100)}% · ` +
      `${(workflow.timings.total / 1000).toFixed(1)}s to benchmark`,
  );
}
