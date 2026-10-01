/**
 * `rigorrun demo`, offline: a real, recorded run, replayed in a few seconds.
 *
 * The first minute with RigorRun should show the one thing it is for — an
 * agent confidently reporting work the system does not show — without asking
 * for a key, a network or a model. So the default demo is a replay of a run
 * that really happened: a real model, against the bundled synthetic system,
 * recorded by `scripts/record-replay.mjs` with its model, date and commit.
 *
 * Nothing here is written by hand. The recording carries a hash of the run it
 * holds, and a replay whose run does not match its hash is refused rather than
 * shown, so an edited fixture cannot pass itself off as a measurement.
 */
import { createHash } from 'node:crypto';
import { caseOutcome, type CaseResult, type RunResult } from '@rigorrun/core';
import { STEP_BUDGET_REPORT } from '@rigorrun/agents';
import { explainCase } from '@rigorrun/report';
// Bundled into the published CLI by esbuild, so the default demo needs no file,
// no network and no model at the other end.
import recorded from '../../../fixtures/replays/demo-replay.json' with { type: 'json' };
import { caseLines, clip } from './caseLines.ts';
import { CliError } from './io.ts';
import { c, heading, line } from './ui.ts';

export const REPLAY_FORMAT = 'rigorrun/replay/1';

export interface Replay {
  format: typeof REPLAY_FORMAT;
  recordedAt: string;
  /** The model and where it ran, as the recording script saw them. */
  model: string;
  provider: string;
  /** The product commit the recording ran at. */
  commit: string;
  /** What the system is; always the bundled synthetic one for the default demo. */
  system: string;
  /** sha256 of JSON.stringify(run). */
  resultHash: string;
  run: RunResult;
}

/** The recording `rigorrun demo` replays. */
export function bundledReplay(): Replay {
  return recorded as unknown as Replay;
}

export function hashRun(run: RunResult): string {
  return createHash('sha256').update(JSON.stringify(run)).digest('hex');
}

export function verifyReplay(replay: Replay): void {
  if (replay.format !== REPLAY_FORMAT)
    throw new CliError(`Unknown replay format ${String(replay.format)}.`);
  if (hashRun(replay.run) !== replay.resultHash) {
    throw new CliError(
      'The bundled replay does not match the hash it was recorded with, so it is not shown.',
    );
  }
}

/**
 * The replay, as a person reads it: which cases, and the agent's words beside
 * what the system showed — the checks' findings, and the system's own account
 * where the recording carries one.
 */
export function printReplay(replay: Replay, options: { show?: number; list?: number } = {}): void {
  verifyReplay(replay);
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
