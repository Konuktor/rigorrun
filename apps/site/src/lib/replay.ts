/**
 * The recordings the site is allowed to show, and the only door results come
 * through.
 *
 * Every verdict, model id, date and sentence an agent said that appears on a
 * page is read here, at build time, from a recording file whose run still
 * matches the hash it was recorded with. A page never types one in.
 *
 * Three recordings can exist:
 *
 *  - `fixtures/replays/stripe-replay.json`, the flagship Stripe recording made
 *    under reports/flagship-demo-2026-10/PREREGISTRATION.md. It may not exist
 *    yet, so it is looked for with `import.meta.glob`, which resolves to an
 *    empty object rather than failing the build when the file is absent.
 *  - `fixtures/replays/helpdesk-replay.json`, the Larch Helpdesk recording.
 *    Like the Stripe recording, it is optional and loaded with
 *    `import.meta.glob`.
 *  - `fixtures/replays/demo-replay.json`, the Northstar run `rigorrun demo`
 *    bundles. Always present.
 *
 * The Stripe recording is preferred wherever both could be shown. Without it,
 * the blocks that would show it fall back to the Northstar content rather than
 * to anything that only looks like a result.
 *
 * Each flagship slot also has an environment override for preview builds. No
 * deploy sets either one.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Benchmark, CaseResult, RunResult } from '@rigorrun/core';
import demoFile from '../../../../fixtures/replays/demo-replay.json';

export const REPLAY_FORMAT = 'rigorrun/replay/1';

/** Repository paths, for the pages that say where a recording lives. */
export const STRIPE_REPLAY_PATH = 'fixtures/replays/stripe-replay.json';
export const HELPDESK_REPLAY_PATH = 'fixtures/replays/helpdesk-replay.json';
export const DEMO_REPLAY_PATH = 'fixtures/replays/demo-replay.json';

export interface ReplayVariant {
  agentId: string;
  description: string;
  promptSha256: string;
  toolsSha256: string;
  runId: string;
  runResultHash: string;
}

export interface ReplayPresentation {
  headline: { variants: string[]; cases: string[]; source: string };
  task: { label: string; inputs: string[] };
  next: string[];
}

/** What a recording file holds. `temperature` and `discarded` are optional additions. */
export interface ReplayFile {
  format: string;
  recordedAt: string;
  model: string;
  provider: string;
  commit: string;
  system: string;
  /** sha256 of `JSON.stringify(run)`. */
  resultHash: string;
  /** The sampling temperature, when the recording states one (flagship amendment 1). */
  temperature?: number;
  /** True when the recording ran against a twin rather than a live system. */
  simulated?: boolean;
  /** Named agent variants, present on flagship recordings. */
  variants?: Record<string, ReplayVariant>;
  /** Recordings discarded whole for a harness failure, with their cause. */
  discarded?: unknown[];
  /** The suite exactly as it ran, including its case order. */
  benchmark?: Benchmark;
  /** Recording-owned rules for presenting a flagship run. */
  presentation?: ReplayPresentation;
  run: RunResult;
}

/** A flagship recording chooses and names its own variants. */
export type Variant = string;

const LEGACY_VARIANT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  minimal:
    'a first version written the way first versions often are: the same model and policy, a thinner tool layer.',
  careful:
    'the same model and policy, with tools that list a payment’s refunds and look up the customer, and a refund amount described as the smallest currency unit.',
};

/**
 * The fixed order the headline failure is chosen in, from the flagship
 * pre-registration ("How it is shown"). The first FAIL of `minimal` in this
 * order is the headline; failing that, the first FAIL of `careful`; failing
 * that, there is none.
 */
export const HEADLINE_ORDER = [
  'units',
  'prompt_injection',
  'other_customer',
  'already_refunded',
  'disputed',
  'partial',
  'full_refund',
] as const;

/** The Stripe pre-registration's own case order, which the replay lists cases in. */
export const STRIPE_CASE_ORDER = [
  'full_refund',
  'units',
  'partial',
  'already_refunded',
  'disputed',
  'other_customer',
  'prompt_injection',
] as const;

/** Written by the LLM adapter, not the model, when the model uses every step. */
const STEP_BUDGET_REPORT = 'The model ran out of its step budget before reporting a result.';

/** A check that did not hold, as the verifier put it. */
export interface Finding {
  description: string;
  message: string;
  unsafe: boolean;
}

/** One case of a recording, in the terms a page shows it. */
export interface CaseView {
  caseId: string;
  caseName: string;
  category: string;
  agentId: string;
  agentName: string;
  variant: Variant | null;
  attempt: number;
  outcome: string;
  /** The agent's own words, or null when it gave none. */
  said: string | null;
  /** True when it gave none because the model used every step it had. */
  outOfSteps: boolean;
  /** Who the reality lines are from, e.g. "Stripe", or "The local Stripe twin". */
  realitySystem: string | null;
  /** What the system shows afterwards, in its own sentences. Empty when the run has none. */
  reality: string[];
  /** What the reads covered, when that was less than everything. */
  readScope: string | null;
  verification: string;
  independence: string | null;
  /** `state-only` for a black-box agent, whose calls RigorRun cannot see. */
  observation: string | null;
  unsafeActions: number;
  /** Failing checks, unsafe first. */
  findings: Finding[];
}

export interface AgentView {
  id: string;
  name: string;
  variant: Variant | null;
  cases: CaseView[];
}

export interface SiteReplay {
  source: 'stripe' | 'helpdesk' | 'demo';
  path: string;
  model: string;
  provider: string;
  /** The system as the recording names it, without a trailing simulated label. */
  system: string;
  recordedAt: string;
  /** `YYYY-MM-DD`. */
  date: string;
  commit: string;
  temperature: number | null;
  resultHash: string;
  /** True when the run carries the `simulated` limit: it ran on a twin, not the real system. */
  simulated: boolean;
  verification: string;
  isolation: string;
  limits: RunResult['limits'];
  agents: AgentView[];
  cases: CaseView[];
  variantDescriptions: Readonly<Record<string, string>>;
  presentation: ReplayPresentation | null;
  matrix: PermissionMatrix | null;
  /** The pre-registered headline failure, or null when the rule finds none. */
  headline: CaseView | null;
  discarded: unknown[];
}

/** The hash a recording carries, computed exactly as the recorder and the CLI compute it. */
export function hashRun(run: unknown): string {
  return createHash('sha256').update(JSON.stringify(run)).digest('hex');
}

/**
 * Refuses a recording whose run does not match its hash. The build stops
 * rather than publishing an edited recording as a measurement.
 */
export function verifyReplay(file: ReplayFile, path: string): void {
  if (file.format !== REPLAY_FORMAT) {
    throw new Error(`${path} is format ${String(file.format)}, not ${REPLAY_FORMAT}.`);
  }
  if (hashRun(file.run) !== file.resultHash) {
    throw new Error(`${path} does not match its resultHash; re-record it rather than edit it.`);
  }
}

/**
 * A case's outcome, including one recorded before outcomes existed. The same
 * reading as `caseOutcome` in @rigorrun/core, which the site does not depend on.
 */
export function outcomeOf(
  result: Pick<
    CaseResult,
    'outcome' | 'taskSuccess' | 'policyCompliant' | 'unsafeActions' | 'errored'
  >,
): string {
  if (result.outcome) return result.outcome;
  if (result.unsafeActions > 0) return 'FAIL';
  if (result.errored) return 'AGENT_FAILURE';
  return result.taskSuccess && result.policyCompliant ? 'PASS' : 'FAIL';
}

/** Which reference variant an agent is, by its id or name; null when it is neither. */
export function variantOf(
  agent: { id: string; name: string },
  variants?: Readonly<Record<string, ReplayVariant>>,
): Variant | null {
  if (variants !== undefined) {
    return (
      Object.entries(variants).find(([, variant]) => variant.agentId === agent.id)?.[0] ?? null
    );
  }
  for (const variant of ['minimal', 'careful'] as const) {
    const word = new RegExp(`(^|[^a-z])${variant}([^a-z]|$)`);
    if (word.test(agent.id.toLowerCase()) || word.test(agent.name.toLowerCase())) return variant;
  }
  return null;
}

/**
 * Whether the run was on a twin. The `simulated` limit is the product's own
 * statement of it; a reality line attributed to a twin is taken as the same
 * statement, because naming a simulation as the real system is the one error
 * here that cannot be allowed in either direction it might go.
 */
export function isSimulated(run: Pick<RunResult, 'limits' | 'caseResults'>): boolean {
  if (run.limits.some((limit) => limit.id === 'simulated')) return true;
  return run.caseResults.some((entry) => /\btwin\b/i.test(entry.reality?.system ?? ''));
}

function ownWords(report: string): string | null {
  const text = report.trim();
  if (text === '' || text === STEP_BUDGET_REPORT) return null;
  return text;
}

function findingsOf(entry: CaseResult): Finding[] {
  const failed = entry.assertions.filter(
    (check) => check.status === 'FAIL' || check.status === 'ERROR',
  );
  return [
    ...failed.filter((check) => check.unsafe),
    ...failed.filter((check) => !check.unsafe),
  ].map((check) => ({
    description: check.description,
    message: check.message,
    unsafe: check.unsafe,
  }));
}

function caseView(
  entry: CaseResult,
  run: RunResult,
  simulated: boolean,
  system: string,
  variants?: Readonly<Record<string, ReplayVariant>>,
): CaseView {
  const agent = run.agents.find((candidate) => candidate.id === entry.agentId);
  const agentName = agent?.name ?? entry.agentId;
  const reality = entry.reality;
  return {
    caseId: entry.caseId,
    caseName: entry.caseName,
    category: entry.category,
    agentId: entry.agentId,
    agentName,
    variant: variantOf({ id: entry.agentId, name: agentName }, variants),
    attempt: entry.attempt ?? 0,
    outcome: outcomeOf(entry),
    said: ownWords(entry.agentReport ?? ''),
    outOfSteps: (entry.agentReport ?? '').trim() === STEP_BUDGET_REPORT,
    // A twin is always named from the recording rather than from a reality line
    // that might use the live system's shorter name.
    realitySystem: reality
      ? simulated
        ? system.replace(/^./, (first) => first.toUpperCase())
        : reality.system
      : null,
    reality: reality?.lines ?? [],
    readScope: entry.readScope ?? null,
    verification: entry.verification ?? run.verification,
    independence: entry.evidenceIndependence ?? null,
    observation: entry.observation ?? null,
    unsafeActions: entry.unsafeActions,
    findings: findingsOf(entry),
  };
}

/**
 * The headline failure, by the pre-registered rule: the first FAIL of
 * `minimal` in `HEADLINE_ORDER`; if `minimal` failed nothing, the first FAIL of
 * `careful` in the same order; otherwise none. Within a case, the earliest
 * attempt counts.
 */
export function pickHeadline(
  cases: readonly CaseView[],
  rule: ReplayPresentation['headline'] = {
    variants: ['minimal', 'careful'],
    cases: [...HEADLINE_ORDER],
    source: '',
  },
): CaseView | null {
  for (const variant of rule.variants) {
    for (const caseId of rule.cases) {
      const found = cases
        .filter(
          (entry) =>
            entry.variant === variant && entry.caseId === caseId && entry.outcome === 'FAIL',
        )
        .sort((a, b) => a.attempt - b.attempt)[0];
      if (found) return found;
    }
  }
  return null;
}

export const PERMISSION_BOUNDARIES = [
  ['tenant', "Another tenant's data"],
  ['role', 'Outside its role'],
  ['tool', 'A tool it must not use'],
  ['sink', 'Data leaving'],
] as const;

export type PermissionDimension = (typeof PERMISSION_BOUNDARIES)[number][0];

export interface PermissionMatrixCell {
  variant: string;
  agentId: string;
  failed: number;
  held: number;
  notChecked: number;
}

export interface PermissionMatrixRow {
  dimension: PermissionDimension;
  label: string;
  cells: PermissionMatrixCell[];
}

export interface PermissionMatrix {
  variants: { name: string; agentId: string }[];
  rows: PermissionMatrixRow[];
}

function isReplayFile(fileOrRun: ReplayFile | RunResult): fileOrRun is ReplayFile {
  return 'run' in fileOrRun;
}

/** Count every permission check by boundary and recorded variant. */
export function permissionMatrix(fileOrRun: ReplayFile | RunResult): PermissionMatrix | null {
  const file = isReplayFile(fileOrRun) ? fileOrRun : null;
  const run: RunResult = file?.run ?? (fileOrRun as RunResult);
  const variants = file?.variants
    ? Object.entries(file.variants).map(([name, variant]) => ({ name, agentId: variant.agentId }))
    : run.agents.map((agent) => ({ name: agent.name, agentId: agent.id }));
  const dimensions = new Set(
    run.caseResults.flatMap((result) =>
      result.assertions.flatMap((assertion) =>
        assertion.dimension === undefined ? [] : [assertion.dimension],
      ),
    ),
  );
  const rows = PERMISSION_BOUNDARIES.filter(([dimension]) => dimensions.has(dimension)).map(
    ([dimension, label]) => ({
      dimension,
      label,
      cells: variants.map((variant) => {
        const assertions = run.caseResults
          .filter((result) => result.agentId === variant.agentId)
          .flatMap((result) =>
            result.assertions.filter((assertion) => assertion.dimension === dimension),
          );
        return {
          variant: variant.name,
          agentId: variant.agentId,
          failed: assertions.filter(
            (assertion) => assertion.status === 'FAIL' || assertion.status === 'ERROR',
          ).length,
          held: assertions.filter((assertion) => assertion.status === 'PASS').length,
          notChecked: assertions.filter(
            (assertion) =>
              assertion.status === 'UNVERIFIABLE' || assertion.status === 'INAPPLICABLE',
          ).length,
        };
      }),
    }),
  );
  return rows.length > 0 ? { variants, rows } : null;
}

function orderedCases(cases: readonly CaseView[], file: ReplayFile): CaseView[] {
  const order = file.benchmark?.cases.map((entry) => entry.id) ?? [...STRIPE_CASE_ORDER];
  const ranks = new Map(order.map((caseId, index) => [caseId, index]));
  return [...cases].sort(
    (left, right) =>
      (ranks.get(left.caseId) ?? order.length) - (ranks.get(right.caseId) ?? order.length) ||
      left.attempt - right.attempt,
  );
}

/** A recording, verified, in the terms a page shows it. */
export function siteReplay(
  file: ReplayFile,
  source: 'stripe' | 'helpdesk' | 'demo',
  path: string,
): SiteReplay {
  verifyReplay(file, path);
  const run = file.run;
  const simulated = file.simulated === true || isSimulated(run);
  const system = simulated ? file.system.replace(/\s+\(simulated\)$/i, '') : file.system;
  const cases = orderedCases(
    run.caseResults.map((entry) => caseView(entry, run, simulated, system, file.variants)),
    file,
  );
  const agents: AgentView[] = run.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    variant: variantOf(agent, file.variants),
    cases: cases.filter((entry) => entry.agentId === agent.id),
  }));
  const variantDescriptions = file.variants
    ? Object.fromEntries(
        Object.entries(file.variants).map(([name, variant]) => [name, variant.description]),
      )
    : LEGACY_VARIANT_DESCRIPTIONS;
  return {
    source,
    path,
    model: file.model,
    provider: file.provider,
    system,
    recordedAt: file.recordedAt,
    date: file.recordedAt.slice(0, 10),
    commit: file.commit,
    temperature: typeof file.temperature === 'number' ? file.temperature : null,
    resultHash: file.resultHash,
    simulated,
    verification: run.verification,
    isolation: run.isolation,
    limits: run.limits,
    agents,
    cases,
    variantDescriptions,
    presentation: file.presentation ?? null,
    matrix: permissionMatrix(file),
    headline: file.presentation ? pickHeadline(cases, file.presentation.headline) : null,
    discarded: Array.isArray(file.discarded) ? file.discarded : [],
  };
}

/**
 * Names a recording to show in the flagship's place, for one build only.
 *
 * `scripts/record-demo-video.mjs` films the /replay page, and it has to be able
 * to film a recording that is not (or not yet) `fixtures/replays/stripe-replay.json`
 * — a pilot it is being tested with — without that file being copied into the
 * repository. It builds the site into a scratch directory with this variable
 * set. The named file is held to its hash exactly as the flagship is. Unset,
 * which is every real build, nothing here changes.
 */
export const REPLAY_FILE_ENV = 'RIGORRUN_REPLAY_FILE';
export const HELPDESK_REPLAY_FILE_ENV = 'RIGORRUN_HELPDESK_REPLAY_FILE';

function overrideFile(
  environmentName: typeof REPLAY_FILE_ENV | typeof HELPDESK_REPLAY_FILE_ENV,
  repositoryPath: string,
): { file: ReplayFile; path: string } | null {
  const named = process.env[environmentName];
  if (!named) return null;
  // Loud on purpose: a build made this way shows a recording the repository
  // does not hold, and must never be the one that is deployed.
  console.warn(
    `[rigorrun] ${environmentName} is set: showing ${named} in place of ${repositoryPath}. Do not deploy this build.`,
  );
  return { file: JSON.parse(readFileSync(named, 'utf8')) as ReplayFile, path: named };
}

const foundStripe = import.meta.glob<ReplayFile>(
  '../../../../fixtures/replays/stripe-replay.json',
  {
    eager: true,
    import: 'default',
  },
);
const foundHelpdesk = import.meta.glob<ReplayFile>(
  '../../../../fixtures/replays/helpdesk-replay.json',
  { eager: true, import: 'default' },
);
const stripeOverride = overrideFile(REPLAY_FILE_ENV, STRIPE_REPLAY_PATH);
const helpdeskOverride = overrideFile(HELPDESK_REPLAY_FILE_ENV, HELPDESK_REPLAY_PATH);
const stripeFile = stripeOverride?.file ?? Object.values(foundStripe)[0];
const helpdeskFile = helpdeskOverride?.file ?? Object.values(foundHelpdesk)[0];

export type FlagshipReplaySlug = 'stripe' | 'helpdesk';

/** Every flagship recording present in this build, keyed by its URL slug. */
export const flagshipReplays: Readonly<Partial<Record<FlagshipReplaySlug, SiteReplay>>> = {
  ...(stripeFile
    ? {
        stripe: siteReplay(stripeFile, 'stripe', stripeOverride?.path ?? STRIPE_REPLAY_PATH),
      }
    : {}),
  ...(helpdeskFile
    ? {
        helpdesk: siteReplay(
          helpdeskFile,
          'helpdesk',
          helpdeskOverride?.path ?? HELPDESK_REPLAY_PATH,
        ),
      }
    : {}),
};

/** The flagship Stripe recording (or the one `RIGORRUN_REPLAY_FILE` names), or null. */
export const stripeReplay: SiteReplay | null = flagshipReplays.stripe ?? null;

/** The flagship Helpdesk recording, or the preview override for its slot, or null. */
export const helpdeskReplay: SiteReplay | null = flagshipReplays.helpdesk ?? null;

/** The Northstar recording `rigorrun demo` bundles. */
export const demoReplay: SiteReplay = siteReplay(
  demoFile as unknown as ReplayFile,
  'demo',
  DEMO_REPLAY_PATH,
);

/** The recording a page should show: the Stripe one when it exists. */
export const replay: SiteReplay = stripeReplay ?? demoReplay;
