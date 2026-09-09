/**
 * The fixture that lies, and the two records that catch it.
 *
 * These need a container runtime and are skipped without one, so a machine
 * that cannot run a container still gets a green suite for everything else.
 * CI asserts that at least one of them actually ran.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { inspectRuntime, verifyServer } from '../src/index.ts';
import type { VerificationRecord } from '@rigorrun/core';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

// Probed at module load, not in beforeAll: vitest decides which suites exist
// while collecting, which happens before any hook runs, so a flag set in
// beforeAll is still false when `describe.skip` is chosen and the suite skips
// on a machine that has a runtime.
const { available } = await inspectRuntime();
const withDocker = () => (available ? describe : describe.skip);

function conformanceOf(record: VerificationRecord, tool: string, claim: string) {
  return record.tools.find((t) => t.name === tool)?.conformance.find((c) => c.claim === claim);
}

withDocker()('a server whose annotations do not match its behaviour', () => {
  let a: VerificationRecord;
  let b: VerificationRecord;

  beforeAll(async () => {
    a = await verifyServer(`dir:${repoRoot}fixtures/external/mcp-attested-lookup`);
    b = await verifyServer(`dir:${repoRoot}fixtures/external/mcp-attested-lookup-next`);
  }, 900_000);

  it('catches a tool that declares itself read-only and writes', () => {
    const verdict = conformanceOf(a, 'lookup_user', 'readOnlyHint: true');
    expect(verdict?.verdict).toBe('CONTRADICTED');
    expect(verdict?.severity).toBe('CRITICAL');
    // This annotation decides whether an agent may call the tool without
    // asking, so contradicting it is a permission problem, not a docs problem.
    expect(verdict?.permissionRelevant).toBe(true);
    expect(verdict?.surface).toBe('container_fs');
  });

  it('names the file that proves it', () => {
    const tool = a.tools.find((t) => t.name === 'lookup_user');
    expect(tool?.observed.wrote.some((p) => p.endsWith('audit.log'))).toBe(true);
    expect(tool?.observed.mutatesState).toBe('yes');
  });

  it('catches the idempotence claim too, because it called the tool twice', () => {
    expect(conformanceOf(a, 'lookup_user', 'idempotentHint: true')?.verdict).toBe('CONTRADICTED');
  });

  /**
   * A harness that flagged everything would also "catch" this fixture, and
   * would be worthless. The truthful tool has to come back clean.
   */
  it('clears the tool that is telling the truth', () => {
    for (const claim of ['readOnlyHint: true', 'destructiveHint: false', 'idempotentHint: true']) {
      expect(conformanceOf(a, 'list_users', claim)?.verdict).toBe('CONFORMS');
    }
  });

  /**
   * The argument for the whole container harness, stated as a test.
   *
   * `audit.log` is invisible to `list_users`. A verifier that read state only
   * through the server's own tools would see nothing at all and report the
   * server as conforming.
   */
  it('sees a write that the server’s own tools cannot show', () => {
    const tool = a.tools.find((t) => t.name === 'lookup_user');
    expect(tool?.observed.surfacesTouched).toContain('container_fs');
    expect(tool?.observed.surfacesTouched).not.toContain('server_reads');
  });

  it('reports the same contradiction in the next version', () => {
    expect(conformanceOf(b, 'lookup_user', 'readOnlyHint: true')?.verdict).toBe('CONTRADICTED');
  });

  /**
   * The product claim, reduced to an assertion: same tool name, same schema,
   * same annotations, same description — and one new side effect that a schema
   * diff, a description diff and a version bump all miss.
   */
  it('shows exactly one new side effect between the two versions', () => {
    const wroteIn = (record: VerificationRecord) =>
      new Set(
        (record.tools.find((t) => t.name === 'lookup_user')?.observed.wrote ?? []).map((p) =>
          p.replace(/^.*\//, ''),
        ),
      );
    const before = wroteIn(a);
    const after = wroteIn(b);
    const added = [...after].filter((p) => !before.has(p));

    expect(added).toEqual(['last-seen.json']);
    // And nothing about the declaration changed, which is the point.
    expect(a.tools.find((t) => t.name === 'lookup_user')?.declared).toEqual(
      b.tools.find((t) => t.name === 'lookup_user')?.declared,
    );
  });

  it('proves reset actually resets, rather than declaring it', () => {
    expect(a.harness.isolation).toBe('RESET');
    expect(a.harness.isolationProof.resets).toBeGreaterThanOrEqual(2);
    expect(new Set(a.harness.isolationProof.initialDigests).size).toBe(1);
  });

  it('confirms the read-only posture held', () => {
    expect(a.harness.readonlyVerified).toBe(true);
    expect(a.harness.networkEgress).toBe(false);
  });

  it('writes a record that can be re-hashed from what is on disk', async () => {
    const { hashValue } = await import('@rigorrun/core');
    expect(await hashValue({ ...a, recordHash: '' })).toBe(a.recordHash);
  });
});
