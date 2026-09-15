/**
 * `--after-case <program>`: a generic hook that runs after each case has
 * finished and before the next one starts.
 *
 * It exists so a harness can take its own reading of a system between cases —
 * an oracle that must judge each case on its own, on a system that is not reset
 * between them. A reading that failed must never be scored as if it had been
 * taken, so a failing program stops the run. And it starts like every other
 * command RigorRun runs: the program itself, never a shell, with a minimal
 * environment.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaseResult } from '@rigorrun/core';
import { afterCaseHook } from '../src/afterCase.ts';
import { main } from '../src/main.ts';

let dir: string;

async function program(name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, body);
  await chmod(path, 0o755);
  return path;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rigorrun-after-case-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const finished = (over: Partial<CaseResult>): CaseResult =>
  ({
    runId: 'run_1',
    agentId: 'agent_1',
    caseId: 'case_live__happy_path',
    category: 'happy_path',
    outcome: 'PASS',
    ...over,
  }) as CaseResult;

describe('afterCaseHook', () => {
  it('runs the program after each case with what identifies the case, and nothing else of this environment', async () => {
    const out = join(dir, 'seen.jsonl');
    const recorder = await program(
      'record.cjs',
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const keys = ["RIGORRUN_RUN_ID", "RIGORRUN_AGENT_ID", "RIGORRUN_CASE_ID", "RIGORRUN_CASE_INDEX", "RIGORRUN_CASE_OUTCOME", "RIGORRUN_CASE_CATEGORY", "RIGORRUN_UNRELATED_TOKEN"];',
        `fs.appendFileSync(${JSON.stringify(out)}, JSON.stringify(Object.fromEntries(keys.map((k) => [k, process.env[k]]))) + "\\n");`,
      ].join('\n'),
    );
    process.env['RIGORRUN_UNRELATED_TOKEN'] = 'must-not-reach-the-hook';
    try {
      const hook = afterCaseHook(recorder);
      await hook(finished({ caseId: 'case_a' }), 0);
      await hook(finished({ caseId: 'case_b', category: 'missing_precondition', outcome: 'FAIL' }), 1);
    } finally {
      delete process.env['RIGORRUN_UNRELATED_TOKEN'];
    }
    const lines = (await readFile(out, 'utf8')).trim().split('\n').map((entry) => JSON.parse(entry) as Record<string, string>);
    expect(lines).toEqual([
      { RIGORRUN_RUN_ID: 'run_1', RIGORRUN_AGENT_ID: 'agent_1', RIGORRUN_CASE_ID: 'case_a', RIGORRUN_CASE_INDEX: '0', RIGORRUN_CASE_OUTCOME: 'PASS', RIGORRUN_CASE_CATEGORY: 'happy_path' },
      { RIGORRUN_RUN_ID: 'run_1', RIGORRUN_AGENT_ID: 'agent_1', RIGORRUN_CASE_ID: 'case_b', RIGORRUN_CASE_INDEX: '1', RIGORRUN_CASE_OUTCOME: 'FAIL', RIGORRUN_CASE_CATEGORY: 'missing_precondition' },
    ]);
  });

  it('stops the run with exit code 2, naming the case, when the program fails', async () => {
    const failing = await program('fail.sh', '#!/bin/sh\nexit 3\n');
    await expect(afterCaseHook(failing)(finished({ caseId: 'case_a' }), 0)).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('case_a'),
    });
  });

  it('refuses a shell command line, because it never runs one', async () => {
    await expect(afterCaseHook('echo reading | cat')(finished({ caseId: 'case_a' }), 0)).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/shell punctuation/),
    });
  });

  it('sends what the program prints to stderr, so --json output stays parseable', async () => {
    const noisy = await program('noisy.sh', '#!/bin/sh\necho reading taken\n');
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await afterCaseHook(noisy)(finished({}), 0);
    } finally {
      spy.mockRestore();
    }
    expect(written.join('')).toContain('reading taken');
  });
});

describe('the --after-case flag', () => {
  it('is accepted by the command line', async () => {
    let out = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    try {
      await main(['run', '--project', 'p_does_not_exist', '--home', dir, '--after-case', 'true']);
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
    expect(out).not.toMatch(/Unknown option/i);
  });
});
