/**
 * Records the run `rigorrun demo` replays: a real model, against the first
 * bundled (synthetic) workflow, written with everything needed to trust it.
 *
 *   node_modules/.bin/tsx packages/cli/scripts/record-replay.ts
 *
 * Environment:
 *   REPLAY_BASE_URL  OpenAI-compatible endpoint. Default http://127.0.0.1:11434/v1 (Ollama).
 *   REPLAY_MODEL     Default qwen2.5:7b.
 *   REPLAY_API_KEY   Optional.
 *
 * Whatever the model does is what is recorded — a run where it passes every
 * case is recorded as that. The file carries the model, the endpoint's name,
 * the date, the product commit and a hash of the run, which the replay checks
 * before showing anything.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmAgent } from '@rigorrun/agents';
import { createOpenAiCompatibleProvider } from '@rigorrun/providers';
import { runBenchmark } from '@rigorrun/runner';
import { WORKFLOWS, compileWorkflow } from '@rigorrun/environments';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, 'fixtures', 'replays', 'demo-replay.json');

const baseUrl = process.env['REPLAY_BASE_URL'] ?? 'http://127.0.0.1:11434/v1';
const model = process.env['REPLAY_MODEL'] ?? 'qwen2.5:7b';
const definition = WORKFLOWS[0];
if (!definition) throw new Error('No bundled workflow to record against.');

const provider = createOpenAiCompatibleProvider({
  id: 'replay',
  name: new URL(baseUrl).hostname === '127.0.0.1' ? 'local Ollama' : new URL(baseUrl).hostname,
  baseUrl,
  apiKey: process.env['REPLAY_API_KEY'],
  model,
});
const agent = createLlmAgent({ id: 'llm-replay', name: `${model} agent`, provider });

const { benchmark } = await compileWorkflow(definition);
console.log(`recording ${model} against ${definition.registration.name}: ${benchmark.cases.length} cases`);
const run = await runBenchmark(benchmark, [agent], {
  onProgress: async (event) => {
    if (event.type === 'case_finished') console.log(`  ${event.result.caseName}: ${event.result.outcome}`);
  },
});

const replay = {
  format: 'rigorrun/replay/1',
  recordedAt: run.finishedAt,
  model,
  provider: provider.name,
  commit: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  system: `${definition.registration.name} (a synthetic system bundled with RigorRun)`,
  resultHash: createHash('sha256').update(JSON.stringify(run)).digest('hex'),
  run,
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(replay, null, 2)}\n`);
console.log(`wrote ${OUT}`);
