/**
 * The truth table, and the one rule that keeps it honest.
 */
import { describe, expect, it } from 'vitest';
import { judge, type ObservedBehavior } from '../src/index.ts';
import type { StateSurfaceId } from '@rigorrun/core';

function observed(over: Partial<ObservedBehavior> = {}): ObservedBehavior {
  return {
    mutatesState: 'no',
    destroyed: 'no',
    idempotent: 'not-probed',
    surfaces: ['container_fs'] as StateSurfaceId[],
    evidenceRef: 'case:1',
    ...over,
  };
}

const only = (verdicts: ReturnType<typeof judge>, claim: string) =>
  verdicts.find((v) => v.claim === claim);

describe('declaration versus behaviour', () => {
  it('convicts a tool that declares itself read-only and writes', () => {
    const v = only(judge({ readOnly: true }, observed({ mutatesState: 'yes' })), 'readOnlyHint: true');
    expect(v?.verdict).toBe('CONTRADICTED');
    expect(v?.severity).toBe('CRITICAL');
    expect(v?.permissionRelevant).toBe(true);
    expect(v?.evidenceRef).toBe('case:1');
  });

  it('clears a truthful read-only tool', () => {
    const v = only(judge({ readOnly: true }, observed({ mutatesState: 'no' })), 'readOnlyHint: true');
    expect(v?.verdict).toBe('CONFORMS');
  });

  /**
   * The rule that stops the product convicting on the word of the accused.
   *
   * If the only witness to a state change is the server's own read tool, then
   * the server that would have to be lying is also the only thing saying
   * anything happened. That is corroboration. It is not proof, and treating it
   * as proof would make the strongest-sounding finding the least reliable one.
   */
  it('will not convict when the only witness is the server itself', () => {
    const v = only(
      judge({ readOnly: true }, observed({ mutatesState: 'yes', surfaces: ['server_reads'] })),
      'readOnlyHint: true',
    );
    expect(v?.verdict).toBe('UNDETERMINED');
    expect(v?.permissionRelevant).toBe(false);
    expect(v?.surface).toBe('server_reads');
  });

  it('says undetermined, not conforms, when nothing could be read', () => {
    const v = only(
      judge({ readOnly: true }, observed({ mutatesState: 'undetermined', surfaces: [] })),
      'readOnlyHint: true',
    );
    expect(v?.verdict).toBe('UNDETERMINED');
  });

  /**
   * The direction our strongest surface cannot settle.
   *
   * The filesystem enumeration is complete over durable state and blind to
   * state a process holds in memory. A tool that declares it writes and flips
   * an in-process flag has done exactly what it said; calling that a
   * contradiction asserts knowledge we do not have. Found against a real
   * server whose toggle tools do precisely this.
   */
  it('will not call a declared write a contradiction just because nothing durable changed', () => {
    const v = only(judge({ readOnly: false }, observed({ mutatesState: 'no' })), 'readOnlyHint: false');
    expect(v?.verdict).toBe('UNDETERMINED');
    expect(v?.permissionRelevant).toBe(false);
    expect(v?.because).toMatch(/memory/);
  });

  it('still clears a declared write that visibly writes', () => {
    const v = only(judge({ readOnly: false }, observed({ mutatesState: 'yes' })), 'readOnlyHint: false');
    expect(v?.verdict).toBe('CONFORMS');
  });

  it('convicts a tool that declares it destroys nothing and deletes', () => {
    const v = only(
      judge({ destructive: false }, observed({ mutatesState: 'yes', destroyed: 'yes' })),
      'destructiveHint: false',
    );
    expect(v?.verdict).toBe('CONTRADICTED');
    expect(v?.severity).toBe('CRITICAL');
    expect(v?.permissionRelevant).toBe(true);
  });

  it('convicts a tool that declares idempotence and mutates twice', () => {
    const v = only(
      judge({ idempotent: true }, observed({ mutatesState: 'yes', idempotent: 'no' })),
      'idempotentHint: true',
    );
    expect(v?.verdict).toBe('CONTRADICTED');
    expect(v?.severity).toBe('MAJOR');
    // Wrong, and worth knowing, but it does not widen what an agent may do.
    expect(v?.permissionRelevant).toBe(false);
  });

  it('does not claim idempotence was checked when the tool was called once', () => {
    const v = only(
      judge({ idempotent: true }, observed({ idempotent: 'not-probed' })),
      'idempotentHint: true',
    );
    expect(v?.verdict).toBe('UNDETERMINED');
  });

  it('says nothing at all about an annotation the server never set', () => {
    expect(judge({}, observed({ mutatesState: 'yes' }))).toEqual([]);
  });

  it('names the strongest surface behind each verdict', () => {
    const v = only(
      judge(
        { readOnly: true },
        observed({ mutatesState: 'yes', surfaces: ['server_reads', 'container_fs'] }),
      ),
      'readOnlyHint: true',
    );
    expect(v?.surface).toBe('container_fs');
  });
});
