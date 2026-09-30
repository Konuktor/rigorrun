/**
 * Black-box agents, graded on what the system holds afterwards.
 *
 * Each agent here is what a founder has: a service that takes a piece of work
 * and does it against its own system, through its own connection — here, the
 * desk's shared state file, written directly, never through RigorRun. RigorRun
 * only posts the work and reads the desk afterwards through a verifier
 * connection the agents never touch.
 *
 * One agent does the job properly and five get it wrong in the ways that cost
 * money: skipping the sign-off, claiming work it never did, working on the
 * wrong record, writing to a record nobody asked about, and doing nothing. The
 * correct one must never fail a case; each wrong one must fail at least one,
 * and must fail the job's own case. Every verdict is INDEPENDENT, every case
 * says RigorRun saw state only, and the checks it could not make are listed
 * rather than allowed to hold the verdict hostage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { EnvironmentContract, RunResult } from '@rigorrun/core';
import { ProxyServer } from '@rigorrun/proxy';
import { Desk } from '../../../fixtures/external/mcp-venue-desk/src/desk.ts';
import { ProjectStore, Service, TASK_PROTOCOL } from '../src/index.ts';
import type { Project } from '../src/project.ts';

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
let stateFile: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;
const servers: Server[] = [];

/** The agent's own way into the desk: the state file, read and written directly. */
function onDesk<T>(work: (desk: Desk) => T): T {
  const direct = new Desk();
  const holder = direct as unknown as { state: unknown };
  if (existsSync(stateFile)) holder.state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const result = work(direct);
  writeFileSync(stateFile, JSON.stringify(holder.state));
  return result;
}

type Behaviour = (bookingId: string) => string;

const behaviours: Record<string, Behaviour> = {
  // The job as it was demonstrated: a sign-off, then the confirmation. One
  // demonstration cannot say the sign-off is only needed above some deposit,
  // so the suite holds every case to it, and so does the correct agent.
  careful: (bookingId) =>
    onDesk((d) => {
      const booking = d.getBooking(bookingId);
      if (!booking.ok) return `No booking ${bookingId}.`;
      if (booking.value.bookingStatus === 'cancelled') return `${bookingId} is cancelled; left alone.`;
      // The confirmed rule: only organisers in good standing are confirmed.
      const organiser = d.listOrganisers().find((entry) => entry.organiserId === booking.value.organiserId);
      if (organiser?.standing !== 'good') return `${bookingId}'s organiser is not in good standing; not confirmed.`;
      if (!booking.value.signedOffBy) d.recordSignoff(bookingId, 'Duty manager');
      d.confirmBooking(bookingId);
      return `Confirmed ${bookingId}.`;
    }),
  skipsSignoff: (bookingId) =>
    onDesk((d) => {
      d.confirmBooking(bookingId);
      return `Confirmed ${bookingId}.`;
    }),
  claimsWithoutActing: (bookingId) => `Confirmed ${bookingId}.`,
  wrongRecord: (bookingId) =>
    onDesk((d) => {
      const other = bookingId === 'BKG-4002' ? 'BKG-4004' : 'BKG-4002';
      d.recordSignoff(other, 'Duty manager');
      d.confirmBooking(other);
      return `Confirmed ${bookingId}.`;
    }),
  extraWrite: (bookingId) =>
    onDesk((d) => {
      const booking = d.getBooking(bookingId);
      if (booking.ok && booking.value.bookingStatus === 'held') {
        if (!booking.value.signedOffBy) d.recordSignoff(bookingId, 'Duty manager');
        d.confirmBooking(bookingId);
      }
      const other = bookingId === 'BKG-4002' ? 'BKG-4004' : 'BKG-4002';
      d.recordSignoff(other, 'Duty manager');
      return `Confirmed ${bookingId}.`;
    }),
  doesNothing: () => 'Looked at it; nothing needed doing.',
};

function blackBox(behaviour: Behaviour): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let text = '';
      req.on('data', (chunk) => (text += chunk));
      req.on('end', () => {
        const body = JSON.parse(text) as { protocol: string; probe?: boolean; task?: { inputs: Record<string, unknown> } };
        res.writeHead(200, { 'content-type': 'application/json' });
        if (body.probe) return res.end(JSON.stringify({ ok: true }));
        expect(body.protocol).toBe(TASK_PROTOCOL);
        const output = behaviour(String(body.task?.inputs['bookingId'] ?? ''));
        res.end(JSON.stringify({ status: 'completed', output }));
      });
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
    });
  });
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'rigorrun-blackbox-state-'));
  home = await mkdtemp(join(tmpdir(), 'rigorrun-blackbox-'));
  stateFile = join(scratch, 'desk.json');
  store = new ProjectStore(home);
  await store.setSecret('DESK_STATE_FILE', stateFile);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });

  project = await service.createProject({ name: 'Desk, black box', goal: 'Confirm a held booking.' });
  project = (await service.connectEnvironment(project.id, { ...desk, verifier: desk }, 'ephemeral')).project;
  project = (
    await service.configureEnvironment(project.id, {
      readOnlyTools: [
        'list_venues', 'list_organisers', 'find_bookings', 'get_booking',
        'verifier:list_venues', 'verifier:list_organisers', 'verifier:find_bookings', 'verifier:get_booking',
      ],
      verifierReads: [
        { tool: 'verifier:find_bookings' },
        { tool: 'verifier:list_venues' },
        { tool: 'verifier:list_organisers' },
      ],
      reset: { kind: 'tool', tool: 'reset_desk' },
    })
  ).project;
  await service.startTeaching(project.id);
  await service.teachStep(project.id, 'record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
  await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
  await service.finishTeaching(project.id);
  const contract = await service.compile(project.id);
  await service.review(project.id, { confirmedRuleIds: contract.rules.map((rule) => rule.id) });
  await service.generate(project.id);
}, 240_000);

afterAll(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

async function run(name: string): Promise<RunResult> {
  const endpoint = await blackBox(behaviours[name]!);
  const added = await service.addAgent(project.id, { name, blackBox: { endpoint } });
  expect(added.agent.lastProbeOk, added.agent.lastProbeProblem).toBe(true);
  return service.runAgent(project.id, added.agent.id);
}

const failed = (result: RunResult) => result.caseResults.filter((entry) => entry.outcome === 'FAIL');
const happy = (result: RunResult) => result.caseResults.find((entry) => entry.category === 'happy_path')!;

describe('the suite a black-box agent is held to', () => {
  it('holds the job to leaving the sign-off recorded, whoever the approver', async () => {
    // The approver was typed by hand, so the name is never pinned; that a
    // sign-off exists afterwards is the state a skipped one leaves missing.
    const contract = await store.readArtefact<EnvironmentContract>(project.id, 'contract');
    expect(contract?.expectedChanges).toContainEqual(
      expect.objectContaining({ field: 'signedOffBy', compare: 'populated', from: null }),
    );
  });
});

describe('a black-box agent that does the job properly', () => {
  it('fails no case, and every verdict rests on an independent reading of state alone', async () => {
    const result = await run('careful');
    expect(failed(result).map((entry) => `${entry.caseName}: ${entry.outcomeReason}`)).toEqual([]);
    expect(happy(result).outcome, happy(result).outcomeReason).toBe('PASS');
    for (const entry of result.caseResults) {
      expect(entry.evidenceIndependence).toBe('INDEPENDENT');
      expect(entry.observation).toBe('state-only');
      expect(entry.actions).toEqual([]);
      // Checks about the order of calls are listed as not made, never blocking.
      for (const check of entry.assertions.filter((a) => a.verificationSource === 'EVENT')) {
        expect(check.status).toBe('UNVERIFIABLE');
        expect(check.blocking).toBe(false);
      }
    }
    expect(result.limits.map((limit) => limit.id)).toContain('no_call_trace');
    expect(happy(result).agentReport).toBe('Confirmed BKG-4001.');
  }, 300_000);
});

describe('black-box agents that get it wrong', () => {
  for (const name of ['skipsSignoff', 'claimsWithoutActing', 'wrongRecord', 'extraWrite', 'doesNothing']) {
    it(`fails ${name} on the job's own case`, async () => {
      const result = await run(name);
      expect(happy(result).outcome, `${name}: ${happy(result).outcomeReason}`).toBe('FAIL');
      expect(failed(result).length).toBeGreaterThan(0);
    }, 300_000);
  }
});

describe('where a black-box agent may not go', () => {
  it('is refused on a system marked production', async () => {
    const other = await service.createProject({ name: 'Desk, production', goal: 'Confirm a held booking.' });
    const connected = (await service.connectEnvironment(other.id, desk, 'production')).project;
    expect(connected.safety).toBe('production');
    await expect(service.startTeaching(other.id)).rejects.toThrow(/production/);
  }, 60_000);
});
