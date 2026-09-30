/**
 * A project's time budgets: validated, carried into the suite, and refused
 * when a case could not outlast one call that never answers (audit R-4).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DEFAULT_CASE_TIMEOUT_MS, DEFAULT_TOOL_CALL_TIMEOUT_MS } from '@rigorrun/core';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '../src/index.ts';
import { budgetProblem, newProject, parseProject, type Project } from '../src/project.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const DESK = {
  kind: 'mcp' as const,
  transport: 'stdio' as const,
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
  url: '',
  secretNames: [],
};
const READS = {
  readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
  verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
  reset: { kind: 'tool' as const, tool: 'reset_desk' },
};

let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-budgets-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
}, 60_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
});

describe('the budget rule', () => {
  it('refuses a case budget that cannot outlast one lost response', () => {
    // The audit's configuration: 15 s cases under a 20 s tool timeout.
    expect(budgetProblem({ toolCallMs: 20_000, caseMs: 15_000 })).toMatch(/15000 ms cannot outlast/);
    expect(budgetProblem({ toolCallMs: 20_000, caseMs: 24_999 })).not.toBeNull();
    expect(budgetProblem({ toolCallMs: 20_000, caseMs: 25_000 })).toBeNull();
    expect(budgetProblem({ toolCallMs: DEFAULT_TOOL_CALL_TIMEOUT_MS, caseMs: DEFAULT_CASE_TIMEOUT_MS })).toBeNull();
  });

  it('gives a project written before budgets existed the defaults', () => {
    const { budgets: _dropped, ...legacy } = newProject({ id: 'p_legacy', name: 'legacy', now: '2026-09-01T00:00:00.000Z' });
    expect(parseProject(legacy).budgets).toEqual({ toolCallMs: DEFAULT_TOOL_CALL_TIMEOUT_MS, caseMs: DEFAULT_CASE_TIMEOUT_MS });
  });
});

describe('a project with its own budgets', () => {
  it('saves budgets that work and refuses ones that do not', async () => {
    project = await service.createProject({ name: 'Desk', goal: 'Confirm a held booking.' });
    project = (await service.connectEnvironment(project.id, DESK, 'ephemeral')).project;
    project = (await service.configureEnvironment(project.id, { ...READS, budgets: { toolCallMs: 3_000, caseMs: 9_000 } })).project;
    expect(project.budgets).toEqual({ toolCallMs: 3_000, caseMs: 9_000 });

    await expect(
      service.configureEnvironment(project.id, { ...READS, budgets: { caseMs: 4_000 } }),
    ).rejects.toThrow(/cannot outlast one tool call/);
    expect((await store.read(project.id)).budgets).toEqual({ toolCallMs: 3_000, caseMs: 9_000 });
  }, 60_000);

  it('writes the case budget into every generated case', async () => {
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
    await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
    await service.finishTeaching(project.id);
    const contract = await service.compile(project.id);
    await service.review(project.id, { confirmedRuleIds: contract.rules.map((rule) => rule.id) });
    const benchmark = await service.generate(project.id);
    expect(benchmark.cases.length).toBeGreaterThan(0);
    expect(new Set(benchmark.cases.map((entry) => entry.timeoutMs))).toEqual(new Set([9_000]));
  }, 120_000);

  it('refuses a run-time budget override that could not outlast one lost response', async () => {
    await expect(service.runAgent(project.id, 'any', { caseTimeoutMs: 3_500 })).rejects.toThrow(/cannot outlast/);
  });
});
