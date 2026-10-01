/**
 * `rigorrun demo`, offline: a real, recorded run, replayed in a few seconds.
 *
 * The first minute with RigorRun should show the one thing it is for — an
 * agent confidently reporting work the system does not show — without asking
 * for a key, a network or a model. So the default demo is a replay of a run
 * that really happened, recorded with its model, date and commit.
 *
 * Two kinds of recording are replayed:
 *
 *  - The bundled example's: one agent against the bundled synthetic system,
 *    recorded by `scripts/record-replay.ts`. Always bundled.
 *  - The flagship recording: two variants of one agent against a pack's
 *    system, recorded under a pre-registration by its own script. It carries
 *    its variants, the suite it ran, and how it asks to be shown — which case
 *    is the headline, by a rule fixed before it was made. Bundled when it
 *    exists; `rigorrun demo` prefers it then.
 *
 * Nothing here is written by hand. A recording carries a hash of the run it
 * holds, and a replay whose run does not match its hash is refused rather than
 * shown, so an edited fixture cannot pass itself off as a measurement. The
 * suite a flagship recording carries is held to the run's own hash of it, so
 * the work an agent is shown to have been given is the work it was given.
 *
 * This file knows no system and no business: every name it prints — the
 * system's, the variants', what to call the work — comes from the recording.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  bindCase,
  canonicalJson,
  caseOutcome,
  type Benchmark,
  type CaseResult,
  type RunResult,
} from '@rigorrun/core';
import { STEP_BUDGET_REPORT } from '@rigorrun/agents';
import { explainCase } from '@rigorrun/report';
// Bundled into the published CLI by esbuild, so the default demo needs no file,
// no network and no model at the other end.
import recorded from '../../../fixtures/replays/demo-replay.json' with { type: 'json' };
import { caseLines, clip } from './caseLines.ts';
import { FLAGSHIP_REPLAY_FILE } from './help.ts';
import { CliError } from './io.ts';
import { c, heading, line } from './ui.ts';

export const REPLAY_FORMAT = 'rigorrun/replay/1';

/** One variant of the agent a flagship recording ran, as the recording names it. */
export interface ReplayVariant {
  /** The agent's id in the recorded run. */
  agentId: string;
  /** How the variant is described wherever it is named, in words fixed before recording. */
  description: string;
  /** What the agent itself reported, at recording time, for its prompt and its tools. */
  promptSha256: string;
  toolsSha256: string;
  /** The product run this variant's cases came from, and that run's own sealed hash. */
  runId: string;
  runResultHash: string;
}

/** A recording thrown away whole, and why. Listed so that nothing is quietly re-made. */
export interface DiscardedRecording {
  reason: string;
  [detail: string]: unknown;
}

/** How a flagship recording asks to be shown. Written by its recorder, never by the replay. */
export interface ReplayPresentation {
  /**
   * The headline case, by a rule fixed before the recording was made: the
   * first FAIL of the first variant in this order of cases; failing that, of
   * the next variant; failing every one, none.
   */
  headline: { variants: string[]; cases: string[]; source: string };
  /** What to call the work an agent was given, and which of its inputs summarise it. */
  task: { label: string; inputs: string[] };
  /** What to do next, one line each. */
  next: string[];
}

export interface Replay {
  format: typeof REPLAY_FORMAT;
  recordedAt: string;
  /** The model and where it ran, as the recording script saw them. */
  model: string;
  provider: string;
  /** The product commit the recording ran at. */
  commit: string;
  /** What the system is, in the words the recording may use for it. */
  system: string;
  /** sha256 of JSON.stringify(run). */
  resultHash: string;
  run: RunResult;
  /** The sampling temperature the agent ran at, and where that value came from. */
  temperature?: number;
  temperatureSource?: string;
  /** True when the system was a local twin rather than the real one. */
  simulated?: boolean;
  /** Present on a flagship recording: the variants it ran, by name. */
  variants?: Record<string, ReplayVariant>;
  discarded?: DiscardedRecording[];
  /** The suite exactly as it ran, held to `run.benchmarkHash`. */
  benchmark?: Benchmark;
  presentation?: ReplayPresentation;
  /** A pilot run, made to find harness faults: shown as such, and never bundled. */
  pilot?: boolean;
}

/** A recording of several variants, with what it needs to be shown as one. */
type VariantReplay = Replay & {
  variants: Record<string, ReplayVariant>;
  presentation: ReplayPresentation;
};

/** The recording `rigorrun demo --<bundled example>` replays, and the fallback for `demo`. */
export function bundledReplay(): Replay {
  return recorded as unknown as Replay;
}

/**
 * Where the flagship recording is, when this build carries one.
 *
 * The published bundle carries it beside itself (`build.mjs` copies it into
 * `dist/` when it exists). Run from source, it is the fixture itself — looked
 * for only then, so a bundle can never pick up a file of that name that
 * happens to sit somewhere near wherever it was installed.
 */
function flagshipLocations(): URL[] {
  const here = import.meta.url;
  const bundled = new URL(`./${FLAGSHIP_REPLAY_FILE}`, here);
  if (!here.endsWith('.ts')) return [bundled];
  return [new URL(`../../../fixtures/replays/${FLAGSHIP_REPLAY_FILE}`, here)];
}

/** The flagship recording, or `undefined` when this build does not carry one. */
export async function flagshipReplay(): Promise<Replay | undefined> {
  for (const location of flagshipLocations()) {
    const text = await readFile(location, 'utf8').catch(() => undefined);
    if (text !== undefined) return parseReplay(text, fileURLToPath(location));
  }
  return undefined;
}

/** A recording from a file, for checking one before it is bundled. */
export async function readReplayFile(path: string): Promise<Replay> {
  const text = await readFile(path, 'utf8').catch((error: unknown) => {
    throw new CliError(`Could not read the recording ${path}: ${(error as Error).message}`);
  });
  return parseReplay(text, path);
}

function parseReplay(text: string, where: string): Replay {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError(`${where} is not JSON, so it is not a recording.`);
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof (parsed as { run?: unknown }).run !== 'object' ||
    (parsed as { run?: unknown }).run === null
  ) {
    throw new CliError(`${where} holds no recorded run.`);
  }
  return parsed as Replay;
}

export function hashRun(run: RunResult): string {
  return createHash('sha256').update(JSON.stringify(run)).digest('hex');
}

/** The runner's hash of a suite (`hashValue`), computed synchronously. */
function suiteHash(benchmark: Benchmark): string {
  return `sha256:${createHash('sha256').update(canonicalJson(benchmark)).digest('hex')}`;
}

export function verifyReplay(replay: Replay): void {
  if (replay.format !== REPLAY_FORMAT)
    throw new CliError(`Unknown replay format ${String(replay.format)}.`);
  if (hashRun(replay.run) !== replay.resultHash) {
    throw new CliError(
      'The bundled replay does not match the hash it was recorded with, so it is not shown.',
    );
  }
  if (replay.benchmark !== undefined && suiteHash(replay.benchmark) !== replay.run.benchmarkHash) {
    throw new CliError(
      'The suite in this recording does not match the run it was recorded with, so it is not shown.',
    );
  }
  if (replay.variants !== undefined) {
    const agents = new Set(replay.run.agents.map((agent) => agent.id));
    for (const [name, variant] of Object.entries(replay.variants)) {
      if (!agents.has(variant.agentId)) {
        throw new CliError(`The recording names a variant ${name} its run does not have.`);
      }
    }
    for (const name of replay.presentation?.headline.variants ?? []) {
      if (!(name in replay.variants)) {
        throw new CliError(
          `The recording's headline rule names a variant ${name} it does not have.`,
        );
      }
    }
  }
}

function isVariantReplay(replay: Replay): replay is VariantReplay {
  return replay.variants !== undefined && replay.presentation !== undefined;
}

/** Whether this is a recording of the bundled synthetic system rather than of a real one. */
export function isBundledExample(replay: Replay): boolean {
  return !isVariantReplay(replay);
}

/**
 * The replay, as a person reads it: which cases, and the agent's words beside
 * what the system showed — the checks' findings, and the system's own account
 * where the recording carries one.
 */
export function printReplay(replay: Replay, options: { show?: number; list?: number } = {}): void {
  verifyReplay(replay);
  if (isVariantReplay(replay)) {
    printVariantReplay(replay);
    return;
  }
  const run = replay.run;
  const agentId = run.agents[0]?.id;
  const cases = run.caseResults.filter((entry) => entry.agentId === agentId);
  const outcomes = cases.map((entry) => caseOutcome(entry));
  const count = (outcome: string) => outcomes.filter((value) => value === outcome).length;
  const unsafe = cases.reduce((sum, entry) => sum + entry.unsafeActions, 0);

  heading('RigorRun — a recorded run, replayed');
  line(
    c.grey(
      `${replay.model} (${replay.provider}) against ${replay.system}, recorded ${replay.recordedAt.slice(0, 10)} at ${replay.commit.slice(0, 7)}.`,
    ),
  );
  line(
    c.grey(
      'A real run, replayed offline. Live results vary between runs; `rigorrun demo --live` runs one now.',
    ),
  );
  line();
  line(
    `${cases.length} cases   ${c.green(`${count('PASS')} passed`)}   ${c.red(`${count('FAIL')} failed`)}` +
      (count('ABSTAIN') ? `   ${c.yellow(`${count('ABSTAIN')} undecided`)}` : '') +
      (unsafe ? `   ${c.red(`${unsafe} unsafe actions`)}` : ''),
  );

  // In full, the cases where the agent gave its own account of what it did:
  // the distance between that account and the system is the point. The worst
  // of each kind, so three are three different ways of going wrong.
  const failed = cases.filter((entry) => caseOutcome(entry) === 'FAIL');
  const ordered = worstOfEachKind(failed);
  const inFull = ordered.filter(ownAccount).slice(0, options.show ?? 3);
  for (const entry of inFull) {
    const explained = explainCase(entry);
    line();
    line(
      `${c.red('FAIL')}  ${entry.caseName}${explained.evidence ? c.grey(`  (${explained.evidence})`) : ''}`,
    );
    for (const text of caseLines(explained, {
      claim: 220,
      reality: REALITY_LINES,
      saw: SAW_LINES,
      notChecked: 0,
      readScope: false,
    })) {
      line(text);
    }
  }

  // The rest, a line each: the first thing that went wrong, as the check put it.
  const rest = failed.filter((entry) => !inFull.includes(entry));
  const listed = rest.slice(0, options.list ?? 10);
  if (listed.length > 0) {
    line();
    line(c.bold('The other failures'));
    for (const entry of listed) {
      const failing = entry.assertions.filter((a) => a.status === 'FAIL' || a.status === 'ERROR');
      const first = failing.find((a) => a.unsafe) ?? failing[0];
      line(
        `  ${c.red('x')} ${entry.caseName}${first ? c.grey(`  ${clip(first.message, 110)}`) : ''}`,
      );
    }
  }
  if (rest.length > listed.length) line(c.grey(`  and ${rest.length - listed.length} more.`));
  line();
  line(
    c.grey('`rigorrun demo --report demo.html` writes every case, with its evidence, to one page.'),
  );
  line(
    c.grey(
      `Verification ${run.verification}. The agent's words are shown beside the evidence and never scored.`,
    ),
  );
  line();
  line(
    `${c.bold('Your own agent')}  npx rigorrun   — connect a system, show it the job once, send your agent the work.`,
  );
}

const SAW_LINES = 2;
const REALITY_LINES = 3;

/**
 * Whether the report is the agent's own. An LLM agent that runs out of steps
 * has its report written for it by the adapter, and that sentence is not a
 * claim anybody made about the work.
 */
function ownAccount(entry: CaseResult): boolean {
  const report = entry.agentReport.trim();
  return report.length > 0 && report !== STEP_BUDGET_REPORT;
}

function worstOfEachKind(failed: readonly CaseResult[]): CaseResult[] {
  const byUnsafe = [...failed].sort((a, b) => b.unsafeActions - a.unsafeActions);
  const seen = new Set<string>();
  return byUnsafe.filter((entry) => {
    if (seen.has(entry.category)) return false;
    seen.add(entry.category);
    return true;
  });
}

// ------------------------------------------------------- a flagship recording

/** The widest line a flagship replay prints. A terminal narrower than this wraps; none is wider. */
const WIDTH = 100;

/** One variant as the replay shows it, in the order the run ran them. */
interface ShownVariant {
  name: string;
  agentId: string;
  description: string;
  cases: CaseResult[];
}

/** The headline case, by the recording's own rule, or `undefined` when nothing failed. */
export function headlineCase(replay: Replay): { variant: string; result: CaseResult } | undefined {
  if (!isVariantReplay(replay)) return undefined;
  const rule = replay.presentation.headline;
  for (const variant of rule.variants) {
    const agentId = replay.variants[variant]?.agentId;
    for (const caseId of rule.cases) {
      const result = replay.run.caseResults.find(
        (entry) =>
          entry.agentId === agentId && entry.caseId === caseId && caseOutcome(entry) === 'FAIL',
      );
      if (result) return { variant, result };
    }
  }
  return undefined;
}

function printVariantReplay(replay: VariantReplay): void {
  const run = replay.run;
  const variants = shownVariants(replay);
  const nameWidth = Math.max(...variants.map((variant) => variant.name.length));

  heading('RigorRun — a recorded run, replayed');
  if (replay.pilot === true) {
    line(
      c.yellow('A pilot run, made to find harness faults: not the recording, and not evidence.'),
    );
  }
  for (const sentence of provenance(replay)) {
    for (const text of wrap(sentence, WIDTH)) line(c.grey(text));
  }
  for (const variant of variants) {
    const prefix = `  ${variant.name.padEnd(nameWidth)}  `;
    for (const [index, text] of wrap(variant.description, WIDTH - prefix.length).entries()) {
      line(c.grey(`${index === 0 ? prefix : ' '.repeat(prefix.length)}${text}`));
    }
  }

  line();
  const headline = headlineCase(replay);
  if (headline) printHeadline(replay, headline.variant, headline.result);
  else {
    line(
      c.bold(
        variants.length === 2
          ? 'Neither variant failed a case in this recording.'
          : 'No variant failed a case in this recording.',
      ),
    );
  }

  line();
  printMatrix(variants, headline?.result);
  line();
  for (const variant of variants) {
    line(`  ${c.bold(variant.name.padEnd(nameWidth))}  ${countsOf(variant.cases)}`);
  }
  const discarded = replay.discarded?.length ?? 0;
  if (discarded > 0) {
    line(
      c.grey(
        `  ${discarded} earlier attempt${discarded === 1 ? ' was' : 's were'} discarded whole for a harness failure; the recording lists ${discarded === 1 ? 'it' : 'each'}.`,
      ),
    );
  }
  line();
  line(
    c.grey(
      `Verification ${run.verification}. The agent's words are shown beside the evidence and never scored.`,
    ),
  );
  line(
    c.grey('`rigorrun demo --report demo.html` writes every case, with its evidence, to one page.'),
  );
  if (replay.presentation.next.length > 0) {
    line();
    line(c.bold('Next'));
    for (const text of replay.presentation.next) line(fit(`  ${text}`));
  }
}

/** Model, temperature and provider; then system, date and commit. */
function provenance(replay: VariantReplay): string[] {
  const temperature =
    replay.temperature === undefined
      ? 'temperature not recorded'
      : `temperature ${replay.temperature}`;
  const simulated =
    replay.simulated === true && !/simulated/i.test(replay.system) ? ' (simulated)' : '';
  return [
    `${replay.model}, ${temperature}, through ${replay.provider}.`,
    `Against ${replay.system}${simulated}, recorded ${replay.recordedAt.slice(0, 10)} at ${replay.commit.slice(0, 7)}.`,
  ];
}

function shownVariants(replay: VariantReplay): ShownVariant[] {
  const byAgent = new Map(
    Object.entries(replay.variants).map(([name, variant]) => [variant.agentId, { name, variant }]),
  );
  return replay.run.agents.flatMap((agent) => {
    const found = byAgent.get(agent.id);
    if (!found) return [];
    return [
      {
        name: found.name,
        agentId: agent.id,
        description: found.variant.description,
        cases: replay.run.caseResults.filter((entry) => entry.agentId === agent.id),
      },
    ];
  });
}

function printHeadline(replay: VariantReplay, variant: string, result: CaseResult): void {
  const rule = replay.presentation.headline;
  const explained = explainCase(result);
  line(`${c.bold('The headline')}  ${clip(`${variant} · ${result.caseName}`, WIDTH - 14)}`);
  const others = rule.variants.filter((name) => name !== rule.variants[0]);
  for (const text of wrap(
    `The first failure of ${rule.variants[0]} in a fixed order of cases` +
      (others.length > 0 ? `, else of ${others.join(', else of ')}` : '') +
      `: a rule fixed before the recording (${rule.source}).`,
    WIDTH,
  )) {
    line(c.grey(text));
  }

  const rows: [label: string, text: string][] = [];
  const work = taskSummary(replay, result);
  if (work !== undefined) rows.push([replay.presentation.task.label, work]);
  rows.push([
    'The agent said',
    ownAccount(result)
      ? `"${result.agentReport.trim().split('\n')[0]}"`
      : '(nothing of its own: it gave no sentence)',
  ]);
  const reality = result.reality;
  if (reality && reality.lines.length > 0) {
    const shown = reality.lines.slice(0, REALITY_LINES);
    shown.forEach((text, index) => rows.push([index === 0 ? `${reality.system} shows` : '', text]));
    if (reality.lines.length > shown.length) {
      rows.push(['', c.grey(`and ${reality.lines.length - shown.length} more`)]);
    }
  }
  const outcome = caseOutcome(result);
  const strength = [result.verification ?? replay.run.verification, result.evidenceIndependence];
  rows.push([
    'Verdict',
    [colourVerdict(outcome), ...strength.filter((part) => part !== undefined)].join(' · '),
  ]);
  const saw = explained.saw[0];
  if (saw !== undefined) rows.push(['RigorRun saw', saw]);

  const width = Math.max(...rows.map(([label]) => label.length));
  line();
  for (const [label, text] of rows) {
    const prefix = `${label.padEnd(width)}  `;
    // The verdict is a few words already coloured; everything else is cut to fit.
    line(`${c.grey(prefix)}${label === 'Verdict' ? text : clip(text, WIDTH - prefix.length)}`);
  }
}

/**
 * The work the agent was given, in one line: the inputs the recording names,
 * from the case exactly as it was bound for this attempt.
 */
function taskSummary(replay: VariantReplay, result: CaseResult): string | undefined {
  const testCase = replay.benchmark?.cases.find((entry) => entry.id === result.caseId);
  if (!testCase) return undefined;
  let inputs: Record<string, unknown>;
  try {
    inputs = bindCase(testCase, result.materialized ?? {}).task.inputs;
  } catch {
    // A case that cannot be bound to its own recorded records would show text
    // the agent never read. Nothing is better than that.
    return undefined;
  }
  const parts = replay.presentation.task.inputs.flatMap((name) => {
    const value = inputs[name];
    if (value === undefined) return [];
    const text = (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\s+/g, ' ');
    return [/\s/.test(text) ? `"${text.trim()}"` : text];
  });
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function printMatrix(variants: readonly ShownVariant[], headline: CaseResult | undefined): void {
  const first = variants[0];
  if (!first) return;
  const caseIds = [...new Set(first.cases.map((entry) => entry.caseId))];
  const verdictOf = (variant: ShownVariant, caseId: string) => {
    const found = variant.cases.find((entry) => entry.caseId === caseId);
    return found ? caseOutcome(found) : '—';
  };
  const column = Math.max(
    ...variants.map((variant) => variant.name.length),
    ...variants.flatMap((variant) => caseIds.map((caseId) => verdictOf(variant, caseId).length)),
  );
  const nameWidth = WIDTH - 4 - variants.length * (column + 2);
  const names = caseIds.map(
    (caseId) => first.cases.find((entry) => entry.caseId === caseId)?.caseName ?? caseId,
  );
  const shownWidth = Math.min(
    nameWidth,
    Math.max('Every case'.length, ...names.map((n) => n.length)),
  );

  line(
    `${c.bold('Every case'.padEnd(shownWidth + 2))}  ${variants.map((variant) => c.bold(variant.name.padEnd(column))).join('  ')}`,
  );
  caseIds.forEach((caseId, index) => {
    const marked = headline?.caseId === caseId ? '›' : ' ';
    const name = clip(names[index] ?? caseId, shownWidth).padEnd(shownWidth);
    const cells = variants.map((variant) =>
      colourVerdict(verdictOf(variant, caseId).padEnd(column)),
    );
    line(`${marked} ${name}  ${cells.join('  ')}`.trimEnd());
  });
}

const OUTCOME_WORDS: readonly [outcome: string, words: string][] = [
  ['PASS', 'passed'],
  ['FAIL', 'failed'],
  ['ABSTAIN', 'undecided'],
  ['TIMED_OUT', 'timed out'],
  ['AGENT_FAILURE', 'agent failure(s)'],
  ['HARNESS_FAILURE', 'harness failure(s)'],
];

function countsOf(cases: readonly CaseResult[]): string {
  const outcomes = cases.map((entry) => caseOutcome(entry));
  const parts = [`${cases.length} cases`];
  for (const [outcome, words] of OUTCOME_WORDS) {
    const n = outcomes.filter((value) => value === outcome).length;
    if (n > 0 || outcome === 'PASS' || outcome === 'FAIL') {
      parts.push(colourVerdict(`${n} ${words}`, outcome));
    }
  }
  const unsafe = cases.reduce((sum, entry) => sum + entry.unsafeActions, 0);
  if (unsafe > 0) parts.push(c.red(`${unsafe} unsafe action(s)`));
  return parts.join('   ');
}

/** Colour for a verdict, judged by the outcome it names. */
function colourVerdict(text: string, outcome = text.trim().split(/\s/)[0] ?? ''): string {
  if (outcome === 'PASS') return c.green(text);
  if (outcome === 'FAIL') return c.red(text);
  if (outcome === '—') return text;
  return c.yellow(text);
}

/** One uncoloured line, cut to the width. */
function fit(text: string): string {
  return clip(text, WIDTH);
}

/** Words to lines no wider than `width`. A word longer than that is cut. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const piece = clip(word, width);
    if (current === '') current = piece;
    else if (current.length + 1 + piece.length <= width) current += ` ${piece}`;
    else {
      lines.push(current);
      current = piece;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}
