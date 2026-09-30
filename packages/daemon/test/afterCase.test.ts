/**
 * The after-case hook at the service (requalification decision 8).
 *
 * A harness that judges each case with its own oracle, on a system nothing
 * resets between cases, needs a point after a case has finished — its final
 * state read — and before the next case begins. `runAgent` offers that point to
 * whoever asks, and stops the run if the reading could not be taken.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { CaseResult } from '@rigorrun/core';
import { ProxyServer } from '@rigorrun/proxy';
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { CAREFUL, runTask } from '../../../fixtures/external/booking-agent/src/agent.ts';
import { ProjectStore, Service } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const desk = {
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  url: '',
  secretNames: ['DESK_STATE_FILE'],
};

let scratch: string;
let home: string;
let proxy: ProxyServer;
let service: Service;
let projectId: string;
let agentId: string;
const servers: { close: () => Promise<void>; url: string }[] = [];

type HookedRun = (projectId: string, agentId: string, options: { afterCase?: (result: CaseResult, index: number) => Promise<void> }) => ReturnType<Service['runAgent']>;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rigorrun-after-case-state-'));
  home = await mkdtemp(join(tmpdir(), 'rigorrun-after-case-'));
  const store = new ProjectStore(home);
  await store.setSecret('DESK_STATE_FILE', join(scratch, 'desk.json'));
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });

  const project = await service.createProject({ name: 'Desk, hooked', goal: 'Confirm a held booking.' });
  projectId = project.id;
  await service.connectEnvironment(projectId, { ...desk, verifier: desk }, 'ephemeral');
  await service.configureEnvironment(projectId, {
    readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking', 'verifier:find_bookings'],
    verifierReads: [{ tool: 'verifier:find_bookings' }],
    reset: { kind: 'tool', tool: 'reset_desk' },
  });
  await service.startTeaching(projectId);
  await service.teachStep(projectId, 'record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
  await service.teachStep(projectId, 'confirm_booking', { bookingId: 'BKG-4001' });
  await service.finishTeaching(projectId);
  const contract = await service.compile(projectId);
  await service.review(projectId, { confirmedRuleIds: contract.rules.map((rule) => rule.id) });
  await service.generate(projectId);

  const served = await serve(
    defineAgent(
      async ({ task, environment }) => ({ status: 'completed' as const, output: await runTask(environment.mcpUrl, task.inputs, CAREFUL) }),
      { name: 'booking-agent', version: '1.0.0' },
    ),
  );
  servers.push(served);
  agentId = (await service.addAgent(projectId, { name: 'Careful agent', endpoint: served.url })).agent.id;
}, 240_000);

afterAll(async () => {
  for (const entry of servers) await entry.close();
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

describe('runAgent with an after-case hook', () => {
  it('calls it once per case, in case order, each time after that case has finished', async () => {
    const seen: { caseId: string; index: number; read: boolean }[] = [];
    const run = service.runAgent.bind(service) as unknown as HookedRun;
    const result = await run(projectId, agentId, {
      afterCase: async (finished, index) => {
        seen.push({ caseId: finished.caseId, index, read: finished.finalStateHash !== '' });
      },
    });
    expect(result.caseResults.length).toBeGreaterThan(1);
    expect(seen.map((entry) => entry.caseId)).toEqual(result.caseResults.map((entry) => entry.caseId));
    expect(seen.map((entry) => entry.index)).toEqual(result.caseResults.map((_, index) => index));
    expect(seen.every((entry) => entry.read)).toBe(true);
  }, 300_000);

  it('stops the run before the next case when the hook fails', async () => {
    let calls = 0;
    const run = service.runAgent.bind(service) as unknown as HookedRun;
    await expect(
      run(projectId, agentId, {
        afterCase: async () => {
          calls += 1;
          throw new Error('the reading could not be taken');
        },
      }),
    ).rejects.toThrow('the reading could not be taken');
    expect(calls).toBe(1);
  }, 300_000);
});
