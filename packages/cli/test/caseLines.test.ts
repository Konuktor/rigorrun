/**
 * A case under its heading in `rigorrun run` and `rigorrun gate`: the agent's
 * words first, the system's own account right under them, what the reads
 * covered, then what RigorRun saw. Every word is the result's own.
 */
import { describe, expect, it } from 'vitest';
import type { CaseExplanation } from '@rigorrun/report';
import { caseLines, clip } from '../src/caseLines.ts';

const explained = (over: Partial<CaseExplanation> = {}): CaseExplanation => ({
  outcome: 'FAIL',
  claim: 'Added one item of 5 units.\nAnd a second line nobody needs here.',
  saw: ['One item of 5 units was added — none was found'],
  notChecked: ['the order of the calls — black-box'],
  evidence: 'INDEPENDENT · PARTIAL',
  ...over,
});

const LIMITS = { claim: 160, reality: 2, saw: 4, notChecked: 2, readScope: true };

describe('the lines under a case', () => {
  it('puts the system’s account under the claim, then the scope, then the checks', () => {
    const lines = caseLines(
      explained({
        reality: { system: 'The fake system', lines: ['No item on rec_0001.'] },
        readScope: 'Record rec_0001 and the items on it.',
      }),
      LIMITS,
    );
    expect(lines.map((text) => text.trim().split(/\s{2,}/))).toEqual([
      ['agent said', 'Added one item of 5 units.'],
      ['The fake system shows', 'No item on rec_0001.'],
      ['read', 'Record rec_0001 and the items on it.'],
      ['RigorRun saw', 'One item of 5 units was added — none was found'],
      ['not checked', 'the order of the calls — black-box'],
    ]);
    // One column for the labels, however long the system's name.
    const starts = lines.map((text) => text.indexOf(text.trim().split(/\s{2,}/)[1]!));
    expect(new Set(starts).size).toBe(1);
  });

  it('counts the system’s lines it does not show', () => {
    const lines = caseLines(
      explained({ reality: { system: 'S', lines: ['one', 'two', 'three', 'four'] } }),
      LIMITS,
    );
    const text = lines.join('\n');
    expect(text).toContain('two');
    expect(text).not.toContain('three');
    expect(text).toContain('and 2 more');
  });

  it('says nothing for the system when the result carries no account', () => {
    const lines = caseLines(explained(), LIMITS);
    expect(lines.join('\n')).not.toMatch(/shows/);
    expect(lines).toHaveLength(3);
  });

  it('leaves the scope out when asked to', () => {
    const lines = caseLines(explained({ readScope: 'Record rec_0001.' }), {
      ...LIMITS,
      readScope: false,
    });
    expect(lines.join('\n')).not.toContain('Record rec_0001.');
  });

  it('clips a long claim and marks it clipped', () => {
    expect(clip('x'.repeat(10), 5)).toBe('xxxx…');
    expect(clip('short', 5)).toBe('short');
  });
});
