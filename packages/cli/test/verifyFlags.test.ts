/**
 * `rigorrun verify --needs-credential` reaches the planner (audit R-7).
 *
 * The documented flag was never parsed. The sandbox is replaced here so the
 * test observes exactly what the CLI hands to `verifyServer` without needing a
 * container runtime.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('@rigorrun/sandbox', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    reapOrphans: async () => [],
    verifyServer: async (_reference: string, options: Record<string, unknown>) => {
      captured.push(options);
      throw new Error('stopped by the test after the options were captured');
    },
  };
});

const { main } = await import('../src/main.ts');

async function quietly(args: string[]): Promise<number> {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    return await main(args);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

afterEach(() => {
  captured.length = 0;
});

describe('verify --needs-credential', () => {
  it('passes every named tool to the planner', async () => {
    await quietly(['verify', 'npm:example-server@1.0.0', '--needs-credential', 'sync', '--needs-credential', 'send', '--json']);
    expect(captured).toHaveLength(1);
    expect(captured[0]!['needsCredential']).toEqual(['sync', 'send']);
  });

  it('passes nothing when the flag is absent, so nothing is inferred', async () => {
    await quietly(['verify', 'npm:example-server@1.0.0', '--json']);
    expect(captured).toHaveLength(1);
    expect('needsCredential' in captured[0]!).toBe(false);
  });
});
