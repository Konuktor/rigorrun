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
import {
  ActivationLog,
  ProjectStore,
  Runner,
  Service,
  WorkspaceTooNewError,
  openWorkspace,
  runCommand,
  storeRoot,
} from '@rigorrun/daemon';
import { c, errorLine, heading, line } from './ui.ts';
import { VERSION } from './help.ts';

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
  /** Open a browser. Default true; `--no-open` for a headless box or CI. */
  open?: boolean;
}

/**
 * Opens the pairing URL, and never makes a fuss about not being able to.
 *
 * There is no dependency for this: three platforms, one command each, and the
 * printed URL is the fallback for every case they do not cover — a headless
 * box, an SSH session, a container, a desktop with no handler registered. A
 * failure here is not an error, because the person already has what they need
 * on screen.
 */
async function openInBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? { command: 'cmd.exe', args: ['/c', 'start', '', url] }
        : { command: 'xdg-open', args: [url] };
  await runCommand({
    ...command,
    timeoutMs: 5_000,
    provenance: 'rigorrun-internal',
  }).catch(() => undefined);
}

export async function cmdServe(options: ServeOptions = {}): Promise<number> {
  const home = storeRoot(options.home);

  // Before anything reads a project. A workspace written by a newer RigorRun is
  // refused rather than guessed at: the failure mode of guessing is somebody's
  // twenty minutes of setup being silently rewritten by an older reader.
  let opened;
  try {
    opened = await openWorkspace(home, VERSION);
  } catch (error) {
    if (error instanceof WorkspaceTooNewError) {
      errorLine(error.message);
      return 2;
    }
    throw error;
  }

  const store = new ProjectStore(home);
  const activation = new ActivationLog(home);
  const proxy = new ProxyServer();
  await proxy.start();

  const service = new Service({ store, proxy, activation });

  // A0 is not observable: nothing runs at install time, and a package that
  // wanted to would need a postinstall script, which is a thing to be
  // suspicious of rather than to ship. The first runner start on a machine is
  // the closest honest proxy, and it is recorded as such.
  if (await activation.isNew()) await activation.stage('installation_started');
  await activation.stage('runner_started');
  const uiDir = findUi();
  const runner = new Runner({
    service,
    version: VERSION,
    ...(uiDir ? { uiDir } : {}),
    ...(options.port === undefined ? {} : { port: options.port }),
  });
  await runner.start();

  heading('RigorRun');
  line(`  ${c.bold('Open')}  ${runner.pairedUrl}`);
  line();
  line(c.grey(`  Projects and credentials live in ${home}, and stay there.`));
  for (const applied of opened.applied) {
    line(c.grey(`  Upgraded your workspace: ${applied}`));
  }
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

  if (options.open !== false) await openInBrowser(runner.pairedUrl);

  // Losing the tab used to cost a restart. The pairing code is single-use on
  // purpose — the copy in a shell history has to be worthless — so a person who
  // closes the window, or opens it in a browser that discards cookies, has no
  // way back in.
  //
  // The authority to issue a new one is *being at this terminal*, which is
  // exactly the authority that read the first code off the screen. So a
  // keypress does it. Not an HTTP endpoint: an unauthenticated one would let
  // any process on the machine pair itself, and an authenticated one would need
  // the credential the person has just lost.
  const interactive = process.stdin.isTTY === true;
  if (interactive) {
    line(c.grey('  Lost the tab? Press Enter here for a new link.'));
    line();
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', (chunk: string) => {
      if (!chunk.includes('\n') && !chunk.includes('\r')) return;
      runner.pairing.reissue();
      line(`  ${c.bold('Open')}  ${runner.pairedUrl}`);
      line();
    });
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
