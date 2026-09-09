/**
 * The record's honesty properties, asserted rather than intended.
 *
 * Each test here corresponds to a way a verification record could quietly
 * become a nicer document than the run deserved.
 */
import { describe, expect, it } from 'vitest';
import {
  ROOTFUL_DAEMON_CAVEAT,
  VERIFICATION_RECORD_SCHEMA,
  VERIFICATION_SOURCES,
  VerificationRecordSchema,
  RECORD_SCHEMA_VERSION,
  canonicalJson,
  hashValue,
  sha512Base64,
  type VerificationRecord,
} from '../src/index.ts';

function record(): VerificationRecord {
  return VerificationRecordSchema.parse({
    schema: VERIFICATION_RECORD_SCHEMA,
    schemaVersion: RECORD_SCHEMA_VERSION,
    recordId: 'rec_000000000001',
    target: {
      ref: 'npm:@modelcontextprotocol/server-memory@2026.8.31',
      scheme: 'npm',
      resolvedVersion: '2026.8.31',
      digest: 'sha512-abc',
      fetchedAt: '2026-09-06T00:00:00.000Z',
    },
    harness: {
      version: '0.2.0',
      runtime: 'docker 28.5.2',
      rootless: false,
      baseImage: 'node:20-alpine@sha256:deadbeef',
      isolation: 'RESET',
      isolationProof: { resets: 2, initialDigests: ['sha256:a', 'sha256:a'] },
      networkEgress: false,
      readonlyVerified: true,
      installScripts: 'skipped',
      limits: { pids: 256, memoryMb: 512, cpus: 1 },
      seed: 'seed-1',
      caveats: [ROOTFUL_DAEMON_CAVEAT],
    },
    server: {},
    untested: [],
    summary: {
      toolsDiscovered: 0,
      toolsExercised: 0,
      conforms: 0,
      contradicted: 0,
      undetermined: 0,
      untested: 0,
    },
    startedAt: '2026-09-06T00:00:00.000Z',
    finishedAt: '2026-09-06T00:00:01.000Z',
  });
}

describe('verification record', () => {
  it('carries both identifiers for the same fact', () => {
    const r = record();
    expect(r.schema).toBe('rigorrun.record/1');
    expect(r.schemaVersion).toBe(1);
  });

  it('requires the untested list, so a gap cannot be hidden by omission', () => {
    const { untested: _dropped, ...withoutUntested } = record();
    expect(VerificationRecordSchema.safeParse(withoutUntested).success).toBe(false);

    // Present and empty is a claim that everything was tested, and is allowed.
    expect(VerificationRecordSchema.safeParse({ ...record(), untested: [] }).success).toBe(true);
  });

  it('refuses a record that states no caveats', () => {
    const stripped = record();
    stripped.harness.caveats = [];
    expect(VerificationRecordSchema.safeParse(stripped).success).toBe(false);
  });

  it('names the root daemon, in the machine-readable part', () => {
    expect(record().harness.caveats.join(' ')).toMatch(/does not claim to prevent a container escape/i);
  });

  it('hashes over itself with the hash blanked, so a reader can recompute it', async () => {
    const r = record();
    const hash = await hashValue({ ...r, recordHash: '' });
    const written = { ...r, recordHash: hash };
    // What a reader does: blank the field again, rehash, compare.
    expect(await hashValue({ ...written, recordHash: '' })).toBe(written.recordHash);
  });

  it('serialises deterministically regardless of key order', () => {
    const a = { target: { ref: 'x', digest: 'y' }, schema: VERIFICATION_RECORD_SCHEMA };
    const b = { schema: VERIFICATION_RECORD_SCHEMA, target: { digest: 'y', ref: 'x' } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('produces the SRI shape npm publishes, so a tarball can be checked', async () => {
    // Known vector: SHA-512 of the empty input.
    const digest = await sha512Base64(new Uint8Array());
    expect(`sha512-${digest}`).toBe(
      'sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==',
    );
  });
});

describe('the DECLARED evidence class', () => {
  it('is the weakest source, and is ordered last', () => {
    expect(VERIFICATION_SOURCES).toContain('DECLARED');
    expect(VERIFICATION_SOURCES[VERIFICATION_SOURCES.length - 1]).toBe('DECLARED');
  });

  /**
   * The property that makes adding the class safe.
   *
   * `DECLARED` is a server's claim about itself. If it could ever gate, a
   * server could pass its own verification by asserting something, which is
   * the exact inversion this product exists to prevent.
   */
  it('is never a blocking source', async () => {
    const { blockingVerificationSources } = await import('../src/assertion.ts');
    expect(blockingVerificationSources()).not.toContain('DECLARED');
  });
});
