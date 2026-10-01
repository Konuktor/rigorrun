/**
 * One case under its heading, as the terminal shows it: what the agent said,
 * what the system itself shows beneath that, what the reads covered, then what
 * RigorRun saw and what it could not check.
 *
 * Every word is the result's own (see `explainCase`): the system's lines come
 * from the result under the system's own name, so nothing here knows which
 * system a run was against.
 */
import type { CaseExplanation } from '@rigorrun/report';
import { c } from './ui.ts';

export interface CaseLineLimits {
  /** Longest claim shown, in characters. Only its first line is shown. */
  claim: number;
  /** Most of the system's lines shown; the rest are counted. */
  reality: number;
  /** Most failed checks shown; the rest are counted. */
  saw: number;
  /** Most checks-not-made shown. Zero leaves them to the report. */
  notChecked: number;
  /** Whether to say what the reads covered. */
  readScope: boolean;
}

const LABEL_SAID = 'agent said';
const LABEL_SAW = 'RigorRun saw';
const LABEL_NOT_CHECKED = 'not checked';
const LABEL_READ = 'read';

export function caseLines(explained: CaseExplanation, limits: CaseLineLimits): string[] {
  const rows: [label: string, text: string][] = [];
  rows.push([LABEL_SAID, clip(explained.claim.split('\n')[0]!, limits.claim)]);

  const reality = explained.reality;
  if (reality && reality.lines.length > 0) {
    // Directly under the claim, so the two can be read against each other.
    rows.push(...labelled(`${reality.system} shows`, reality.lines, limits.reality));
  }
  if (limits.readScope && explained.readScope) rows.push([LABEL_READ, explained.readScope]);
  rows.push(...labelled(LABEL_SAW, explained.saw, limits.saw));
  for (const skipped of explained.notChecked.slice(0, limits.notChecked)) {
    rows.push([LABEL_NOT_CHECKED, skipped]);
  }

  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, text]) => `  ${c.grey(label.padEnd(width))}  ${text}`);
}

/** The first `max` lines under one label, and a count of the rest. */
function labelled(label: string, lines: readonly string[], max: number): [string, string][] {
  const shown = lines
    .slice(0, max)
    .map((text, index): [string, string] => [index === 0 ? label : '', text]);
  if (lines.length > max) shown.push(['', c.grey(`and ${lines.length - max} more`)]);
  return shown;
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
