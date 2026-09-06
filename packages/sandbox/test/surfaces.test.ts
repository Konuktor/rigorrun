import { describe, expect, it } from 'vitest';
import {
  SURFACE_CEILING,
  destroyedAnything,
  diffReadings,
  isEmpty,
  parseStatedump,
  touchedPaths,
} from '../src/index.ts';

const dump = (lines: string[]) => ({
  surface: 'container_fs' as const,
  entries: parseStatedump(lines.join('\n')),
  readable: true,
});

describe('state surfaces', () => {
  it('parses a digest and a path, including paths with spaces', () => {
    const entries = parseStatedump('abc123  /work/a file.txt\ndef456  /tmp/b');
    expect(entries.get('/work/a file.txt')).toBe('abc123');
    expect(entries.get('/tmp/b')).toBe('def456');
  });

  it('sees a created file', () => {
    const delta = diffReadings(dump(['a  /work/x']), dump(['a  /work/x', 'b  /work/new']));
    expect(delta.created).toEqual(['/work/new']);
    expect(isEmpty(delta)).toBe(false);
  });

  it('sees a modified file, and calls it destruction', () => {
    const delta = diffReadings(dump(['a  /work/x']), dump(['CHANGED  /work/x']));
    expect(delta.modified).toEqual(['/work/x']);
    expect(destroyedAnything(delta)).toBe(true);
  });

  it('sees a deleted file', () => {
    const delta = diffReadings(dump(['a  /work/x']), dump([]));
    expect(delta.deleted).toEqual(['/work/x']);
    expect(destroyedAnything(delta)).toBe(true);
  });

  /**
   * Adding a file is a write, but it is not destruction. Conflating the two
   * would make every writing tool look like it contradicts destructiveHint.
   */
  it('does not call creating a file destruction', () => {
    const delta = diffReadings(dump([]), dump(['a  /work/new']));
    expect(destroyedAnything(delta)).toBe(false);
  });

  it('reports nothing when nothing changed', () => {
    const delta = diffReadings(dump(['a  /work/x']), dump(['a  /work/x']));
    expect(isEmpty(delta)).toBe(true);
    expect(touchedPaths(delta)).toEqual([]);
  });

  /**
   * The ranking is the honesty. The filesystem is complete over durable state
   * and blind to memory, so it is PARTIAL and never AUTHORITATIVE; the
   * server's own tools are the weakest thing here.
   */
  it('never lets a surface claim more than it can support', () => {
    expect(SURFACE_CEILING.container_fs).toBe('PARTIAL');
    expect(SURFACE_CEILING.server_reads).toBe('OBSERVATIONAL');
    expect(Object.values(SURFACE_CEILING)).not.toContain('AUTHORITATIVE');
  });
});
