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
import { caseOutcome, type RunResult } from '@rigorrun/core';
import { explainCase } from '@rigorrun/report';
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

export function hashRun(run: RunResult): string {
  return createHash('sha256').update(JSON.stringify(run)).digest('hex');
}

export function verifyReplay(replay: Replay): void {
  if (replay.format !== REPLAY_FORMAT) throw new CliError(`Unknown replay format ${String(replay.format)}.`);
  if (hashRun(replay.run) !== replay.resultHash) {
    throw new CliError('The bundled replay does not match the hash it was recorded with, so it is not shown.');
  }
}

/** The replay, as a person reads it: which cases, and the agent's words beside what the system showed. */
export function printReplay(replay: Replay, options: { show?: number } = {}): void {
  verifyReplay(replay);
  const run = replay.run;
  const agentId = run.agents[0]?.id;
  const cases = run.caseResults.filter((entry) => entry.agentId === agentId);
  const outcomes = cases.map((entry) => caseOutcome(entry));
  const count = (outcome: string) => outcomes.filter((value) => value === outcome).length;

  heading('RigorRun — a recorded run, replayed');
  line(c.grey(`${replay.model} (${replay.provider}) against ${replay.system}, recorded ${replay.recordedAt.slice(0, 10)} at ${replay.commit.slice(0, 7)}.`));
  line(c.grey('A real run, replayed offline. Live results vary between runs; `rigorrun demo --live` runs one now.'));
  line();
  line(
    `${cases.length} cases   ${c.green(`${count('PASS')} passed`)}   ${c.red(`${count('FAIL')} failed`)}` +
      (count('ABSTAIN') ? `   ${c.yellow(`${count('ABSTAIN')} undecided`)}` : ''),
  );

  // The failures a reader should see first: unsafe ones, then the rest, each
  // with the agent's own words beside what the system showed afterwards.
  const failed = cases
    .filter((entry) => caseOutcome(entry) === 'FAIL')
    .sort((a, b) => b.unsafeActions - a.unsafeActions);
  for (const entry of failed.slice(0, options.show ?? 3)) {
    const explained = explainCase(entry);
    line();
    line(`${c.red('FAIL')}  ${entry.caseName}${explained.evidence ? c.grey(`  (${explained.evidence})`) : ''}`);
    line(`  ${c.grey('agent said  ')}  ${explained.claim.split('\n')[0]!.slice(0, 200)}`);
    for (const [index, seen] of explained.saw.entries()) {
      line(`  ${c.grey(index === 0 ? 'RigorRun saw' : '            ')}  ${seen}`);
    }
  }
  line();
  line(c.grey(`Verification ${run.verification}. The agent's words are shown beside the evidence and never scored.`));
  line();
  line(`${c.bold('Your own agent')}  npx rigorrun   — connect a system, show it the job once, send your agent the work.`);
}
