/**
 * Which nominated reads a verdict rests on (audit IO-7-mixed-a).
 *
 * A verifier read is a witness the agent cannot reach. Once one is nominated,
 * a read through the system's own connection can only add the system's account
 * of itself, so it is set aside rather than merged in.
 */
import { describe, expect, it } from 'vitest';
import { readsForVerdict } from '../src/index.ts';

describe('readsForVerdict', () => {
  it('uses only the verifier reads once one is nominated, in nomination order', () => {
    const reads = [
      { tool: 'list_tasks' },
      { tool: 'verifier:query_tasks', args: { status: 'open' } },
      { tool: 'find_notes' },
      { tool: 'verifier:query_notes' },
    ];
    expect(readsForVerdict(reads)).toEqual({
      used: [{ tool: 'verifier:query_tasks', args: { status: 'open' } }, { tool: 'verifier:query_notes' }],
      ignored: [{ tool: 'list_tasks' }, { tool: 'find_notes' }],
    });
  });

  it('uses every read when none goes through a verifier', () => {
    const reads = [{ tool: 'list_tasks' }, { tool: 'find_notes' }];
    expect(readsForVerdict(reads)).toEqual({ used: reads, ignored: [] });
  });

  it('uses nothing and ignores nothing when nothing is nominated', () => {
    expect(readsForVerdict([])).toEqual({ used: [], ignored: [] });
  });
});
