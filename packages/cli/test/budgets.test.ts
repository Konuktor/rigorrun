/**
 * `--case-timeout`: a run's per-case budget from the command line, recorded on
 * every case, and refused when it is not a positive number (audit R-4).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.ts';

const originalCwd = process.cwd();
let workDir: string;

async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  try {
    return { code: await main(args), out, err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'rigorrun-cli-budgets-'));
  process.chdir(workDir);
  await cli('demo', '--quiet');
}, 120_000);

afterAll(async () => {
  process.chdir(originalCwd);
  await rm(workDir, { recursive: true, force: true });
});

describe('--case-timeout', () => {
  it('runs every case under the budget it is given, and records it', async () => {
    const benchmark = join(workDir, '.rigorrun', 'benchmark.json');
    await access(benchmark);
    const { out } = await cli('run', benchmark, '--agent', 'careful', '--case-timeout', '45000', '--json');
    const run = JSON.parse(out) as { caseResults: { budgetMs?: number; outcome?: string }[] };
    expect(run.caseResults.length).toBeGreaterThan(0);
    expect(run.caseResults.every((entry) => entry.budgetMs === 45_000)).toBe(true);
    expect(run.caseResults.every((entry) => typeof entry.outcome === 'string')).toBe(true);
  }, 120_000);

  it('refuses a budget that is not a positive number, as a configuration error', async () => {
    const benchmark = join(workDir, '.rigorrun', 'benchmark.json');
    expect((await cli('run', benchmark, '--agent', 'careful', '--case-timeout', '0')).code).toBe(2);
  }, 60_000);

  it('is documented', async () => {
    expect((await cli('--help')).out).toContain('--case-timeout');
  });
});
