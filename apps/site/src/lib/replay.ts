/**
 * The recordings the site is allowed to show, and the only door results come
 * through.
 *
 * Every verdict, model id, date and sentence an agent said that appears on a
 * page is read here, at build time, from a recording file whose run still
 * matches the hash it was recorded with. A page never types one in.
 *
 * Two recordings can exist:
 *
 *  - `fixtures/replays/stripe-replay.json`, the flagship Stripe recording made
 *    under reports/flagship-demo-2026-10/PREREGISTRATION.md. It may not exist
 *    yet, so it is looked for with `import.meta.glob`, which resolves to an
 *    empty object rather than failing the build when the file is absent.
 *  - `fixtures/replays/demo-replay.json`, the Northstar run `rigorrun demo`
 *    bundles. Always present.
 *
 * The Stripe recording is preferred wherever both could be shown. Without it,
 * the blocks that would show it fall back to the Northstar content rather than
 * to anything that only looks like a result.
 */
import { createHash } from 'node:crypto';
import type { CaseResult, RunResult } from '@rigorrun/core';
import demoFile from '../../../../fixtures/replays/demo-replay.json';

export const REPLAY_FORMAT = 'rigorrun/replay/1';

/** Repository paths, for the pages that say where a recording lives. */
export const STRIPE_REPLAY_PATH = 'fixtures/replays/stripe-replay.json';
export const DEMO_REPLAY_PATH = 'fixtures/replays/demo-replay.json';

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
  /** Recordings discarded whole for a harness failure, with their cause. */
  discarded?: unknown[];
  run: RunResult;
}

/** The two variants of the reference agent the flagship recording runs. */
export type Variant = 'careful' | 'minimal';

/**
 * How each variant is described. `minimal`'s sentence is the pre-registration's
 * own, which requires it to be described in these words wherever the demo
 * names it; `careful`'s is the tool list the same table gives it.
 */
export const VARIANT_DESCRIPTIONS: Readonly<Record<Variant, string>> = {
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
  source: 'stripe' | 'demo';
  path: string;
  model: string;
  provider: string;
  /** The system as the site may name it. Says "a local Stripe twin" when the run was simulated. */
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
export function variantOf(agent: { id: string; name: string }): Variant | null {
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

function caseView(entry: CaseResult, run: RunResult, simulated: boolean): CaseView {
  const agent = run.agents.find((candidate) => candidate.id === entry.agentId);
  const agentName = agent?.name ?? entry.agentId;
  const reality = entry.reality;
  return {
    caseId: entry.caseId,
    caseName: entry.caseName,
    category: entry.category,
    agentId: entry.agentId,
    agentName,
    variant: variantOf({ id: entry.agentId, name: agentName }),
    attempt: entry.attempt ?? 0,
    outcome: outcomeOf(entry),
    said: ownWords(entry.agentReport ?? ''),
    outOfSteps: (entry.agentReport ?? '').trim() === STEP_BUDGET_REPORT,
    // The system's name comes from the recording, except that a simulated run
    // is always named as the local twin it was, whatever the line calls it.
    realitySystem: reality ? (simulated ? 'The local Stripe twin' : reality.system) : null,
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
export function pickHeadline(cases: readonly CaseView[]): CaseView | null {
  for (const variant of ['minimal', 'careful'] as const) {
    for (const caseId of HEADLINE_ORDER) {
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

/** A recording, verified, in the terms a page shows it. */
export function siteReplay(file: ReplayFile, source: 'stripe' | 'demo', path: string): SiteReplay {
  verifyReplay(file, path);
  const run = file.run;
  const simulated = isSimulated(run);
  const cases = run.caseResults.map((entry) => caseView(entry, run, simulated));
  const agents: AgentView[] = run.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    variant: variantOf(agent),
    cases: cases.filter((entry) => entry.agentId === agent.id),
  }));
  let system = file.system;
  if (simulated)
    system = source === 'stripe' ? 'a local Stripe twin' : `${file.system} (simulated)`;
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
    // The rule is the Stripe pre-registration's. The Northstar run has no
    // variants, so it never has a headline.
    headline: source === 'stripe' ? pickHeadline(cases) : null,
    discarded: Array.isArray(file.discarded) ? file.discarded : [],
  };
}

const found = import.meta.glob<ReplayFile>('../../../../fixtures/replays/stripe-replay.json', {
  eager: true,
  import: 'default',
});
const stripeFile = Object.values(found)[0];

/** The flagship Stripe recording, or null while it does not exist. */
export const stripeReplay: SiteReplay | null = stripeFile
  ? siteReplay(stripeFile, 'stripe', STRIPE_REPLAY_PATH)
  : null;

/** The Northstar recording `rigorrun demo` bundles. */
export const demoReplay: SiteReplay = siteReplay(
  demoFile as unknown as ReplayFile,
  'demo',
  DEMO_REPLAY_PATH,
);

/** The recording a page should show: the Stripe one when it exists. */
export const replay: SiteReplay = stripeReplay ?? demoReplay;
