/**
 * `rigorrun` with no arguments: start the runner and hand somebody a URL.
 *
 * The default command on purpose. Everything a person wants to do first —
 * make a project, connect a system, watch what their agent does — happens in
 * the interface, and the interface only exists while this is running. A CLI
 * whose bare form prints a help page is a CLI that assumes you already know
 * what you came for.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Runner, Service, storeRoot } from '@rigorrun/daemon';
import { c, heading, line } from './ui.ts';

/** Where the built interface lives, when it has been built. */
function findUi(): string | undefined {
  const here = fileURLToPath(new URL('.', import.meta.url));
  for (const candidate of [
    join(here, '..', '..', '..', 'apps', 'web', 'dist'),
    join(here, '..', 'ui'),
  ]) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return undefined;
}

export interface ServeOptions {
  port?: number;
  home?: string;
  /** Print the URL and exit, for tests and for scripts. */
  once?: boolean;
}

export async function cmdServe(options: ServeOptions = {}): Promise<number> {
  const home = storeRoot(options.home);
  const store = new ProjectStore(home);
  const proxy = new ProxyServer();
  await proxy.start();

  const service = new Service({ store, proxy });
  const uiDir = findUi();
  const runner = new Runner({
    service,
    ...(uiDir ? { uiDir } : {}),
    ...(options.port === undefined ? {} : { port: options.port }),
  });
  await runner.start();

  heading('RigorRun');
  line(`  ${c.bold('Open')}  ${runner.pairedUrl}`);
  line();
  line(c.grey(`  Projects and credentials live in ${home}, and stay there.`));
  if (!uiDir) {
    line(c.grey('  The interface is not built. Run `pnpm build:web`; the API works regardless.'));
  }
  line(c.grey('  Press Ctrl+C to stop.'));
  line();

  if (options.once) {
    await runner.stop();
    await proxy.stop();
    await service.workspace.close();
    return 0;
  }

  // The runner holds child processes and open sockets to somebody's systems.
  // Ending it tidily is not politeness: an orphaned stdio server keeps running
  // with the credentials it was given.
  const shutdown = async (): Promise<void> => {
    line();
    line(c.grey('Stopping.'));
    await runner.stop();
    await proxy.stop();
    await service.workspace.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await new Promise<never>(() => undefined);
  return 0;
}
