import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileWorkflow, WORKFLOWS } from '@rigorrun/environments';
import { cmdGenerate, type Flags } from '../src/commands.ts';
import { CliError } from '../src/io.ts';
import { main } from '../src/main.ts';

let dir: string;
const cwd = process.cwd();
const flags: Flags = {
  agent: [],
  json: true,
  quiet: true,
  published: false,
  allowReference: false,
  out: 'benchmark.json',
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rigorrun-generate-review-'));
  const { draft, contract } = await compileWorkflow(WORKFLOWS[0]!);
  await writeFile(join(dir, 'draft.json'), JSON.stringify(draft));
  await writeFile(join(dir, 'reviewed.json'), JSON.stringify(contract));
  process.chdir(dir);
});
afterAll(async () => {
  process.chdir(cwd);
  await rm(dir, { recursive: true, force: true });
});

it('refuses inferred rules without creating a benchmark and preserves CLI exit 2', async () => {
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    await expect(cmdGenerate('draft.json', flags)).rejects.toBeInstanceOf(CliError);
    await expect(readFile(join(dir, 'benchmark.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await main(['generate', 'draft.json', '-o', 'benchmark.json'])).toBe(2);
  } finally {
    output.mockRestore();
    error.mockRestore();
  }
});

it('generates from a contract with explicit review already recorded', async () => {
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  try {
    expect(await cmdGenerate('reviewed.json', flags)).toBe(0);
    expect(
      JSON.parse(await readFile(join(dir, 'benchmark.json'), 'utf8')).cases.length,
    ).toBeGreaterThan(0);
  } finally {
    output.mockRestore();
  }
});
