/**
 * Moved to `@rigorrun/exec`.
 *
 * The one place that starts a process now lives in its own package, with no
 * dependencies at all, so that code outside the daemon — the container harness
 * needs this — can spawn without dragging in hono, the runner and the
 * compiler, and without a second file learning how to spawn.
 *
 * This re-export exists so every existing import keeps working. The invariant
 * is unchanged and is still one grep: exactly one file in the repository
 * imports `node:child_process`, and it is `packages/exec/src/exec.ts`.
 */
export * from '@rigorrun/exec';
