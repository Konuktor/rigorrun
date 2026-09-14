/**
 * Reproductions of RigorRun product gaps R-7, R-6 and R-2 through the CLI and
 * the project schema, written only against pre-remediation APIs. Every test
 * asserts the DEFECT: passing on 07dda8c, failing once fixed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorSchema } from '@rigorrun/daemon';
import { main } from '../src/main.ts';

let scratch: string;

async function cli(...args: string[]): Promise<{ code: number; text: string }> {
  let text = '';
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    text += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    text += String(chunk);
    return true;
  });
  try {
    return { code: await main(args), text };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rigorrun-cli-repro-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('R-7 — verify --needs-credential', () => {
  it('DEFECT: the documented flag is rejected before anything runs', async () => {
    const { code, text } = await cli('verify', 'bogus-reference', '--needs-credential', 'sync');
    expect(code).toBe(2);
    expect(text).toMatch(/needs-credential/);
  });
});

describe('R-6 — headless project setup', () => {
  it('DEFECT: no command creates a project from the command line', async () => {
    const { code, text } = await cli('setup', join(scratch, 'project.json'));
    expect(code).toBe(2);
    expect(text).toMatch(/Unknown command/);
  });
});

describe('R-2 — an independent verifier for an MCP project', () => {
  it('DEFECT: a verifier on an MCP connector is silently dropped', () => {
    const parsed = ConnectorSchema.parse({
      kind: 'mcp', transport: 'stdio', command: 'server', args: [], url: '', secretNames: [],
      verifier: { kind: 'mcp', transport: 'stdio', command: 'reader', args: [], url: '', secretNames: [] },
    }) as Record<string, unknown>;
    expect(parsed['verifier']).toBeUndefined();
  });
});
