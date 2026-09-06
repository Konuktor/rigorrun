/**
 * What a state reading is worth, depending on where it came from.
 *
 * Controlling the container does not make everything authoritative, and
 * pretending otherwise would be the most damaging thing this harness could do.
 * Each surface carries the strongest claim a reading from it can support, and
 * a verdict is capped by the surface that produced it.
 *
 * The ranking, and why:
 *
 *   container_fs   Every durable byte. Under --read-only with tmpfs mounts,
 *                  there is nowhere else a process can persist anything, so
 *                  this enumeration is complete over storage. It is blind to
 *                  in-process memory, which does survive between tool calls
 *                  within one container, so it is PARTIAL rather than
 *                  AUTHORITATIVE: a heap is part of the system of record and we
 *                  cannot read it.
 *
 *   process_table  Catches a "read-only" tool that forks a helper.
 *
 *   server_reads   The weakest, and the rule about it is absolute: it may
 *                  corroborate a contradiction and may never establish one.
 *                  The server that might be misdeclaring a tool is the same
 *                  server answering the read. `packages/connector/src/types.ts`
 *                  makes this argument for browsers; it is the same argument.
 *
 *   container_diff Not a state surface at all. A posture control.
 */
import type { StateSurfaceId, VerificationStrengthLabel } from '@rigorrun/core';

export interface SurfaceReading {
  surface: StateSurfaceId;
  /** path -> digest. Empty means the surface saw nothing, not that nothing happened. */
  entries: Map<string, string>;
  /** False when the surface could not be read at all. */
  readable: boolean;
}

export interface SurfaceDelta {
  created: string[];
  modified: string[];
  deleted: string[];
}

export const SURFACE_CEILING: Record<StateSurfaceId, VerificationStrengthLabel> = {
  container_fs: 'PARTIAL',
  process_table: 'PARTIAL',
  server_reads: 'OBSERVATIONAL',
  container_diff: 'OBSERVATIONAL',
};

export const SURFACE_CAVEAT: Record<StateSurfaceId, string> = {
  container_fs:
    'Complete over durable state — with no network, a read-only root and tmpfs mounts there is ' +
    'nowhere else to persist a byte — but blind to state held in the process’s own memory.',
  process_table: 'Shows a process that was running when it was read, not one that came and went.',
  server_reads:
    'Read through the server’s own tools, which is the same server whose declaration is under ' +
    'test. Corroboration, never proof.',
  container_diff:
    'Reports the container layer only. Under a read-only root filesystem it is empty by ' +
    'construction, and is used to check that posture rather than to observe state.',
};

/**
 * Parses `sha256sum` output: a digest, two spaces, then the path.
 *
 * A path may itself contain spaces, so only the first separator is split on
 * and the rest of the line is the name.
 */
export function parseStatedump(output: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of output.split('\n')) {
    const separator = line.indexOf('  ');
    if (separator <= 0) continue;
    const digest = line.slice(0, separator);
    const path = line.slice(separator + 2);
    if (path.length === 0) continue;
    entries.set(path, digest);
  }
  return entries;
}

export function diffReadings(before: SurfaceReading, after: SurfaceReading): SurfaceDelta {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [path, digest] of after.entries) {
    const previous = before.entries.get(path);
    if (previous === undefined) created.push(path);
    else if (previous !== digest) modified.push(path);
  }
  for (const path of before.entries.keys()) {
    if (!after.entries.has(path)) deleted.push(path);
  }

  return { created: created.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

export function isEmpty(delta: SurfaceDelta): boolean {
  return delta.created.length === 0 && delta.modified.length === 0 && delta.deleted.length === 0;
}

/**
 * Whether anything was destroyed, as opposed to added.
 *
 * A deletion or an overwrite is what `destructiveHint` is about. Creating a
 * new file is a write, but it is not destruction, and conflating them would
 * make every writing tool look destructive.
 */
export function destroyedAnything(delta: SurfaceDelta): boolean {
  return delta.deleted.length > 0 || delta.modified.length > 0;
}

/** Everything a case touched, for the record. */
export function touchedPaths(delta: SurfaceDelta): string[] {
  return [...delta.created, ...delta.modified, ...delta.deleted].sort();
}
