import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cmdDraft } from '../src/cli/draft.ts';
import { parseMatrix } from '../src/matrix.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const entry = fileURLToPath(
  new URL('../../../fixtures/external/mcp-venue-desk/src/stdio.ts', import.meta.url),
);
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env['RIGORRUN_TEST_SIDE_KEY'];
  for (const step of cleanup.splice(0).reverse()) await step();
});

describe('permissions draft CLI', () => {
  it('discovers a live stdio server and writes a parseable draft', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rr-permissions-draft-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const outFile = join(dir, 'permissions.json');
    const secret = 'do-not-print-this-value';
    process.env['RIGORRUN_TEST_SIDE_KEY'] = secret;
    let stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });

    await expect(
      cmdDraft([
        '--mcp-command',
        tsx,
        '--mcp-arg',
        entry,
        '--agent-secret',
        'RIGORRUN_TEST_SIDE_KEY',
        '--apply-env',
        'SIDE_KEY',
        '--out',
        outFile,
        '--json',
      ]),
    ).resolves.toBe(0);

    const raw = await readFile(outFile, 'utf8');
    const matrix = parseMatrix(raw);
    expect(matrix.server).toEqual({
      transport: 'stdio',
      command: tsx,
      args: [entry],
    });
    expect(matrix.reads.map((read) => read.tool)).toEqual(
      expect.arrayContaining(['list_venues', 'list_organisers', 'find_bookings']),
    );
    expect(matrix.reset?.tool).toBe('reset_desk');
    expect(matrix.unconfirmed).toEqual(
      expect.arrayContaining(['credentials.observer.secret', 'reads', 'tenant.field']),
    );
    expect(raw).not.toContain(secret);
    expect(stdout).not.toContain(secret);
    expect(JSON.parse(stdout)).toMatchObject({ file: outFile });
  }, 30_000);
});
