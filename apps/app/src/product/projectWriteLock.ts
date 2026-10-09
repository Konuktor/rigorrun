import { useSyncExternalStore } from 'react';

type Snapshot = { operation: string; completed: number; settledOperation: string };
type Entry = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Snapshot;
  begin: (operation: string) => (() => void) | null;
};

export type ProjectWriteLock = Snapshot & Pick<Entry, 'begin'>;

// A request outlives its view. Keep its lock for this app session, including
// navigation away/back; unmounting or editing a draft never cancels a write.
const projects = new Map<string, Entry>();

function entryFor(projectId: string): Entry {
  const existing = projects.get(projectId);
  if (existing) return existing;
  let snapshot: Snapshot = { operation: '', completed: 0, settledOperation: '' };
  const listeners = new Set<() => void>();
  const publish = (next: Snapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const entry: Entry = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    begin(operation) {
      if (snapshot.operation) return null;
      publish({ ...snapshot, operation });
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        publish({ operation: '', completed: snapshot.completed + 1, settledOperation: operation });
      };
    },
  };
  projects.set(projectId, entry);
  return entry;
}

export function useProjectWriteLock(projectId: string): ProjectWriteLock {
  const entry = entryFor(projectId);
  const snapshot = useSyncExternalStore(entry.subscribe, entry.getSnapshot, entry.getSnapshot);
  return { ...snapshot, begin: entry.begin };
}
