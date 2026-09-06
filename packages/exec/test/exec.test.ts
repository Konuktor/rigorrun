/**
 * The invariant this package exists to hold.
 *
 * `packages/cli/test/security.test.ts` asserts that exactly one file in the
 * repository imports `node:child_process`. That test now points here, so these
 * assertions guard the other half: that this package stays small enough to be
 * imported from anywhere without dragging a dependency graph behind it.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertRunnable, runCommand } from '../src/index.ts';

const pkg = fileURLToPath(new URL('../package.json', import.meta.url));

describe('@rigorrun/exec', () => {
  it('depends on nothing, so anything may import it', async () => {
    const manifest = JSON.parse(await readFile(pkg, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it('refuses a command carrying shell punctuation', () => {
    for (const command of ['docker; rm -rf /', 'sh -c `id`', 'a && b', 'x | y', 'a\nb']) {
      expect(() =>
        assertRunnable({ command, args: [], timeoutMs: 1_000, provenance: 'rigorrun-internal' }),
      ).toThrow(/shell punctuation/);
    }
  });

  it('passes arguments as an array, so punctuation inside one is inert', async () => {
    const result = await runCommand({
      command: 'node',
      args: ['-e', 'process.stdout.write(process.argv[1])', '; rm -rf /'],
      timeoutMs: 10_000,
      provenance: 'rigorrun-internal',
    });
    expect(result.code).toBe(0);
    // It arrived as data. It was never a command.
    expect(result.stdout).toBe('; rm -rf /');
  });

  it('reports a timeout as a result rather than throwing', async () => {
    const result = await runCommand({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 60_000)'],
      timeoutMs: 300,
      provenance: 'rigorrun-internal',
    });
    expect(result.timedOut).toBe(true);
  });

  it('does not hand a child the whole environment', async () => {
    process.env['RIGORRUN_EXEC_LEAK_PROBE'] = 'leaked';
    try {
      const result = await runCommand({
        command: 'node',
        args: ['-e', 'process.stdout.write(String(process.env.RIGORRUN_EXEC_LEAK_PROBE))'],
        timeoutMs: 10_000,
        provenance: 'rigorrun-internal',
      });
      expect(result.stdout).toBe('undefined');
    } finally {
      delete process.env['RIGORRUN_EXEC_LEAK_PROBE'];
    }
  });
});
