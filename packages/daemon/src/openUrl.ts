/**
 * Opening a browser, for the two places that need to.
 *
 * The runner prints a pairing URL, and signing in to a remote MCP server sends
 * somebody to an authorization server. Both want the same thing: try the
 * platform's handler, and never make a fuss about not being able to.
 *
 * There is no dependency for this — three platforms, one command each — and
 * the URL the caller already has is the fallback for every case they do not
 * cover: a headless box, an SSH session, a container, a desktop with no
 * handler registered.
 */
import { runCommand } from './exec.ts';

export async function openInBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? { command: 'cmd.exe', args: ['/c', 'start', '', url] }
        : { command: 'xdg-open', args: [url] };
  await runCommand({
    ...command,
    timeoutMs: 5_000,
    // Not operator input: this URL is one RigorRun printed a moment ago.
    provenance: 'rigorrun-internal',
  }).catch(() => undefined);
}
