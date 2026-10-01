/**
 * What every `rigorrun stripe …` command shares: printing, refusing, and a
 * service over this machine's project store.
 *
 * These commands are reached through the pack's own `cli` (see
 * `PackDefinition.cli`), so they parse their own flags and own their own exit
 * codes, which keep RigorRun's contract: 0 done or passed, 1 the agent failed,
 * 2 something about the setup is wrong, 3 too little was established to say.
 */
import { ProjectStore, Service, storeRoot } from '@rigorrun/daemon';
import { ProxyServer } from '@rigorrun/proxy';
import { registerStripePack } from '../pack.ts';

/** A refusal with nothing to add: the message is the whole answer. Exit 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function say(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function warn(text: string): void {
  process.stderr.write(`${text}\n`);
}

/** Label and value, aligned, for the few lines a command prints about itself. */
export function rows(entries: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...entries.map(([label]) => label.length));
  return entries.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`);
}

/**
 * The project service, with the pack registered and the proxy it needs
 * started, closed again whatever happens.
 */
export async function withService<T>(
  home: string | undefined,
  work: (service: Service, store: ProjectStore) => Promise<T>,
): Promise<T> {
  registerStripePack();
  const store = new ProjectStore(storeRoot(home));
  const proxy = new ProxyServer();
  await proxy.start();
  const service = new Service({ store, proxy });
  try {
    return await work(service, store);
  } finally {
    await service.workspace.close();
    await proxy.stop();
  }
}

/** The message of whatever was thrown, for a refusal. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
