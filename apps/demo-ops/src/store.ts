/**
 * One live environment adapter per workflow, in the browser.
 *
 * The app talks to the same `EnvironmentAdapter` the benchmark runs against —
 * not a copy of its data, the adapter itself. That is what makes a workflow
 * recorded by clicking around in here a workflow an agent can be tested on,
 * and what makes verification through the adapter meaningful when this app is
 * driven by a browser agent.
 */
import { useSyncExternalStore } from 'react';
import type { CanonicalState, EnvironmentAdapter } from '@rigorrun/environment';
import { WORKFLOWS, type WorkflowDefinition } from '@rigorrun/environments';

interface Live {
  definition: WorkflowDefinition;
  adapter: EnvironmentAdapter;
  state: CanonicalState;
  version: number;
}

const live = new Map<string, Live>();
const listeners = new Set<() => void>();
let revision = 0;

/** The demo workflows this build can present. */
export const ENVIRONMENTS = WORKFLOWS.map((definition) => ({
  id: definition.registration.id,
  key: definition.key,
  definition,
}));

export function definitionFor(environmentId: string): WorkflowDefinition | undefined {
  return WORKFLOWS.find((workflow) => workflow.registration.id === environmentId);
}

function storageKey(environmentId: string): string {
  return `rigorrun.demo-ops.${environmentId}.v1`;
}

function readStored(environmentId: string): CanonicalState | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(environmentId));
    return raw ? (JSON.parse(raw) as CanonicalState) : null;
  } catch {
    // A private window or blocked storage is a normal condition, not an error.
    return null;
  }
}

function persist(environmentId: string, state: CanonicalState): void {
  try {
    globalThis.localStorage?.setItem(storageKey(environmentId), JSON.stringify(state));
  } catch {
    /* the app still works; it just will not survive a reload */
  }
}

function ensure(environmentId: string): Live | undefined {
  const existing = live.get(environmentId);
  if (existing) return existing;

  const definition = definitionFor(environmentId);
  if (!definition) return undefined;

  const adapter = definition.registration.create();
  const fixture = definition.registration.fixtures.find(
    (candidate) => candidate.id === definition.fixtureId,
  );
  if (!fixture) return undefined;

  adapter.seed(readStored(environmentId) ?? fixture.state, fixture.config);
  const entry: Live = {
    definition,
    adapter,
    state: adapter.getState() as CanonicalState,
    version: (revision += 1),
  };
  live.set(environmentId, entry);
  return entry;
}

function publish(environmentId: string): void {
  const entry = live.get(environmentId);
  if (!entry) return;
  entry.state = entry.adapter.getState() as CanonicalState;
  entry.version = (revision += 1);
  persist(environmentId, entry.state);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useEnvironment(environmentId: string | null): Live | undefined {
  const snapshot = () => (environmentId ? ensure(environmentId) : undefined);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export interface PerformResult {
  ok: boolean;
  message: string;
  createdId?: string;
}

/** Runs an action through the adapter and republishes the world. */
export async function perform(
  environmentId: string,
  action: string,
  args: Record<string, unknown>,
): Promise<PerformResult> {
  const entry = ensure(environmentId);
  if (!entry) return { ok: false, message: 'That environment is not available.' };

  const before = entry.adapter.getState() as CanonicalState;
  const result = await entry.adapter.executeAction(action, args);
  publish(environmentId);

  if (!result.ok) {
    return { ok: false, message: result.error?.message ?? 'The system refused that.' };
  }

  // Tell the caller what appeared, so it can navigate to it.
  const after = entry.adapter.getState() as CanonicalState;
  let createdId: string | undefined;
  for (const [entity, rows] of Object.entries(after.entities)) {
    const had = new Set(Object.keys(before.entities[entity] ?? {}));
    const fresh = Object.keys(rows).filter((id) => !had.has(id));
    if (fresh[0]) createdId = fresh[0];
  }

  observe(action, args);
  return { ok: true, message: 'Done.', ...(createdId ? { createdId } : {}) };
}

export function reset(environmentId: string): void {
  const definition = definitionFor(environmentId);
  const fixture = definition?.registration.fixtures.find(
    (candidate) => candidate.id === definition.fixtureId,
  );
  if (!definition || !fixture) return;
  try {
    globalThis.localStorage?.removeItem(storageKey(environmentId));
  } catch {
    /* ignore */
  }
  live.delete(environmentId);
  ensure(environmentId);
  publish(environmentId);
}

/**
 * Semantic observation, for any recorder that is listening.
 *
 * The optional instrumentation hook: an application that emits these gives
 * RigorRun a far better recording than interface events alone. Nothing breaks
 * without a recorder attached, and nothing sensitive is emitted.
 */
function observe(name: string, data: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('rigorrun:observation', { detail: { name, data } }));
  try {
    window.postMessage({ source: 'rigorrun-app', name, data }, window.location.origin);
  } catch {
    /* ignore */
  }
}
