/**
 * The number CI reads. It cannot ask a follow-up question, so the separation
 * between "your server is wrong" and "our harness broke" has to be exact.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, exitCodeFor } from '../src/index.ts';
import {
  RECORD_SCHEMA_VERSION,
  ROOTFUL_DAEMON_CAVEAT,
  VERIFICATION_RECORD_SCHEMA,
  VerificationRecordSchema,
  type Conformance,
  type VerificationRecord,
} from '@rigorrun/core';

function recordWith(
  conformance: Conformance[],
  summary: Partial<VerificationRecord['summary']> = {},
): VerificationRecord {
  return VerificationRecordSchema.parse({
    schema: VERIFICATION_RECORD_SCHEMA,
    schemaVersion: RECORD_SCHEMA_VERSION,
    recordId: 'rec_1',
    target: {
      ref: 'npm:x@1.0.0',
      scheme: 'npm',
      resolvedVersion: '1.0.0',
      digest: 'sha512-x',
      fetchedAt: '2026-09-06T00:00:00.000Z',
    },
    harness: {
      version: '0.2.0',
      runtime: 'docker 28.5.2',
      rootless: false,
      baseImage: 'node:20-alpine@sha256:x',
      isolation: 'RESET',
      isolationProof: { resets: 2, initialDigests: [] },
      networkEgress: false,
      readonlyVerified: true,
      installScripts: 'skipped',
      limits: { pids: 256, memoryMb: 512, cpus: 1 },
      seed: 's',
      caveats: [ROOTFUL_DAEMON_CAVEAT],
    },
    server: {},
    tools: [
      {
        name: 't',
        declared: {},
        observed: { mutatesState: 'yes', idempotent: 'not-probed' },
        conformance,
        verification: 'AUTHORITATIVE',
      },
    ],
    untested: [],
    summary: {
      toolsDiscovered: 1,
      toolsExercised: 1,
      conforms: 0,
      contradicted: 0,
      undetermined: 0,
      untested: 0,
      ...summary,
    },
    startedAt: '2026-09-06T00:00:00.000Z',
    finishedAt: '2026-09-06T00:00:01.000Z',
  });
}

const contradiction = (severity: Conformance['severity']): Conformance => ({
  claim: 'readOnlyHint: true',
  verdict: 'CONTRADICTED',
  severity,
  permissionRelevant: severity === 'CRITICAL',
  because: 'x',
  evidenceRef: 'case:1',
});

describe('exit codes', () => {
  it('exits 0 when a tool was exercised and nothing was contradicted', () => {
    expect(exitCodeFor(recordWith([]))).toBe(0);
  });

  it('exits 1 on a critical contradiction', () => {
    expect(exitCodeFor(recordWith([contradiction('CRITICAL')]))).toBe(1);
  });

  it('exits 1 on a major contradiction', () => {
    expect(exitCodeFor(recordWith([contradiction('MAJOR')]))).toBe(1);
  });

  it('does not fail a build over a minor contradiction unless asked', () => {
    const record = recordWith([contradiction('MINOR')]);
    expect(exitCodeFor(record)).toBe(0);
    expect(exitCodeFor(record, { ...DEFAULT_THRESHOLDS, strict: true })).toBe(1);
  });

  it('exits 3 when too much came back undetermined', () => {
    expect(exitCodeFor(recordWith([], { undetermined: 1 }))).toBe(3);
    expect(
      exitCodeFor(recordWith([], { undetermined: 1 }), {
        ...DEFAULT_THRESHOLDS,
        maxUndetermined: 1,
      }),
    ).toBe(0);
  });

  it('exits 3 when nothing was exercised, because a clean run of nothing is not a pass', () => {
    expect(exitCodeFor(recordWith([], { toolsExercised: 0 }))).toBe(3);
  });

  /**
   * A tool we declined to touch is a decision, not an inconclusive result.
   * Counting the two together would make every honest run look uncertain.
   */
  it('does not treat a deliberately untested tool as undetermined', () => {
    expect(exitCodeFor(recordWith([], { untested: 5 }))).toBe(0);
  });

  it('puts a contradiction ahead of undetermined', () => {
    expect(exitCodeFor(recordWith([contradiction('CRITICAL')], { undetermined: 9 }))).toBe(1);
  });
});
