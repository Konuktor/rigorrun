/**
 * Records the flagship demo: the reference support agent, in its two variants,
 * on the Stripe pack's seven cases — under the rules fixed before anything was
 * recorded, which this script enforces rather than trusts.
 *
 *   reports/flagship-demo-2026-10/PREREGISTRATION.md   what is recorded, and how it is shown
 *   reports/flagship-demo-2026-10/AMENDMENT-1.md       the temperature, and where it comes from
 *
 * Three modes, in the order they happen:
 *
 *   --pilot    A run on the twin to find harness faults (a schema the model's API
 *              rejects, a timeout). Writes only where --out says, never into
 *              fixtures/, and appends itself to pilot-log.md with --note: what was
 *              changed since the last pilot, and why. A pilot is never evidence.
 *   --freeze   Writes freeze.json: the model, provider, temperature and its source,
 *              the system, the harness settings, both variants' prompt and tool
 *              hashes as the agents themselves report them (GET /meta), and the
 *              product commit. Refuses a tree with uncommitted product changes,
 *              and refuses to overwrite an existing freeze.
 *   (neither)  The recording. Refused unless freeze.json exists and matches the
 *              flags, the agents' /meta hashes, and a product tree unchanged since
 *              the frozen commit. The first complete recording is final: an
 *              existing one is replaced only with --discard "<reason>", and only
 *              when it holds a HARNESS_FAILURE or AGENT_FAILURE; it is then listed
 *              in the new file's `discarded`, with its files moved aside.
 *
 *   pnpm tsx packages/cli/scripts/record-stripe-replay.ts \
 *     --system twin|live --provider gemini|openai --model <id> \
 *     --temperature <n> [--temperature-source <url|default-0>] \
 *     [--case-timeout <ms>] [--out <path>] [--pilot --note <text> | --freeze | --discard <reason>]
 *
 * Environment, read here and handed to the agents, never printed and never
 * written into a file:
 *   STRIPE_TEST_KEY                 --system live: the test-mode key (sk_test_… or rk_test_…).
 *                                   RigorRun and both agents use it; nothing is sent elsewhere.
 *   GEMINI_API_KEY, GEMINI_BASE_URL --provider gemini.
 *   OPENAI_BASE_URL, OPENAI_API_KEY --provider openai (e.g. http://127.0.0.1:11434/v1, Ollama).
 *   MIN_INTERVAL_MS                 The least time between two model requests (a free tier's limit).
 *
 * The path through the product is the one a person takes: the twin, then
 * `rigorrun stripe init`, `rigorrun agent add --black-box` for each variant,
 * and `rigorrun run --project … --case …` over the seven pre-registered cases,
 * once per variant (one recording per variant, as the pre-registration says),
 * against a fresh, temporary RigorRun home whose secrets never touch this
 * machine's keyring. The two stored runs are kept whole beside the recording;
 * the replay's `run` is the two put side by side, mechanically, with each
 * one's id and sealed hash named in `variants`.
 */
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  caseOutcome,
  hashValue,
  type Benchmark,
  type CaseResult,
  type RunResult,
} from '@rigorrun/core';
import { ProjectStore, selectCases, storeRoot } from '@rigorrun/daemon';
import {
  STRIPE_CASE_IDS,
  STRIPE_CASE_TIMEOUT_MS,
  startTwin,
  type RunningTwin,
} from '@rigorrun/env-stripe';
import { TWIN_AGENT_KEY } from '@rigorrun/env-stripe/cli/twin.ts';
import { runCommand, startCommand } from '@rigorrun/exec';
import { decideVerdict } from '@rigorrun/scoring';
import {
  REPLAY_FORMAT,
  hashRun,
  verifyReplay,
  type DiscardedRecording,
  type Replay,
  type ReplayPresentation,
  type ReplayVariant,
} from '../src/replay.ts';

// ------------------------------------------------------------------ the rules

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'flagship-demo-2026-10');
const FREEZE = join(REPORT_DIR, 'freeze.json');
const PILOT_LOG = join(REPORT_DIR, 'pilot-log.md');
const RECORDING_DIR = join(REPORT_DIR, 'recording');
const INCOMPLETE = join(RECORDING_DIR, 'incomplete-attempts.json');
const DEFAULT_OUT = join(ROOT, 'fixtures', 'replays', 'stripe-replay.json');
const AGENT = join(ROOT, 'examples', 'stripe-support-agent', 'server.mjs');
const CLI = join(ROOT, 'packages', 'cli', 'src', 'bin.ts');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

/** The variants, in the order the pre-registration's table lists them, which is the order they run. */
const VARIANTS = ['careful', 'minimal'] as const;
type Variant = (typeof VARIANTS)[number];

/**
 * How each variant is named wherever the demo names it. `minimal`'s words are
 * the pre-registration's own, which it requires to be used; `careful`'s are its
 * row of the same table.
 */
const DESCRIPTIONS: Readonly<Record<Variant, string>> = {
  careful:
    'the same model and policy, with tools to look up the order, list its refunds and get the ' +
    'customer, and a refund amount described as the smallest currency unit.',
  minimal:
    'a first version written the way first versions often are: the same model and policy, a ' +
    'thinner tool layer.',
};

/** The pre-registration's "How it is shown": the headline rule, written into the recording. */
const PRESENTATION: ReplayPresentation = {
  headline: {
    variants: ['minimal', 'careful'],
    cases: [
      'units',
      'prompt_injection',
      'other_customer',
      'already_refunded',
      'disputed',
      'partial',
      'full_refund',
    ],
    source: 'reports/flagship-demo-2026-10/PREREGISTRATION.md',
  },
  task: { label: 'The ticket', inputs: ['amount', 'message'] },
  next: [
    'npx rigorrun stripe twin                     # terminal 1, leave it running',
    'npx rigorrun stripe init --twin --yes        # terminal 2',
    'https://docs.rigorrun.xyz/start/stripe/',
  ],
};

/** What a recording may be discarded for: the harness or the agent's plumbing failing, never a verdict. */
const DISCARDABLE = new Set(['HARNESS_FAILURE', 'AGENT_FAILURE']);

/**
 * What runs when a recording is made. A change here after the freeze changes
 * what produced the recording, so it is refused; anything else (the site, the
 * docs, this report folder) may change.
 */
const PRODUCT_PATHS = [
  'packages/',
  'examples/stripe-support-agent/',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
];

const SYSTEM_NAMES = { live: 'Stripe test mode', twin: 'a local Stripe twin (simulated)' } as const;

// ------------------------------------------------------------------ the flags

class Refusal extends Error {}

interface Settings {
  system: 'twin' | 'live';
  provider: 'gemini' | 'openai';
  model: string;
  temperature: number;
  temperatureSource: string;
  caseTimeoutMs: number | null;
  minIntervalMs: number | null;
  mode: 'pilot' | 'freeze' | 'record';
  out: string;
  note: string | null;
  discard: string | null;
}

function settingsFrom(argv: string[]): Settings {
  const { values } = parseArgs({
    args: argv,
    options: {
      system: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      temperature: { type: 'string' },
      'temperature-source': { type: 'string' },
      'case-timeout': { type: 'string' },
      out: { type: 'string' },
      pilot: { type: 'boolean', default: false },
      freeze: { type: 'boolean', default: false },
      note: { type: 'string' },
      discard: { type: 'string' },
    },
    strict: true,
  });
  const system = values.system;
  if (system !== 'twin' && system !== 'live') throw new Refusal('--system is twin or live.');
  const provider = values.provider;
  if (provider !== 'gemini' && provider !== 'openai') {
    throw new Refusal('--provider is gemini or openai.');
  }
  const model = values.model?.trim() ?? '';
  if (!model) throw new Refusal('--model is required: a recording pins its model.');

  // Amendment 1: the model's documentation decides the temperature, and the
  // freeze records where it said so. Zero is the default for every model whose
  // documentation names no value, so it alone may go without a source.
  if (values.temperature === undefined) throw new Refusal('--temperature is required.');
  const temperature = Number(values.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Refusal(`--temperature takes a number from 0 to 2, not "${values.temperature}".`);
  }
  const source = values['temperature-source']?.trim();
  let temperatureSource: string;
  if (temperature === 0) {
    temperatureSource = source ?? 'default-0';
    if (temperatureSource !== 'default-0' && !isUrl(temperatureSource)) {
      throw new Refusal('--temperature-source is the documentation URL, or default-0.');
    }
  } else {
    if (source === undefined || !isUrl(source)) {
      throw new Refusal(
        `Temperature ${temperature} is not the default, so it needs --temperature-source <url>: the ` +
          'page of the model’s documentation that recommends it (Amendment 1).',
      );
    }
    temperatureSource = source;
  }

  const timeout = values['case-timeout'];
  if (timeout !== undefined && !/^[1-9][0-9]*$/.test(timeout)) {
    throw new Refusal(`--case-timeout takes milliseconds, not "${timeout}".`);
  }
  const interval = process.env['MIN_INTERVAL_MS'];
  if (interval !== undefined && !/^[0-9]+$/.test(interval)) {
    throw new Refusal('MIN_INTERVAL_MS is a whole number of milliseconds.');
  }

  if (values.pilot && values.freeze) throw new Refusal('A pilot is not a freeze. Choose one.');
  const mode = values.pilot ? 'pilot' : values.freeze ? 'freeze' : 'record';
  const out = resolve(values.out ?? DEFAULT_OUT);
  if (mode === 'pilot') {
    if (values.out === undefined) throw new Refusal('A pilot needs --out: a scratch path.');
    // A pilot is never evidence, so it can never land where evidence is kept.
    for (const kept of [join(ROOT, 'fixtures'), RECORDING_DIR]) {
      if (out === kept || !relative(kept, out).startsWith('..')) {
        throw new Refusal(
          `A pilot writes to a scratch path, never under ${relative(ROOT, kept)}/.`,
        );
      }
    }
    if (!values.note?.trim()) {
      throw new Refusal(
        'A pilot needs --note: what was changed since the last pilot, and why (the pre-registration ' +
          'requires both in pilot-log.md). "Nothing changed" is a note.',
      );
    }
  }
  if (values.discard !== undefined && mode !== 'record') {
    throw new Refusal('--discard replaces a recording; a pilot or a freeze has none to replace.');
  }
  if (values.discard !== undefined && !values.discard.trim()) {
    throw new Refusal('--discard needs the reason, in words.');
  }
  return {
    system,
    provider,
    model,
    temperature,
    temperatureSource,
    caseTimeoutMs: timeout === undefined ? null : Number(timeout),
    minIntervalMs: interval === undefined ? null : Number(interval),
    mode,
    out,
    note: values.note?.trim() ?? null,
    discard: values.discard?.trim() ?? null,
  };
}

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text) && URL.canParse(text);
}

// --------------------------------------------------------- what is not printed

/**
 * The credentials this recording hands out, read once. None is ever printed,
 * passed on a command line, or written into a file; the transcripts are
 * searched for each before they are kept.
 */
interface Credentials {
  stripeKey: string;
  llm: Record<string, string>;
  secrets: string[];
}

function credentialsFor(settings: Settings): Credentials {
  const env = process.env;
  let stripeKey: string = TWIN_AGENT_KEY;
  if (settings.system === 'live') {
    const key = env['STRIPE_TEST_KEY']?.trim();
    if (!key) throw new Refusal('--system live reads the test-mode key from STRIPE_TEST_KEY.');
    if (!/^(sk|rk)_test_/.test(key)) {
      throw new Refusal('STRIPE_TEST_KEY must be a test-mode key (sk_test_… or rk_test_…).');
    }
    stripeKey = key;
  }
  const llm: Record<string, string> = {};
  const pass = (name: string, required: boolean) => {
    const value = env[name]?.trim();
    if (value) llm[name] = value;
    else if (required) throw new Refusal(`--provider ${settings.provider} needs ${name}.`);
  };
  if (settings.provider === 'gemini') {
    pass('GEMINI_API_KEY', true);
    pass('GEMINI_BASE_URL', false);
  } else {
    pass('OPENAI_BASE_URL', true);
    pass('OPENAI_API_KEY', false);
  }
  if (settings.minIntervalMs !== null) llm['MIN_INTERVAL_MS'] = String(settings.minIntervalMs);
  const secrets = [stripeKey, llm['GEMINI_API_KEY'], llm['OPENAI_API_KEY']].filter(
    (value): value is string => typeof value === 'string' && value.length >= 8,
  );
  return { stripeKey, llm, secrets };
}

/** Where the model ran, in the words the replay uses for it. */
function providerName(settings: Settings, credentials: Credentials): string {
  if (settings.provider === 'gemini') return 'the Gemini API';
  const url = new URL(credentials.llm['OPENAI_BASE_URL'] ?? 'http://invalid');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (settings.model.endsWith(':cloud')) return 'Ollama Cloud';
  if (local && url.port === '11434') return 'local Ollama';
  if (local) return 'a local OpenAI-compatible server';
  return url.hostname;
}

// ------------------------------------------------------------------- the tree

async function git(args: string[]): Promise<string> {
  const result = await runCommand({
    command: 'git',
    args: ['-C', ROOT, ...args],
    timeoutMs: 20_000,
    provenance: 'rigorrun-internal',
  });
  if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

const isProduct = (path: string) =>
  PRODUCT_PATHS.some((prefix) =>
    prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix,
  );

/** HEAD, and the product files with uncommitted changes. */
async function tree(): Promise<{ commit: string; dirty: string[] }> {
  const commit = (await git(['rev-parse', 'HEAD'])).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Could not read the commit.');
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no']))
    .split('\n')
    .map((row) => row.slice(3).trim())
    .filter(Boolean);
  return { commit, dirty: dirty.filter(isProduct) };
}

// ----------------------------------------------------------------- the freeze

interface Freeze {
  frozenAt: string;
  commit: string;
  system: Settings['system'];
  provider: Settings['provider'];
  providerName: string;
  model: string;
  temperature: number;
  temperatureSource: string;
  harness: {
    caseTimeoutMs: number | null;
    minIntervalMs: number | null;
    attempts: 1;
    cases: string[];
  };
  variants: Record<Variant, { promptSha256: string; toolsSha256: string }>;
  listModels?: { calledAt: string; models: string[] };
}

async function readFreeze(): Promise<Freeze | undefined> {
  const text = await readFile(FREEZE, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : (JSON.parse(text) as Freeze);
}

/** Everything about a recording that the freeze fixed, compared field by field. */
function againstFreeze(freeze: Freeze, settings: Settings, name: string): string[] {
  const differences: string[] = [];
  const same = (what: string, frozen: unknown, now: unknown) => {
    if (JSON.stringify(frozen) !== JSON.stringify(now)) {
      differences.push(`${what}: frozen ${JSON.stringify(frozen)}, now ${JSON.stringify(now)}`);
    }
  };
  same('system', freeze.system, settings.system);
  same('provider', freeze.provider, settings.provider);
  same('provider name', freeze.providerName, name);
  same('model', freeze.model, settings.model);
  same('temperature', freeze.temperature, settings.temperature);
  same('temperature source', freeze.temperatureSource, settings.temperatureSource);
  same('case timeout', freeze.harness.caseTimeoutMs, settings.caseTimeoutMs);
  same('MIN_INTERVAL_MS', freeze.harness.minIntervalMs, settings.minIntervalMs);
  same('cases', freeze.harness.cases, [...STRIPE_CASE_IDS]);
  return differences;
}

/**
 * The pre-registration: "At the start of recording, ListModels is called with
 * the available key." Called at the freeze, which is where the model is fixed,
 * and kept in freeze.json so the choice can be checked against what was on
 * offer. The key goes in a header, never in the URL.
 */
async function listGeminiModels(credentials: Credentials): Promise<string[]> {
  const base = credentials.llm['GEMINI_BASE_URL'] ?? 'https://generativelanguage.googleapis.com';
  const names: string[] = [];
  let pageToken = '';
  for (let page = 0; page < 20; page += 1) {
    const url = new URL('/v1beta/models', base);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, {
      headers: { 'x-goog-api-key': credentials.llm['GEMINI_API_KEY'] ?? '' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ListModels answered ${response.status}.`);
    const body = (await response.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const model of body.models ?? []) {
      if (model.name && model.supportedGenerationMethods?.includes('generateContent')) {
        names.push(model.name.replace(/^models\//, ''));
      }
    }
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return names.sort();
}

// ------------------------------------------------------------- the processes

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

/** What GET /meta reports: what the agent will send its model. */
interface AgentMeta {
  variant: string;
  provider: string;
  model: string;
  promptSha256: string;
  toolsSha256: string;
  temperature?: number;
}

interface RunningAgent {
  variant: Variant;
  url: string;
  meta: AgentMeta;
  transcripts: string;
  /** Started through `@rigorrun/exec`, the one module allowed to start a process. */
  child: ReturnType<typeof startCommand>;
}

async function startAgent(
  variant: Variant,
  settings: Settings,
  credentials: Credentials,
  stripe: { baseUrl: string; key: string },
  transcripts: string,
): Promise<RunningAgent> {
  const port = await freePort();
  const modelVariable = settings.provider === 'gemini' ? 'GEMINI_MODEL' : 'OPENAI_MODEL';
  const child = startCommand({
    command: process.execPath,
    args: [AGENT],
    env: {
      PORT: String(port),
      VARIANT: variant,
      LLM_PROVIDER: settings.provider,
      [modelVariable]: settings.model,
      // The agent must report the temperature it sends in /meta; one that does
      // not runs at its built-in 0, and anything else is refused below.
      TEMPERATURE: String(settings.temperature),
      ...credentials.llm,
      STRIPE_BASE_URL: stripe.baseUrl,
      STRIPE_KEY: stripe.key,
      TRANSCRIPT_DIR: transcripts,
    },
    timeoutMs: 0,
    provenance: 'operator-configured',
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += String(chunk);
    for (const row of String(chunk).split('\n').filter(Boolean)) {
      console.error(`  [${variant}] ${row}`);
    }
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    for (const row of String(chunk).split('\n').filter(Boolean))
      console.log(`  [${variant}] ${row}`);
  });
  const url = `http://127.0.0.1:${port}/`;
  for (let tries = 0; tries < 200; tries += 1) {
    if (child.exitCode !== null) {
      throw new Error(`The ${variant} agent stopped before answering: ${stderr.trim()}`);
    }
    const answer = await fetch(`${url}meta`).catch(() => undefined);
    if (answer?.ok) {
      const meta = (await answer.json()) as AgentMeta;
      return { variant, url, meta, transcripts, child };
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  child.kill('SIGTERM');
  throw new Error(`The ${variant} agent did not answer on ${url} within 20 seconds.`);
}

/** Holds each agent's /meta to the flags: its variant, its model, its provider, its temperature. */
function checkMeta(agent: RunningAgent, settings: Settings): void {
  const { meta } = agent;
  const problems: string[] = [];
  if (meta.variant !== agent.variant) problems.push(`variant ${meta.variant}`);
  if (meta.model !== settings.model) problems.push(`model ${meta.model}`);
  if (meta.provider !== settings.provider) problems.push(`provider ${meta.provider}`);
  if (!/^[0-9a-f]{64}$/.test(meta.promptSha256) || !/^[0-9a-f]{64}$/.test(meta.toolsSha256)) {
    problems.push('no prompt and tool hashes');
  }
  // An agent that does not report its temperature runs at the 0 its code fixes.
  const temperature = meta.temperature ?? 0;
  if (temperature !== settings.temperature) {
    problems.push(
      meta.temperature === undefined
        ? `no temperature in /meta, so its built-in 0 rather than ${settings.temperature}`
        : `temperature ${temperature}`,
    );
  }
  if (problems.length > 0) {
    throw new Refusal(`The ${agent.variant} agent reports ${problems.join(', ')}.`);
  }
}

async function stopAgent(agent: RunningAgent): Promise<void> {
  if (agent.child.exitCode !== null) return;
  const stopped = new Promise((done) => agent.child.once('exit', done));
  agent.child.kill('SIGTERM');
  await Promise.race([stopped, new Promise((done) => setTimeout(done, 5000))]);
}

/** One `rigorrun` command, as a person would type it, against the recording's own home. */
async function rigorrun(
  args: string[],
  home: string,
  timeoutMs: number,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const result = await runCommand({
    command: TSX,
    args: [CLI, ...args, '--home', home],
    cwd: ROOT,
    env: {
      RIGORRUN_HOME: home,
      // In the temporary home, never in this machine's keyring: a recording
      // must not read, or overwrite, a key somebody keeps there.
      RIGORRUN_SECRET_BACKEND: 'file',
      NO_COLOR: '1',
      ...extraEnv,
    },
    timeoutMs,
    provenance: 'operator-configured',
  });
  if (result.timedOut) throw new Error(`rigorrun ${args[0]} did not finish in ${timeoutMs} ms.`);
  return result;
}

// ------------------------------------------------------------ the recording

interface Recorded {
  replay: Replay;
  runs: Record<Variant, RunResult>;
  agents: RunningAgent[];
}

async function record(
  settings: Settings,
  credentials: Credentials,
  commit: string,
  freeze: Freeze | undefined,
  scratch: string,
  agentsOut: RunningAgent[],
): Promise<Recorded> {
  const home = join(scratch, 'home');
  let twin: RunningTwin | undefined;
  try {
    let baseUrl = 'https://api.stripe.com';
    const initArgs = ['stripe', 'init', '--yes', '--json', '--dir', join(scratch, 'init')];
    const initEnv: Record<string, string> = {};
    if (settings.system === 'twin') {
      twin = await startTwin({ port: 0 });
      baseUrl = twin.url;
      initArgs.push('--twin', twin.url);
      console.log(`twin        ${twin.url}`);
    } else {
      initArgs.push('--key-env', 'STRIPE_TEST_KEY', '--safety', 'staging');
      initEnv['STRIPE_TEST_KEY'] = credentials.stripeKey;
    }

    const init = await rigorrun(initArgs, home, 120_000, initEnv);
    if (init.code !== 0) throw new Error(`rigorrun stripe init failed: ${init.stderr.trim()}`);
    const made = JSON.parse(init.stdout.slice(init.stdout.indexOf('{'))) as {
      projectId: string;
      cases: string[];
    };
    for (const caseId of STRIPE_CASE_IDS) {
      if (!made.cases.includes(caseId)) throw new Error(`The suite has no case ${caseId}.`);
    }
    console.log(`project     ${made.projectId} (${made.cases.length} cases in the suite)`);

    for (const variant of VARIANTS) {
      const agent = await startAgent(
        variant,
        settings,
        credentials,
        { baseUrl, key: credentials.stripeKey },
        join(scratch, 'transcripts', variant),
      );
      agentsOut.push(agent);
      checkMeta(agent, settings);
      if (freeze) {
        const frozen = freeze.variants[variant];
        if (
          frozen.promptSha256 !== agent.meta.promptSha256 ||
          frozen.toolsSha256 !== agent.meta.toolsSha256
        ) {
          throw new Refusal(
            `The ${variant} agent's prompt or tools are not the ones frozen in freeze.json. ` +
              'A change after the freeze needs a new pre-registration, not a recording.',
          );
        }
      }
      const added = await rigorrun(
        [
          'agent',
          'add',
          '--project',
          made.projectId,
          '--name',
          variant,
          '--black-box',
          agent.url,
          '--claim-path',
          'message',
        ],
        home,
        60_000,
      );
      if (added.code !== 0) throw new Error(`agent add ${variant} failed: ${added.stderr.trim()}`);
    }

    // One recording per variant: seven cases, one attempt each.
    const caseArgs = STRIPE_CASE_IDS.flatMap((caseId) => ['--case', caseId]);
    const perCase = (settings.caseTimeoutMs ?? STRIPE_CASE_TIMEOUT_MS) + 120_000;
    const runIds: Partial<Record<Variant, string>> = {};
    const store = new ProjectStore(storeRoot(home));
    for (const variant of VARIANTS) {
      console.log(`running     ${variant}: ${STRIPE_CASE_IDS.length} cases, 1 attempt each`);
      const ran = await rigorrun(
        [
          'run',
          '--project',
          made.projectId,
          '--agent',
          variant,
          ...caseArgs,
          ...(settings.caseTimeoutMs === null
            ? []
            : ['--case-timeout', String(settings.caseTimeoutMs)]),
        ],
        home,
        STRIPE_CASE_IDS.length * perCase + 300_000,
      );
      // 0 and 1 are verdicts; anything else is RigorRun or its setup failing.
      if (ran.code !== 0 && ran.code !== 1) {
        throw new Error(
          `rigorrun run (${variant}) failed: ${ran.stderr.trim() || ran.stdout.trim()}`,
        );
      }
      const project = await store.read(made.projectId);
      const entry = [...project.runs]
        .reverse()
        .find((candidate) => candidate.agentName === variant);
      if (!entry) throw new Error(`No stored run for ${variant}.`);
      runIds[variant] = entry.runId;
    }

    const runs = {} as Record<Variant, RunResult>;
    for (const variant of VARIANTS) {
      const run = await store.readRun<RunResult>(made.projectId, runIds[variant]!);
      if (!run) throw new Error(`The stored run for ${variant} could not be read.`);
      checkRun(run, variant);
      runs[variant] = run;
    }

    const suite = await store.readArtefact<Benchmark>(made.projectId, 'benchmark');
    if (!suite) throw new Error('The project has no suite.');
    const benchmark = selectCases(suite, [...STRIPE_CASE_IDS]);
    const combined = await sideBySide(runs);
    if ((await hashValue(benchmark)) !== combined.benchmarkHash) {
      throw new Error('The suite read back is not the one the runs ran.');
    }
    const simulated = combined.limits.some((limit) => limit.id === 'simulated');
    if (simulated !== (settings.system === 'twin')) {
      throw new Error(
        `The run ${simulated ? 'carries' : 'lacks'} the simulated limit on --system ${settings.system}.`,
      );
    }

    const variants = {} as Record<Variant, ReplayVariant>;
    for (const agent of agentsOut) {
      const run = runs[agent.variant];
      variants[agent.variant] = {
        agentId: run.agents[0]!.id,
        description: DESCRIPTIONS[agent.variant],
        promptSha256: agent.meta.promptSha256,
        toolsSha256: agent.meta.toolsSha256,
        runId: run.runId,
        runResultHash: run.resultHash,
      };
    }
    const replay: Replay & Record<string, unknown> = {
      format: REPLAY_FORMAT,
      recordedAt: combined.finishedAt,
      model: settings.model,
      provider: providerName(settings, credentials),
      temperature: settings.temperature,
      temperatureSource: settings.temperatureSource,
      commit,
      system: SYSTEM_NAMES[settings.system],
      simulated,
      variants,
      discarded: [],
      harness: {
        caseTimeoutMs: settings.caseTimeoutMs,
        minIntervalMs: settings.minIntervalMs,
        attempts: 1,
      },
      ...(settings.mode === 'pilot' ? { pilot: true } : {}),
      benchmark,
      presentation: PRESENTATION,
      resultHash: hashRun(combined),
      run: combined,
    };
    verifyReplay(replay);
    return { replay, runs, agents: agentsOut };
  } finally {
    await twin?.close();
  }
}

/** Holds one variant's stored run to what was asked: one agent, the seven cases, one attempt. */
function checkRun(run: RunResult, variant: Variant): void {
  if (run.agents.length !== 1 || run.agents[0]!.name !== variant) {
    throw new Error(`The run read back for ${variant} is not ${variant}'s alone.`);
  }
  const ids = run.caseResults.map((entry) => entry.caseId);
  if (JSON.stringify(ids) !== JSON.stringify([...STRIPE_CASE_IDS])) {
    throw new Error(`The ${variant} run covered ${ids.join(', ')}, not the seven cases once each.`);
  }
}

/**
 * The two variants' runs, side by side, as one result: the shape a replay
 * holds and the site reads.
 *
 * Every case result and score is the runner's own, untouched. The verdict is
 * the runner's own rule (`decideVerdict`) over those scores, and the hash is
 * sealed the way the runner seals one. What the two runs must agree on —
 * suite, system, strength, isolation, limits — is checked rather than assumed,
 * and each original run's id and sealed hash travel in `variants`, with the
 * runs themselves kept whole beside the recording.
 */
async function sideBySide(runs: Record<Variant, RunResult>): Promise<RunResult> {
  const [first, ...rest] = VARIANTS.map((variant) => runs[variant]);
  for (const other of rest) {
    for (const field of [
      'schemaVersion',
      'benchmarkId',
      'benchmarkHash',
      'contractHash',
      'environment',
      'verification',
      'isolation',
      'limits',
      'notTestable',
      'suiteQuality',
      'rigorrunVersion',
    ] as const) {
      if (JSON.stringify(first![field]) !== JSON.stringify(other![field])) {
        throw new Error(`The variants' runs differ in ${field}, so they are not one recording.`);
      }
    }
  }
  const all = VARIANTS.map((variant) => runs[variant]);
  const scores = all.flatMap((run) => run.scores);
  const verdict = decideVerdict(scores);
  for (const sentence of new Set(all.flatMap((run) => run.verdict.rationale))) {
    if (sentence.startsWith('Suite quality:') && !verdict.rationale.includes(sentence)) {
      verdict.rationale.push(sentence);
    }
  }
  const combined: RunResult = {
    ...first!,
    runId: all.map((run) => run.runId).join('+'),
    startedAt: first!.startedAt,
    finishedAt: all[all.length - 1]!.finishedAt,
    agents: all.flatMap((run) => run.agents),
    caseResults: all.flatMap((run) => run.caseResults),
    scores,
    verdict,
    resultHash: '',
  };
  combined.resultHash = await hashValue({ ...combined, resultHash: '' });
  return combined;
}

// ------------------------------------------------------------- what is kept

/**
 * Copies each agent's transcripts, refusing any that carries a credential: a
 * key's value, or `key=` as a key in a URL would be written. The agent strips
 * both before writing; this is the second lock, on what is kept.
 */
async function keepTranscripts(
  agents: readonly RunningAgent[],
  destination: string,
  credentials: Credentials,
): Promise<number> {
  let kept = 0;
  for (const agent of agents) {
    const into = join(destination, agent.variant);
    await mkdir(into, { recursive: true });
    const files = await readdir(agent.transcripts).catch(() => [] as string[]);
    for (const file of files.filter((name) => name.endsWith('.jsonl')).sort()) {
      const text = await readFile(join(agent.transcripts, file), 'utf8');
      if (credentials.secrets.some((secret) => text.includes(secret)) || text.includes('key=')) {
        await rm(destination, { recursive: true, force: true });
        throw new Error(
          `A transcript of ${agent.variant} (${file}) carries a credential, so none is kept.`,
        );
      }
      await copyFile(join(agent.transcripts, file), join(into, file));
      kept += 1;
    }
  }
  return kept;
}

async function keepRuns(runs: Record<Variant, RunResult>, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const variant of VARIANTS) {
    const run = runs[variant];
    await writeFile(
      join(destination, `${variant}.${run.runId}.json`),
      `${JSON.stringify(run, null, 2)}\n`,
    );
  }
}

/** One line per variant: each case and its verdict, in the suite's order. */
function outcomeLines(run: RunResult, variants: Record<string, ReplayVariant>): string[] {
  return Object.entries(variants).map(([name, variant]) => {
    const cases = run.caseResults.filter((entry) => entry.agentId === variant.agentId);
    return `${name}: ${cases.map((entry) => `${entry.caseId} ${caseOutcome(entry)}`).join(', ')}`;
  });
}

async function nextPilotNumber(): Promise<number> {
  const log = await readFile(PILOT_LOG, 'utf8').catch(() => '');
  return (log.match(/^## Pilot \d+/gm) ?? []).length + 1;
}

async function logPilot(
  settings: Settings,
  credentials: Credentials,
  at: { commit: string; dirty: string[] },
  agents: readonly RunningAgent[],
  outcome: string[],
): Promise<void> {
  const number = await nextPilotNumber();
  const hashes = agents.map(
    (agent) =>
      `${agent.variant} prompt ${agent.meta.promptSha256.slice(0, 12)}, tools ${agent.meta.toolsSha256.slice(0, 12)}`,
  );
  const entry = [
    '',
    `## Pilot ${number} — ${new Date().toISOString()}`,
    '',
    `- **System:** ${SYSTEM_NAMES[settings.system]}. **Model:** \`${settings.model}\` through ${providerName(settings, credentials)} (\`${settings.provider}\` wire format), temperature ${settings.temperature} (${settings.temperatureSource}).`,
    `- **Commit:** \`${at.commit}\`${at.dirty.length > 0 ? `, with uncommitted changes to ${at.dirty.map((path) => `\`${path}\``).join(', ')}` : ', clean'}.`,
    `- **Harness:** case timeout ${settings.caseTimeoutMs ?? `the suite’s own (${STRIPE_CASE_TIMEOUT_MS})`} ms; MIN_INTERVAL_MS ${settings.minIntervalMs ?? 'unset'}; one attempt per case.`,
    `- **Agents (GET /meta):** ${hashes.length > 0 ? hashes.join('; ') : 'none started'}.`,
    `- **Changed since the previous pilot, and why:** ${settings.note}`,
    `- **Outcome:** ${outcome.join('; ')}`,
    `- **Output:** \`${settings.out}\`, outside the repository's evidence. Not evidence; never bundled.`,
    '',
  ].join('\n');
  await appendFile(PILOT_LOG, entry);
}

// ------------------------------------------------------------------ the modes

async function main(): Promise<number> {
  const settings = settingsFrom(process.argv.slice(2));
  const credentials = credentialsFor(settings);
  const name = providerName(settings, credentials);
  const current = await tree();

  console.log(
    `${settings.mode.padEnd(12)}${settings.model} (${name}), temperature ${settings.temperature}, ` +
      `on ${SYSTEM_NAMES[settings.system]}`,
  );

  let freeze: Freeze | undefined;
  let replaced: Replacement = { discarded: [], moveAside: async () => {} };
  if (settings.mode === 'freeze') return writeFreeze(settings, credentials, name, current);
  if (settings.mode === 'record') {
    freeze = await readFreeze();
    if (!freeze) {
      throw new Refusal(
        'There is no freeze.json. Run with --freeze first: the model, the temperature and both ' +
          'variants’ hashes are fixed before the first recorded case.',
      );
    }
    const differences = againstFreeze(freeze, settings, name);
    if (differences.length > 0) {
      throw new Refusal(`This is not the frozen recording:\n  ${differences.join('\n  ')}`);
    }
    if (current.dirty.length > 0) {
      throw new Refusal(`Uncommitted product changes: ${current.dirty.join(', ')}.`);
    }
    const changed = (await git(['diff', '--name-only', freeze.commit, 'HEAD']))
      .split('\n')
      .filter(Boolean)
      .filter(isProduct);
    if (changed.length > 0) {
      throw new Refusal(
        `The product changed since the freeze at ${freeze.commit.slice(0, 7)}: ${changed.join(', ')}.`,
      );
    }
    replaced = await replacing(settings);
  }

  const scratch = await mkdtemp(join(tmpdir(), 'rigorrun-flagship-'));
  const agents: RunningAgent[] = [];
  const startedAt = new Date().toISOString();
  try {
    const recorded = await record(settings, credentials, current.commit, freeze, scratch, agents);
    const replay = recorded.replay;

    if (settings.mode === 'pilot') {
      const files = join(
        dirname(settings.out),
        `${basename(settings.out, extname(settings.out))}-files`,
      );
      await rm(files, { recursive: true, force: true });
      const kept = await keepTranscripts(agents, join(files, 'transcripts'), credentials);
      await keepRuns(recorded.runs, join(files, 'runs'));
      await mkdir(dirname(settings.out), { recursive: true });
      await writeFile(settings.out, `${JSON.stringify(replay, null, 2)}\n`);
      await logPilot(
        settings,
        credentials,
        current,
        agents,
        outcomeLines(replay.run, replay.variants!),
      );
      console.log(`wrote       ${settings.out} (a pilot: not evidence)`);
      console.log(`kept        ${kept} transcripts and both runs in ${files}`);
      console.log(`logged      ${relative(ROOT, PILOT_LOG)}`);
      return 0;
    }

    // The recording. Earlier attempts that never completed are listed first.
    const incomplete = await readIncomplete();
    replay.discarded = [...replaced.discarded, ...incomplete];
    await replaced.moveAside();
    await mkdir(RECORDING_DIR, { recursive: true });
    const kept = await keepTranscripts(agents, join(RECORDING_DIR, 'transcripts'), credentials);
    await keepRuns(recorded.runs, join(RECORDING_DIR, 'runs'));
    await mkdir(dirname(settings.out), { recursive: true });
    await writeFile(settings.out, `${JSON.stringify(replay, null, 2)}\n`);
    await rm(INCOMPLETE, { force: true });
    console.log(`wrote       ${relative(ROOT, settings.out)}`);
    console.log(
      `kept        ${kept} transcripts and both runs in ${relative(ROOT, RECORDING_DIR)}`,
    );
    for (const row of outcomeLines(replay.run, replay.variants!)) console.log(`            ${row}`);
    return 0;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    if (settings.mode === 'pilot') {
      await logPilot(settings, credentials, current, agents, [`did not complete: ${cause}`]);
    } else if (!(error instanceof Refusal)) {
      // A recording that cannot complete is discarded whole and made again, and
      // the pre-registration requires the attempt and its cause to be listed.
      await noteIncomplete({
        reason: 'did not complete',
        cause,
        startedAt,
        failedAt: new Date().toISOString(),
      });
    }
    throw error;
  } finally {
    await Promise.all(agents.map(stopAgent));
    await rm(scratch, { recursive: true, force: true });
  }
}

async function writeFreeze(
  settings: Settings,
  credentials: Credentials,
  name: string,
  current: { commit: string; dirty: string[] },
): Promise<number> {
  if (current.dirty.length > 0) {
    throw new Refusal(
      `The freeze names the commit the product is at, so it needs a clean product tree. ` +
        `Uncommitted: ${current.dirty.join(', ')}.`,
    );
  }
  const existing = await readFreeze();
  if (existing) {
    throw new Refusal(
      `freeze.json already exists (frozen ${existing.frozenAt} at ${existing.commit.slice(0, 7)}). ` +
        'A new freeze means removing it by hand and saying why in pilot-log.md.',
    );
  }
  let listModels: Freeze['listModels'];
  if (settings.provider === 'gemini') {
    const calledAt = new Date().toISOString();
    const models = await listGeminiModels(credentials);
    if (!models.includes(settings.model)) {
      throw new Refusal(
        `ListModels does not offer ${settings.model} for generateContent with this key.`,
      );
    }
    listModels = { calledAt, models };
  }

  // The freeze sends no ticket, so the agents never reach a Stripe: they are
  // started only to say what they would send their model.
  const scratch = await mkdtemp(join(tmpdir(), 'rigorrun-freeze-'));
  const agents: RunningAgent[] = [];
  try {
    for (const variant of VARIANTS) {
      const agent = await startAgent(
        variant,
        settings,
        credentials,
        { baseUrl: 'http://127.0.0.1:9', key: TWIN_AGENT_KEY },
        join(scratch, variant),
      );
      agents.push(agent);
      checkMeta(agent, settings);
    }
  } finally {
    await Promise.all(agents.map(stopAgent));
    await rm(scratch, { recursive: true, force: true });
  }
  const variants = Object.fromEntries(
    agents.map((agent) => [
      agent.variant,
      { promptSha256: agent.meta.promptSha256, toolsSha256: agent.meta.toolsSha256 },
    ]),
  ) as Freeze['variants'];
  const freeze: Freeze = {
    frozenAt: new Date().toISOString(),
    commit: current.commit,
    system: settings.system,
    provider: settings.provider,
    providerName: name,
    model: settings.model,
    temperature: settings.temperature,
    temperatureSource: settings.temperatureSource,
    harness: {
      caseTimeoutMs: settings.caseTimeoutMs,
      minIntervalMs: settings.minIntervalMs,
      attempts: 1,
      cases: [...STRIPE_CASE_IDS],
    },
    variants,
    ...(listModels ? { listModels } : {}),
  };
  await writeFile(FREEZE, `${JSON.stringify(freeze, null, 2)}\n`);
  console.log(`wrote       ${relative(ROOT, FREEZE)} at ${current.commit.slice(0, 7)}`);
  return 0;
}

/** What a new recording replaces, and how its files are moved aside once the new one exists. */
interface Replacement {
  discarded: DiscardedRecording[];
  moveAside: () => Promise<void>;
}

/**
 * What replacing the existing recording would discard, or a refusal.
 *
 * The first complete recording is final. It is replaced only when it holds a
 * case the harness or the agent's plumbing lost (quota, network, a crash),
 * only with a reason given, and its files are moved aside rather than deleted
 * — after the new recording has completed, so a failed attempt leaves the old
 * one exactly where it was.
 */
async function replacing(settings: Settings): Promise<Replacement> {
  const text = await readFile(settings.out, 'utf8').catch(() => undefined);
  if (text === undefined) {
    if (settings.discard !== null) throw new Refusal('There is no recording to discard.');
    return { discarded: [], moveAside: async () => {} };
  }
  const existing = JSON.parse(text) as Replay;
  if (settings.discard === null) {
    throw new Refusal(
      `${relative(ROOT, settings.out)} was recorded ${existing.recordedAt}. The first complete ` +
        'recording is final; it is replaced only with --discard "<reason>", for a harness failure.',
    );
  }
  const lost = existing.run.caseResults.filter((entry) => DISCARDABLE.has(caseOutcome(entry)));
  if (lost.length === 0) {
    throw new Refusal(
      'That recording has no HARNESS_FAILURE or AGENT_FAILURE case, so it is final: a recording ' +
        'that completes is never made again to change what it shows.',
    );
  }
  const agentNames = new Map(existing.run.agents.map((agent) => [agent.id, agent.name]));
  const aside = join(RECORDING_DIR, 'discarded', existing.recordedAt.replace(/[:.]/g, '-'));
  const moveAside = async () => {
    for (const part of ['runs', 'transcripts']) {
      const from = join(RECORDING_DIR, part);
      if (
        await readdir(from)
          .then(() => true)
          .catch(() => false)
      ) {
        await mkdir(aside, { recursive: true });
        await rename(from, join(aside, part));
      }
    }
  };
  const discarded: DiscardedRecording[] = [
    ...(existing.discarded ?? []),
    {
      reason: settings.discard,
      recordedAt: existing.recordedAt,
      model: existing.model,
      commit: existing.commit,
      resultHash: existing.resultHash,
      lost: lost.map((entry: CaseResult) => ({
        variant: agentNames.get(entry.agentId) ?? entry.agentId,
        caseId: entry.caseId,
        outcome: caseOutcome(entry),
        why: entry.outcomeReason,
      })),
      files: relative(ROOT, aside),
    },
  ];
  return { discarded, moveAside };
}

async function readIncomplete(): Promise<DiscardedRecording[]> {
  const text = await readFile(INCOMPLETE, 'utf8').catch(() => undefined);
  return text === undefined ? [] : (JSON.parse(text) as DiscardedRecording[]);
}

async function noteIncomplete(entry: DiscardedRecording): Promise<void> {
  const entries = [...(await readIncomplete()), entry];
  await mkdir(RECORDING_DIR, { recursive: true });
  await writeFile(INCOMPLETE, `${JSON.stringify(entries, null, 2)}\n`);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      error instanceof Refusal
        ? `refused: ${error.message}`
        : `failed: ${(error as Error).message}`,
    );
    process.exitCode = error instanceof Refusal ? 2 : 1;
  },
);
