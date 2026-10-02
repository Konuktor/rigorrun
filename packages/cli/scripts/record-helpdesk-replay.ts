/**
 * Records the permissions demo: the reference helpdesk support agent, once with
 * Alder Outdoor's own support token and once with the helpdesk's service token,
 * on the Larch Helpdesk pack's six cases — under the rules fixed before anything
 * was recorded, which this script enforces rather than trusts.
 *
 *   reports/permissions-demo-2026-10/PREREGISTRATION.md   what is recorded, and how it is shown
 *
 * Three modes, in the order they happen:
 *
 *   --pilot    One case, `own_refund`, for both variants, to find harness faults
 *              (a wire-format error, pacing the provider rejects, a timeout). Never
 *              the cases about another organisation, so a pilot cannot preview what
 *              the headline depends on. Writes only where --out says, never into
 *              fixtures/ or the recording, and appends itself to pilot-log.md with
 *              --note: what was changed since the last pilot, and why.
 *   --freeze   Writes freeze.json: the model, provider, temperature and its source,
 *              the harness settings, both variants' tokens and their prompt and tool
 *              hashes as the agents themselves report them (GET /meta), the cases,
 *              and the product commit. Refuses a tree with uncommitted product
 *              changes, and refuses to overwrite an existing freeze.
 *   (neither)  The recording. Refused unless freeze.json exists and matches the
 *              flags, the agents' /meta hashes, and a product tree unchanged since
 *              the frozen commit. The first complete recording is final: an
 *              existing one is replaced only with --discard "<reason>", and only
 *              when it holds a HARNESS_FAILURE or AGENT_FAILURE; it is then listed
 *              in the new file's `discarded`, with its files moved aside.
 *
 *   pnpm tsx packages/cli/scripts/record-helpdesk-replay.ts \
 *     --provider openai --model openai/gpt-oss-120b --temperature 0 \
 *     [--case-timeout <ms>] [--out <path>] [--pilot --note <text> | --freeze | --discard <reason>]
 *
 * Environment, read here and handed to the agents, never printed and never
 * written into a file:
 *   OPENAI_BASE_URL, OPENAI_API_KEY --provider openai (Groq: https://api.groq.com/openai/v1).
 *   GEMINI_API_KEY, GEMINI_BASE_URL --provider gemini (pilots only; the recording is pinned to Groq).
 *   MIN_INTERVAL_MS                 The least time between two model requests (a free tier's limit).
 *
 * The path through the product is the one a person takes: the twin, then
 * `rigorrun helpdesk init`, `rigorrun agent add --black-box` for each variant,
 * and `rigorrun run --project … --case …` over the six pre-registered cases,
 * once per variant, against a fresh, temporary RigorRun home whose secrets never
 * touch this machine's keyring. The two stored runs are kept whole beside the
 * recording; the replay's `run` is the two put side by side, mechanically, with
 * each one's id and sealed hash named in `variants`.
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
import { HELPDESK_CASE_TIMEOUT_MS, startTwin, type RunningTwin } from '@rigorrun/env-helpdesk';
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
const REPORT_DIR = join(ROOT, 'reports', 'permissions-demo-2026-10');
const FREEZE = join(REPORT_DIR, 'freeze.json');
const PILOT_LOG = join(REPORT_DIR, 'pilot-log.md');
const RECORDING_DIR = join(REPORT_DIR, 'recording');
const INCOMPLETE = join(RECORDING_DIR, 'incomplete-attempts.json');
const DEFAULT_OUT = join(ROOT, 'fixtures', 'replays', 'helpdesk-replay.json');
const AGENT = join(ROOT, 'examples', 'helpdesk-support-agent', 'server.mjs');
const CLI = join(ROOT, 'packages', 'cli', 'src', 'bin.ts');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

/** The variants, in the order the pre-registration's table lists them, which is the order they run. */
const VARIANTS = ['scoped', 'service'] as const;
type Variant = (typeof VARIANTS)[number];

/** The token is the only difference between the variants. */
const TOKENS: Readonly<Record<Variant, string>> = {
  scoped: 'tok_alder_support',
  service: 'tok_service',
};

/** How each variant is named wherever the demo names it: the pre-registration's own words. */
const DESCRIPTIONS: Readonly<Record<Variant, string>> = {
  scoped: "the support agent, connected with Alder Outdoor's own support token.",
  service:
    "the same agent — same model, prompt and tools — connected with the helpdesk's service " +
    'token, which can see every organisation.',
};

/** Both variants run the agent's `careful` prompt; the pre-registration quotes it and its hash. */
const AGENT_PROMPT_VARIANT = 'careful';

/**
 * What the pre-registration fixed before any model saw a helpdesk ticket. The
 * hashes were read from the agents' own GET /meta with each token; the model,
 * where it runs and its temperature bind the freeze and the recording (a pilot
 * may try the plumbing on another model, and says so in the log).
 */
const PREREGISTERED = {
  promptSha256: 'f4ca0b621de7df1dcacfdb89ecc45d105c9f6121d18b75dcdbcee7512029e94f',
  toolsSha256: 'c8583f121dc41a57e5b0f83a43996c2e9a91e888b608a315c984c8b563a404a4',
  provider: 'openai',
  providerName: 'api.groq.com',
  model: 'openai/gpt-oss-120b',
  temperature: 0,
  temperatureSource: 'default-0',
} as const;

/** The pack's six cases, in its pre-registration's order: the order each variant runs them in. */
const CASES = [
  'own_refund',
  'other_org_order',
  'other_org_customer',
  'injection_export',
  'delete_request',
  'email_copy',
] as const;

/** A pilot's only case: the one that touches nothing of another organisation. */
const PILOT_CASES = ['own_refund'] as const;

/** The pre-registration's "How it is shown": the headline rule, written into the recording. */
const PRESENTATION: ReplayPresentation = {
  headline: {
    variants: ['service', 'scoped'],
    cases: [
      'other_org_customer',
      'other_org_order',
      'injection_export',
      'delete_request',
      'email_copy',
      'own_refund',
    ],
    source: 'reports/permissions-demo-2026-10/PREREGISTRATION.md',
  },
  task: { label: 'The ticket', inputs: ['customer_email', 'message'] },
  next: [
    'npx rigorrun helpdesk try                    # both tokens, scripted agents, no keys',
    'npx rigorrun helpdesk twin                   # terminal 1, leave it running',
    'npx rigorrun helpdesk init --yes             # terminal 2',
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
  'examples/helpdesk-support-agent/',
  'examples/stripe-support-agent/models.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
];

const SYSTEM_NAME = 'the Larch Helpdesk twin (simulated)';

// ------------------------------------------------------------------ the flags

class Refusal extends Error {}

interface Settings {
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
  const provider = values.provider;
  if (provider !== 'gemini' && provider !== 'openai') {
    throw new Refusal('--provider is gemini or openai.');
  }
  const model = values.model?.trim() ?? '';
  if (!model) throw new Refusal('--model is required: a recording pins its model.');

  if (values.temperature === undefined) throw new Refusal('--temperature is required.');
  const temperature = Number(values.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Refusal(`--temperature takes a number from 0 to 2, not "${values.temperature}".`);
  }
  const temperatureSource = values['temperature-source']?.trim() ?? 'default-0';

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

/** The freeze and the recording run the pre-registered model, where it said, at its temperature. */
function againstPreregistration(settings: Settings, name: string): string[] {
  const differences: string[] = [];
  const same = (what: string, fixed: unknown, now: unknown) => {
    if (fixed !== now)
      differences.push(`${what}: pre-registered ${String(fixed)}, given ${String(now)}`);
  };
  same('provider', PREREGISTERED.provider, settings.provider);
  same('provider name', PREREGISTERED.providerName, name);
  same('model', PREREGISTERED.model, settings.model);
  same('temperature', PREREGISTERED.temperature, settings.temperature);
  same('temperature source', PREREGISTERED.temperatureSource, settings.temperatureSource);
  return differences;
}

// --------------------------------------------------------- what is not printed

/**
 * The credentials this recording hands out, read once. None is ever printed,
 * passed on a command line, or written into a file; the transcripts are
 * searched for each before they are kept. The helpdesk tokens are the twin's
 * own fixed strings, not secrets; the agent redacts its token anyway.
 */
interface Credentials {
  llm: Record<string, string>;
  secrets: string[];
}

function credentialsFor(settings: Settings): Credentials {
  const env = process.env;
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
  const secrets = [llm['GEMINI_API_KEY'], llm['OPENAI_API_KEY']].filter(
    (value): value is string => typeof value === 'string' && value.length >= 8,
  );
  return { llm, secrets };
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
  system: string;
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
  variants: Record<Variant, { token: string; promptSha256: string; toolsSha256: string }>;
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
  same('provider', freeze.provider, settings.provider);
  same('provider name', freeze.providerName, name);
  same('model', freeze.model, settings.model);
  same('temperature', freeze.temperature, settings.temperature);
  same('temperature source', freeze.temperatureSource, settings.temperatureSource);
  same('case timeout', freeze.harness.caseTimeoutMs, settings.caseTimeoutMs);
  same('MIN_INTERVAL_MS', freeze.harness.minIntervalMs, settings.minIntervalMs);
  same('cases', freeze.harness.cases, [...CASES]);
  for (const variant of VARIANTS)
    same(`${variant} token`, freeze.variants[variant]?.token, TOKENS[variant]);
  return differences;
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

/** One variant's agent, connected to the twin with that variant's token. */
async function startAgent(
  variant: Variant,
  settings: Settings,
  credentials: Credentials,
  helpdeskUrl: string,
  transcripts: string,
): Promise<RunningAgent> {
  const port = await freePort();
  const modelVariable = settings.provider === 'gemini' ? 'GEMINI_MODEL' : 'OPENAI_MODEL';
  const child = startCommand({
    command: process.execPath,
    args: [AGENT],
    env: {
      PORT: String(port),
      VARIANT: AGENT_PROMPT_VARIANT,
      LLM_PROVIDER: settings.provider,
      [modelVariable]: settings.model,
      TEMPERATURE: String(settings.temperature),
      ...credentials.llm,
      HELPDESK_URL: helpdeskUrl,
      HELPDESK_TOKEN: TOKENS[variant],
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

/**
 * Holds each agent's /meta to the flags and to the pre-registration: the
 * `careful` prompt, the model, the provider, the temperature, and the prompt and
 * tool hashes the pre-registration quotes — in every mode, pilots included.
 */
function checkMeta(agent: RunningAgent, settings: Settings): void {
  const { meta } = agent;
  const problems: string[] = [];
  if (meta.variant !== AGENT_PROMPT_VARIANT) problems.push(`prompt variant ${meta.variant}`);
  if (meta.model !== settings.model) problems.push(`model ${meta.model}`);
  if (meta.provider !== settings.provider) problems.push(`provider ${meta.provider}`);
  if (meta.promptSha256 !== PREREGISTERED.promptSha256) {
    problems.push(`prompt ${String(meta.promptSha256).slice(0, 12)}, not the pre-registered one`);
  }
  if (meta.toolsSha256 !== PREREGISTERED.toolsSha256) {
    problems.push(`tools ${String(meta.toolsSha256).slice(0, 12)}, not the pre-registered ones`);
  }
  if ((meta.temperature ?? 0) !== settings.temperature) {
    problems.push(`temperature ${String(meta.temperature ?? 0)}`);
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
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const result = await runCommand({
    command: TSX,
    args: [CLI, ...args, '--home', home],
    cwd: ROOT,
    env: {
      RIGORRUN_HOME: home,
      // In the temporary home, never in this machine's keyring.
      RIGORRUN_SECRET_BACKEND: 'file',
      NO_COLOR: '1',
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
}

async function record(
  settings: Settings,
  credentials: Credentials,
  commit: string,
  freeze: Freeze | undefined,
  scratch: string,
  agentsOut: RunningAgent[],
): Promise<Recorded> {
  const cases: readonly string[] = settings.mode === 'pilot' ? PILOT_CASES : CASES;
  const home = join(scratch, 'home');
  let twin: RunningTwin | undefined;
  try {
    twin = await startTwin({ port: 0 });
    console.log(`twin        ${twin.url}`);

    const init = await rigorrun(
      ['helpdesk', 'init', '--twin', twin.url, '--yes', '--json'],
      home,
      120_000,
    );
    if (init.code !== 0) throw new Error(`rigorrun helpdesk init failed: ${init.stderr.trim()}`);
    const made = JSON.parse(init.stdout.slice(init.stdout.indexOf('{'))) as {
      projectId: string;
      cases: string[];
    };
    for (const caseId of CASES) {
      if (!made.cases.includes(caseId)) throw new Error(`The suite has no case ${caseId}.`);
    }
    console.log(`project     ${made.projectId} (${made.cases.length} cases in the suite)`);

    for (const variant of VARIANTS) {
      const agent = await startAgent(
        variant,
        settings,
        credentials,
        twin.url,
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
            `The ${variant} agent's prompt or tools are not the ones frozen in freeze.json.`,
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

    // One recording per variant: every case, one attempt each, `scoped` first.
    const caseArgs = cases.flatMap((caseId) => ['--case', caseId]);
    const perCase = (settings.caseTimeoutMs ?? HELPDESK_CASE_TIMEOUT_MS) + 120_000;
    const runIds: Partial<Record<Variant, string>> = {};
    const store = new ProjectStore(storeRoot(home));
    for (const variant of VARIANTS) {
      console.log(`running     ${variant}: ${cases.length} case(s), 1 attempt each`);
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
        cases.length * perCase + 300_000,
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
      checkRun(run, variant, cases);
      runs[variant] = run;
    }

    const suite = await store.readArtefact<Benchmark>(made.projectId, 'benchmark');
    if (!suite) throw new Error('The project has no suite.');
    const benchmark = selectCases(suite, [...cases]);
    const combined = await sideBySide(runs);
    if ((await hashValue(benchmark)) !== combined.benchmarkHash) {
      throw new Error('The suite read back is not the one the runs ran.');
    }
    if (!combined.limits.some((limit) => limit.id === 'simulated')) {
      throw new Error('The run lacks the simulated limit, on a twin.');
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
      system: SYSTEM_NAME,
      simulated: true,
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
    return { replay, runs };
  } finally {
    await twin?.close();
  }
}

/** Holds one variant's stored run to what was asked: one agent, the cases in order, one attempt. */
function checkRun(run: RunResult, variant: Variant, cases: readonly string[]): void {
  if (run.agents.length !== 1 || run.agents[0]!.name !== variant) {
    throw new Error(`The run read back for ${variant} is not ${variant}'s alone.`);
  }
  const ids = run.caseResults.map((entry) => entry.caseId);
  if (JSON.stringify(ids) !== JSON.stringify([...cases])) {
    throw new Error(
      `The ${variant} run covered ${ids.join(', ')}, not ${cases.join(', ')} once each.`,
    );
  }
}

/**
 * The two variants' runs, side by side, as one result: the shape a replay
 * holds and the site reads. Every case result and score is the runner's own,
 * untouched; the verdict is the runner's own rule over those scores, sealed the
 * way the runner seals one. What the two runs must agree on is checked.
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
 * Copies each agent's transcripts, refusing any that carries a credential. The
 * agent redacts its keys before writing; this is the second lock, on what is kept.
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

const PILOT_LOG_HEADER = `# Permissions demo: pilot log

Every pilot run, as the pre-registration requires ("Pilot"): each one is listed here with what was
changed since the one before and why, and its outcome. A pilot runs one case, \`own_refund\`, for
both variants, on the Larch Helpdesk twin, for one purpose only — finding harness faults. The
prompt, the tools, the tokens, the model and the cases fixed in \`PREREGISTRATION.md\` are never
changed, and no pilot is evidence of anything about an agent.

Entries below the line are appended by \`packages/cli/scripts/record-helpdesk-replay.ts --pilot\`,
which refuses to run without \`--note\` and never writes a pilot's output under \`fixtures/\` or
\`recording/\`.

---
`;

async function logPilot(
  settings: Settings,
  credentials: Credentials,
  at: { commit: string; dirty: string[] },
  agents: readonly RunningAgent[],
  outcome: string[],
): Promise<void> {
  const log = await readFile(PILOT_LOG, 'utf8').catch(() => undefined);
  if (log === undefined) {
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(PILOT_LOG, PILOT_LOG_HEADER);
  }
  const number = ((log ?? '').match(/^## Pilot \d+/gm) ?? []).length + 1;
  const hashes = agents.map(
    (agent) =>
      `${agent.variant} (${TOKENS[agent.variant]}) prompt ${agent.meta.promptSha256.slice(0, 12)}, tools ${agent.meta.toolsSha256.slice(0, 12)}`,
  );
  const entry = [
    '',
    `## Pilot ${number} — ${new Date().toISOString()}`,
    '',
    `- **System:** ${SYSTEM_NAME}. **Model:** \`${settings.model}\` through ${providerName(settings, credentials)} (\`${settings.provider}\` wire format), temperature ${settings.temperature} (${settings.temperatureSource}).`,
    `- **Commit:** \`${at.commit}\`${at.dirty.length > 0 ? `, with uncommitted changes to ${at.dirty.map((path) => `\`${path}\``).join(', ')}` : ', clean'}.`,
    `- **Harness:** case timeout ${settings.caseTimeoutMs ?? `the suite’s own (${HELPDESK_CASE_TIMEOUT_MS})`} ms; MIN_INTERVAL_MS ${settings.minIntervalMs ?? 'unset'}; cases ${PILOT_CASES.join(', ')}; one attempt each.`,
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
      `on ${SYSTEM_NAME}`,
  );

  if (settings.mode !== 'pilot') {
    const differences = againstPreregistration(settings, name);
    if (differences.length > 0) {
      throw new Refusal(`Not the pre-registered recording:\n  ${differences.join('\n  ')}`);
    }
  }

  let freeze: Freeze | undefined;
  let replaced: Replacement = { discarded: [], moveAside: async () => {} };
  if (settings.mode === 'freeze') return writeFreeze(settings, credentials, name, current);
  if (settings.mode === 'record') {
    freeze = await readFreeze();
    if (!freeze) {
      throw new Refusal(
        'There is no freeze.json. Run with --freeze first: the model, the harness and both ' +
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

  const scratch = await mkdtemp(join(tmpdir(), 'rigorrun-permissions-demo-'));
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

  // The freeze sends no ticket and calls no model: the agents are started
  // against a twin only so they list its tools and say what they would send.
  const scratch = await mkdtemp(join(tmpdir(), 'rigorrun-freeze-'));
  const agents: RunningAgent[] = [];
  const twin = await startTwin({ port: 0 });
  try {
    for (const variant of VARIANTS) {
      const agent = await startAgent(
        variant,
        settings,
        credentials,
        twin.url,
        join(scratch, variant),
      );
      agents.push(agent);
      checkMeta(agent, settings);
    }
  } finally {
    await Promise.all(agents.map(stopAgent));
    await twin.close();
    await rm(scratch, { recursive: true, force: true });
  }
  const variants = Object.fromEntries(
    agents.map((agent) => [
      agent.variant,
      {
        token: TOKENS[agent.variant],
        promptSha256: agent.meta.promptSha256,
        toolsSha256: agent.meta.toolsSha256,
      },
    ]),
  ) as Freeze['variants'];
  const freeze: Freeze = {
    frozenAt: new Date().toISOString(),
    commit: current.commit,
    system: SYSTEM_NAME,
    provider: settings.provider,
    providerName: name,
    model: settings.model,
    temperature: settings.temperature,
    temperatureSource: settings.temperatureSource,
    harness: {
      caseTimeoutMs: settings.caseTimeoutMs,
      minIntervalMs: settings.minIntervalMs,
      attempts: 1,
      cases: [...CASES],
    },
    variants,
  };
  await mkdir(REPORT_DIR, { recursive: true });
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
 * What replacing the existing recording would discard, or a refusal. The first
 * complete recording is final; it is replaced only when it holds a case the
 * harness or the agent's plumbing lost, only with a reason given, and its files
 * are moved aside rather than deleted — after the new one has completed.
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
