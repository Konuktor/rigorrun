/**
 * The CLI path a build server takes.
 *
 * A person connects a system and teaches a job in the interface, because both
 * are interactive by nature — you are looking at what came back. Running the
 * suite you already have, and failing a build when it regresses, has to work
 * with no interface and no person, or none of this can defend a deployment.
 *
 * The exit codes are the whole contract here: 0 passed, 1 the agent failed,
 * 2 the setup is wrong. A build server cannot tell those apart from prose.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '@rigorrun/daemon';
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { CAREFUL, CARELESS, runTask } from '../../../fixtures/external/booking-agent/src/agent.ts';
import { main } from '../src/main.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function cli(...args: string[]): Promise<{ code: number; out: string }> {
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
    return { code: await main(args), out };
  } finally {
    spy.mockRestore();
    errSpy.mockRestore();
  }
}

let home: string;
let projectId: string;
let carefulUrl: string;
let carelessUrl: string;
const servers: { close: () => Promise<void>; url: string }[] = [];

/** Sets a project up the way the interface would, so the CLI has something real. */
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-cli-project-'));
  const proxy = new ProxyServer();
  await proxy.start();
  const service = new Service({ store: new ProjectStore(home), proxy });

  const project = await service.createProject({ name: 'Desk', goal: 'Confirm a held booking.' });
  projectId = project.id;

  await service.connectEnvironment(
    projectId,
    {
      kind: 'mcp',
      transport: 'stdio',
      command: join(root, 'node_modules', '.bin', 'tsx'),
      args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
      url: '',
      secretNames: [],
    },
    'ephemeral',
  );
  await service.configureEnvironment(projectId, {
    readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
    verifierReads: [{ tool: 'find_bookings' }, { tool: 'list_venues' }, { tool: 'list_organisers' }],
    reset: { kind: 'tool', tool: 'reset_desk' },
  });

  await service.startTeaching(projectId);
  await service.teachStep(projectId, 'find_bookings', {});
  await service.teachStep(projectId, 'get_booking', { bookingId: 'BKG-4001' });
  await service.teachStep(projectId, 'record_signoff', {
    bookingId: 'BKG-4001',
    approver: 'Dana Whitlock',
  });
  await service.teachStep(projectId, 'confirm_booking', { bookingId: 'BKG-4001' });
  await service.finishTeaching(projectId);
  await service.answerSchema(projectId, [
    { questionId: 'q_unit_Booking_depositAmount', value: 'currency' },
    { questionId: 'q_role_Booking_signedOffBy', value: 'actor' },
    { questionId: 'q_untrusted_Booking_note', value: 'yes' },
  ]);

  const draft = await service.compile(projectId);
  await service.review(projectId, { confirmedRuleIds: draft.rules.map((rule) => rule.id) });
  await service.generate(projectId);

  for (const [behaviour, into] of [
    [CAREFUL, 'careful'],
    [CARELESS, 'careless'],
  ] as const) {
    const served = await serve(
      defineAgent(
        async ({ task, environment }) => ({
          status: 'completed' as const,
          output: await runTask(environment.mcpUrl, task.inputs, behaviour),
        }),
        { name: `booking-agent-${into}`, version: '1.0.0' },
      ),
    );
    servers.push(served);
    if (into === 'careful') carefulUrl = served.url;
    else carelessUrl = served.url;
  }

  await service.addAgent(projectId, { name: 'careful', endpoint: carefulUrl });
  await service.workspace.close();
  await proxy.stop();
}, 180_000);

afterAll(async () => {
  for (const server of servers) await server.close();
  await rm(home, { recursive: true, force: true });
});

describe('projects from the command line', () => {
  it('lists what is on this machine', async () => {
    const { code, out } = await cli('projects', '--home', home);
    expect(code).toBe(0);
    expect(out).toContain('Desk');
    expect(out).toContain('connected');
  }, 60_000);

  it('runs the suite and reports how the verdict was reached', async () => {
    const { out } = await cli('run', '--project', projectId, '--home', home);
    expect(out).toContain('PARTIAL');
    expect(out).toContain('RESET');
    // The limits travel with the result rather than being left in a log.
    expect(out).toMatch(/limit/);
  }, 180_000);

  it('gates, and says which threshold it missed', async () => {
    const { code, out } = await cli(
      'gate',
      '--project',
      projectId,
      '--home',
      home,
      '--min-success',
      '1',
    );
    // The careful agent does not satisfy every confirmed rule, so this fails —
    // and failing is the useful behaviour to assert. A gate that passes on a
    // demanding threshold is a gate nobody should trust.
    expect(code).toBe(1);
    expect(out).toContain('FAIL');
    expect(out).toContain('task success');
  }, 180_000);

  it('passes when the bar is one the agent clears', async () => {
    const { code } = await cli(
      'gate',
      '--project',
      projectId,
      '--home',
      home,
      '--min-success',
      '0',
      '--min-policy',
      '0',
      '--max-unsafe',
      '100',
    );
    expect(code).toBe(0);
  }, 180_000);

  it('exits 2 when the setup is wrong rather than pretending it failed', async () => {
    const missing = await cli('run', '--project', 'p_nope', '--home', home);
    expect(missing.code).toBe(2);
    expect(missing.out).toContain('No project');
  }, 60_000);
});

describe('a regression, from the command line', () => {
  it('names the case that broke and exits non-zero', async () => {
    const proxy = new ProxyServer();
    await proxy.start();
    const service = new Service({ store: new ProjectStore(home), proxy });
    const added = await service.addAgent(projectId, { name: 'careless', endpoint: carelessUrl });
    const after = await service.runAgent(projectId, added.agent.id);
    await service.workspace.close();
    await proxy.stop();

    const { code, out } = await cli(
      'compare-runs',
      '--project',
      projectId,
      after.runId,
      '--home',
      home,
    );
    expect(code).toBe(1);
    expect(out).toMatch(/regressed/);
  }, 240_000);
});

describe('secrets from the command line', () => {
  it('lists names and never values', async () => {
    process.env['RIGORRUN_SECRET_VALUE'] = 'sk-not-a-real-token';
    await cli('secret', 'set', 'DESK_TOKEN', '--home', home);
    delete process.env['RIGORRUN_SECRET_VALUE'];

    const { out } = await cli('secret', 'list', '--home', home);
    expect(out).toContain('DESK_TOKEN');
    // There is deliberately no command that prints one. A secret that can be
    // printed is a secret that ends up in a terminal recording.
    expect(out).not.toContain('sk-not-a-real-token');
  }, 60_000);

  it('refuses to take a value on the command line', async () => {
    const { code, out } = await cli('secret', 'set', 'OTHER', '--home', home);
    expect(code).toBe(2);
    expect(out).toContain('shell history');
  }, 60_000);
});
