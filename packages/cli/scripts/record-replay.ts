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
 *   REPLAY_PROVIDER  Where the model ran, when the endpoint's name does not say.
 *   REPLAY_CASE_TIMEOUT_MS  Per-case budget for this recording. Default 180000: a local
 *                    model on a CPU is slow, and a timed-out case shows nothing.
 *
 * Whatever the model does is what is recorded — a run where it passes every
 * case is recorded as that. The file carries the model, the endpoint's name,
 * the date, the product commit and a hash of the run, which the replay checks
 * before showing anything.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmAgent } from '@rigorrun/agents';
import { createOpenAiCompatibleProvider } from '@rigorrun/providers';
import { runBenchmark } from '@rigorrun/runner';
import { WORKFLOWS, compileWorkflow } from '@rigorrun/environments';
import { runCommand } from '@rigorrun/exec';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, 'fixtures', 'replays', 'demo-replay.json');

const baseUrl = process.env['REPLAY_BASE_URL'] ?? 'http://127.0.0.1:11434/v1';
const model = process.env['REPLAY_MODEL'] ?? 'qwen2.5:7b';
const definition = WORKFLOWS[0];
if (!definition) throw new Error('No bundled workflow to record against.');

const provider = createOpenAiCompatibleProvider({
  id: 'replay',
  // Where the model ran, not only where the request went: an Ollama `:cloud`
  // model is reached through the local server but runs on Ollama's.
  name:
    process.env['REPLAY_PROVIDER'] ??
    (new URL(baseUrl).hostname !== '127.0.0.1'
      ? new URL(baseUrl).hostname
      : model.endsWith(':cloud')
        ? 'Ollama Cloud'
        : 'local Ollama'),
  baseUrl,
  apiKey: process.env['REPLAY_API_KEY'],
  model,
});
const agent = createLlmAgent({ id: 'llm-replay', name: `${model} agent`, provider });

// The commit the run is made at, through the one module allowed to start a
// process. A recording from a tree with uncommitted changes would name a
// commit that did not produce it, so that is refused.
const git = (args: string[]) =>
  runCommand({ command: 'git', args: ['-C', ROOT, ...args], timeoutMs: 10_000, provenance: 'rigorrun-internal' });
const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
const dirty = (await git(['status', '--porcelain', '--untracked-files=no'])).stdout.trim();
if (!/^[0-9a-f]{40}$/.test(commit) || dirty) {
  console.error('record-replay needs a clean, committed tree: the recording names the commit that made it.');
  process.exit(1);
}

const { benchmark } = await compileWorkflow(definition);
console.log(`recording ${model} against ${definition.registration.name}: ${benchmark.cases.length} cases`);
const caseTimeoutMs = Number(process.env['REPLAY_CASE_TIMEOUT_MS'] ?? 180_000);
const run = await runBenchmark(benchmark, [agent], {
  caseTimeoutMs,
  onProgress: async (event) => {
    if (event.type === 'case_finished') console.log(`  ${event.result.caseName}: ${event.result.outcome}`);
  },
});

const replay = {
  format: 'rigorrun/replay/1',
  recordedAt: run.finishedAt,
  model,
  provider: provider.name,
  commit,
  system: `${definition.registration.name} (a synthetic system bundled with RigorRun)`,
  resultHash: createHash('sha256').update(JSON.stringify(run)).digest('hex'),
  run,
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(replay, null, 2)}\n`);
console.log(`wrote ${OUT}`);
