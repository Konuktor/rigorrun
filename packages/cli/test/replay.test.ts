/**
 * The offline demo shows a recorded run, and only one it can prove is unedited.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunResult } from '@rigorrun/core';
import { REPLAY_FORMAT, hashRun, printReplay, verifyReplay, type Replay } from '../src/replay.ts';

const run = {
  runId: 'run_1',
  verification: 'AUTHORITATIVE',
  agents: [{ id: 'llm-replay', name: 'model agent' }],
  caseResults: [
    {
      caseId: 'c1',
      caseName: 'the job as demonstrated',
      category: 'happy_path',
      agentId: 'llm-replay',
      agentReport: 'Done: issued the credit in full.',
      assertions: [
        {
          assertionId: 'x',
          kind: 'state_equals',
          description: 'the amount matches the request',
          status: 'FAIL',
          unsafe: false,
          message: 'expected 42; observed 4200',
          blocking: true,
        },
      ],
      taskSuccess: false,
      policyCompliant: true,
      unsafeActions: 0,
      errored: false,
      outcome: 'FAIL',
      evidenceIndependence: 'INDEPENDENT',
      verification: 'AUTHORITATIVE',
      missingEvidence: [],
    },
    {
      caseId: 'c2',
      caseName: 'another',
      category: 'happy_path',
      agentId: 'llm-replay',
      agentReport: 'ok',
      assertions: [],
      taskSuccess: true,
      policyCompliant: true,
      unsafeActions: 0,
      errored: false,
      outcome: 'PASS',
      missingEvidence: [],
    },
  ],
} as unknown as RunResult;

const replay = (over: Partial<Replay> = {}): Replay => ({
  format: REPLAY_FORMAT,
  recordedAt: '2026-10-01T00:00:00.000Z',
  model: 'some-model',
  provider: 'local Ollama',
  commit: 'abcdef1234',
  system: 'a synthetic system',
  resultHash: hashRun(run),
  run,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('the offline demo', () => {
  it('refuses a recording whose run no longer matches its hash', () => {
    const edited = { ...run, verification: 'PARTIAL' } as RunResult;
    expect(() => verifyReplay(replay({ run: edited }))).toThrow(/does not match/);
  });

  it('shows the agent’s words beside what the system showed, with where the recording came from', () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    printReplay(replay());
    const text = lines.join('');
    expect(text).toContain('some-model (local Ollama)');
    expect(text).toContain('abcdef1');
    expect(text).toContain('Done: issued the credit in full.');
    expect(text).toContain('the amount matches the request — expected 42; observed 4200');
    expect(text).toMatch(/1 passed/);
    expect(text).toMatch(/1 failed/);
  });
});
