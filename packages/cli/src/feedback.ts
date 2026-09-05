/**
 * `rigorrun feedback export` — what to send when it went wrong.
 *
 * Prints the bundle to stdout, or writes it to a file. Before either, it scans
 * the finished thing for anything that looks like a credential, a path or a
 * URL, and refuses rather than writing something it is unsure about. That check
 * should never fire; it exists because the cost of being wrong is somebody
 * else's secret in our inbox, and because a check that never fires costs
 * nothing.
 */
import { writeFile } from 'node:fs/promises';
import { ProjectStore, buildFeedbackBundle, scanForLeaks, storeRoot } from '@rigorrun/daemon';
import { CliError } from './io.ts';
import { c, heading, line } from './ui.ts';
import { VERSION } from './help.ts';
import type { Flags } from './commands.ts';

export async function cmdFeedbackExport(flags: Flags): Promise<number> {
  const store = new ProjectStore(storeRoot(flags.home));
  const bundle = await buildFeedbackBundle({ store, version: VERSION });

  // Every credential this machine holds, as known-forbidden values. The bundle
  // is built by naming fields rather than by copying and deleting, so none of
  // them can be in it — this proves that rather than assuming it.
  const secrets = Object.values(await store.secrets().catch(() => ({})));
  const leaks = scanForLeaks(bundle, secrets);
  if (leaks.length > 0) {
    throw new CliError(
      `Refusing to write this bundle: it appears to contain ${leaks.join(', ')}. ` +
        'This is a bug in RigorRun, not in your setup — please report it without attaching anything.',
    );
  }

  const json = `${JSON.stringify(bundle, null, 2)}\n`;

  if (flags.out) {
    await writeFile(flags.out, json, { mode: 0o600 });
    heading('Feedback bundle');
    line(`Written to ${flags.out}`);
    line();
    line(c.grey('It contains no credentials, no tool arguments, no results and no'));
    line(c.grey('names from your business. Open it before you send it.'));
    return 0;
  }

  process.stdout.write(json);
  return 0;
}
