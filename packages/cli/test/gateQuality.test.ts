import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashValue, type Benchmark, type EnvironmentContract } from '@rigorrun/core';
import type { BenchmarkQuality } from '@rigorrun/quality';
import { ProjectStore, Service, type Project, type SuiteSource } from '@rigorrun/daemon';
import { ProxyServer } from '@rigorrun/proxy';
import { main } from '../src/main.ts';

let home: string;
let store: ProjectStore;
let service: Service;
let proxy: ProxyServer;
let server: Server;
let project: Project;
let benchmark: Benchmark;
let contract: EnvironmentContract;
let source: SuiteSource;
let requests = 0;
let duringRequest: (() => Promise<void>) | undefined;

function passingQuality(): BenchmarkQuality {
  return {
    benchmarkId: benchmark.id,
    cases: benchmark.cases.length,
    measures: [
      {
        id: 'false_positive_rate',
        label: 'FP',
        meaning: '',
        value: 0,
        kind: 'rate',
        discriminating: true,
      },
      {
        id: 'false_accusation',
        label: 'Harmless failures',
        meaning: '',
        value: 0,
        kind: 'rate',
        discriminating: true,
      },
      {
        id: 'mutant_kill_rate',
        label: 'Defects',
        meaning: '',
        value: 1,
        kind: 'rate',
        discriminating: true,
      },
      {
        id: 'replay_stability',
        label: 'Replay',
        meaning: '',
        value: true,
        kind: 'flag',
        discriminating: true,
      },
      {
        id: 'hidden_answer_isolation',
        label: 'Isolation',
        meaning: '',
        value: true,
        kind: 'flag',
        discriminating: true,
      },
    ],
    mutants: [
      {
        id: 'independent',
        defect: 'Wrong amount',
        independence: 'environment_derived',
        expectation: 'must_be_caught',
        caught: true,
        asExpected: true,
        caughtOn: 1,
      },
      {
        id: 'control',
        defect: 'Extra read',
        independence: 'environment_derived',
        expectation: 'must_survive',
        caught: false,
        asExpected: true,
        caughtOn: 0,
      },
    ],
    mutantKillRate: 1,
    independentKillRate: 1,
    replayStable: true,
    hiddenAnswerIsolated: true,
    deadRules: [],
    nonDiscriminatingRules: [],
    wallClockMs: 1,
  };
}

async function saveQuality(quality: BenchmarkQuality): Promise<void> {
  await store.writeArtefact(project.id, 'quality', quality);
  // The storage boundary under test: a recorded assessment must bind both
  // its own complete payload and the suite it assessed.
  const saved = await store.readArtefact(project.id, 'quality');
  await store.writeArtefact(project.id, 'quality-source', {
    suite: source,
    qualityDigest: await hashValue(saved),
  });
}

async function gate(...extra: string[]) {
  let out = '';
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  try {
    return {
      code: await main(['gate', '--project', project.id, '--home', home, '--json', ...extra]),
      out,
    };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-gate-quality-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
  project = await service.createProject({ name: 'Generated gate' });
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  await service.connectEnvironment(
    project.id,
    {
      kind: 'mcp',
      transport: 'stdio',
      command: join(root, 'node_modules/.bin/tsx'),
      args: [join(root, 'fixtures/external/mcp-venue-desk/src/stdio.ts')],
      url: '',
      secretNames: [],
    },
    'ephemeral',
  );
  await service.configureEnvironment(project.id, {
    readOnlyTools: ['list_venues', 'list_organisers', 'find_bookings', 'get_booking'],
    verifierReads: [
      { tool: 'find_bookings' },
      { tool: 'list_venues' },
      { tool: 'list_organisers' },
    ],
    reset: { kind: 'tool', tool: 'reset_desk' },
  });
  await service.startTeaching(project.id);
  await service.teachStep(project.id, 'record_signoff', {
    bookingId: 'BKG-4001',
    approver: 'Dana Whitlock',
  });
  await service.teachStep(project.id, 'confirm_booking', { bookingId: 'BKG-4001' });
  await service.finishTeaching(project.id);
  const draft = await service.compile(project.id);
  contract = await service.review(project.id, {
    confirmedRuleIds: draft.rules.map((rule) => rule.id),
  });
  benchmark = await service.generate(project.id);
  source = (await service.readCurrentSuite(project.id)).source;
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      void (async () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (JSON.parse(body || '{}').probe) return res.end('{"ok":true}');
        requests += 1;
        await duringRequest?.();
        res.end('{"status":"completed","output":"No changes made"}');
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP address');
  await service.addAgent(project.id, {
    name: 'Candidate',
    blackBox: { endpoint: `http://127.0.0.1:${address.port}` },
  });
  project = await store.read(project.id);
}, 60_000);

beforeEach(async () => {
  requests = 0;
  duringRequest = undefined;
  await store.write(project);
  await store.writeArtefact(project.id, 'contract', contract);
  await store.writeArtefact(project.id, 'benchmark', benchmark);
  await store.writeArtefact(project.id, 'suite-source', source);
  await store.deleteArtefact(project.id, 'quality');
  await store.deleteArtefact(project.id, 'quality-source');
});
afterAll(async () => {
  await service.workspace.close();
  await proxy.stop();
  await new Promise((resolve) => server.close(resolve));
  await rm(home, { recursive: true, force: true });
});

it('missing assessment refuses before candidate contact and explains explicit test writes', async () => {
  const result = await gate();
  expect(result.code).toBe(3);
  expect(requests).toBe(0);
  expect(result.out).toMatch(/assess|quality/i);
  expect(result.out).toMatch(/write|consent/i);
});

it.each([
  [
    'false-positive rate',
    (q: BenchmarkQuality) => {
      q.measures[0]!.value = 0.1;
    },
  ],
  [
    'failed must_survive control',
    (q: BenchmarkQuality) => {
      q.mutants[1]!.caught = true;
      q.mutants[1]!.asExpected = false;
    },
  ],
  [
    'false accusation metric',
    (q: BenchmarkQuality) => {
      q.measures[1]!.value = 1;
    },
  ],
  [
    'unstable replay',
    (q: BenchmarkQuality) => {
      q.replayStable = false;
    },
  ],
  [
    'leaked hidden answers',
    (q: BenchmarkQuality) => {
      q.hiddenAnswerIsolated = false;
    },
  ],
  [
    'dead rule',
    (q: BenchmarkQuality) => {
      q.deadRules = ['unused'];
    },
  ],
  [
    'mutant kill rate below one',
    (q: BenchmarkQuality) => {
      q.mutantKillRate = 0.9;
    },
  ],
  [
    'independent kill rate below one',
    (q: BenchmarkQuality) => {
      q.independentKillRate = 0;
    },
  ],
  [
    'missing required metric',
    (q: BenchmarkQuality) => {
      q.measures.shift();
    },
  ],
  [
    'NaN required metric',
    (q: BenchmarkQuality) => {
      q.measures[0]!.value = Number.NaN;
    },
  ],
  [
    'NaN kill rate',
    (q: BenchmarkQuality) => {
      q.mutantKillRate = Number.NaN;
    },
  ],
  [
    'empty defect controls',
    (q: BenchmarkQuality) => {
      q.mutants = [];
    },
  ],
  [
    'no independent defects',
    (q: BenchmarkQuality) => {
      q.mutants = q.mutants.filter((m) => m.expectation === 'must_survive');
    },
  ],
  [
    'missing harmless controls',
    (q: BenchmarkQuality) => {
      q.mutants = q.mutants.filter((m) => m.expectation === 'must_be_caught');
    },
  ],
  [
    'incorrect case count',
    (q: BenchmarkQuality) => {
      q.cases = 0;
    },
  ],
  [
    'wrong benchmark id',
    (q: BenchmarkQuality) => {
      q.benchmarkId = 'another-suite';
    },
  ],
] as const)('%s refuses with exit 3 before candidate contact', async (_name, change) => {
  const quality = passingQuality();
  change(quality);
  await saveQuality(quality);
  const result = await gate();
  expect(result.code).toBe(3);
  expect(requests).toBe(0);
  expect(JSON.parse(result.out).failures.length).toBeGreaterThan(0);
});

it.each(['quality-source', 'suite-source'] as const)(
  'missing %s refuses legacy trust',
  async (artifact) => {
    await saveQuality(passingQuality());
    await store.deleteArtefact(project.id, artifact);
    expect((await gate()).code).toBe(3);
    expect(requests).toBe(0);
  },
);

it('assessment payload tampering refuses even when its metrics look adequate', async () => {
  await saveQuality(passingQuality());
  await store.writeArtefact(project.id, 'quality', { ...passingQuality(), wallClockMs: 123 });
  expect((await gate()).code).toBe(3);
  expect(requests).toBe(0);
});

it('suite append makes the previous assessment stale', async () => {
  await saveQuality(passingQuality());
  await service.addFailureToSuite(project.id, {
    name: 'Incident',
    reason: 'Missed work',
    request: { bookingId: 'BKG-4001' },
  });
  expect((await gate()).code).toBe(3);
  expect(requests).toBe(0);
});

it('an empty published suite refuses before candidate contact', async () => {
  const empty = { ...benchmark, cases: [] };
  const emptySource = { ...source, benchmarkDigest: await hashValue(empty) };
  await store.writeArtefact(project.id, 'benchmark', empty);
  await store.writeArtefact(project.id, 'suite-source', emptySource);
  await saveQuality(passingQuality());
  expect((await gate()).code).toBe(3);
  expect(requests).toBe(0);
});

it('valid current assessment proceeds to normal candidate scoring', async () => {
  await saveQuality(passingQuality());
  const result = await gate();
  expect(requests).toBe(benchmark.cases.length);
  expect(result.code).toBe(1); // The candidate deliberately does no work.
  expect(JSON.parse(result.out).score.n).toBe(benchmark.cases.length);
});

it('a suite changed during candidate execution cannot produce a current release verdict', async () => {
  await saveQuality(passingQuality());
  duringRequest = async () => {
    if (requests === 1)
      await service.review(project.id, { rejectedRuleIds: [contract.rules[0]!.id] });
  };
  const result = await gate();
  expect(result.code).toBe(3);
  expect(JSON.parse(result.out).failures.join(' ')).toMatch(/changed|stale/i);
  expect((await store.read(project.id)).runs).toHaveLength(0);
});

it('invalid agent selection remains exit 2', async () => {
  expect((await gate('--agent', 'missing')).code).toBe(2);
  expect(requests).toBe(0);
});

it('a freshly published changed benchmark cannot reuse an older assessment with the same id', async () => {
  await saveQuality(passingQuality());
  const changed = { ...benchmark, description: 'A new publication with the same id' };
  await store.writeArtefact(project.id, 'benchmark', changed);
  await store.writeArtefact(project.id, 'suite-source', {
    ...source,
    benchmarkDigest: await hashValue(changed),
  });
  expect((await gate()).code).toBe(3);
  expect(requests).toBe(0);
});

it('loss of quality provenance during candidate execution refuses the final release verdict', async () => {
  await saveQuality(passingQuality());
  duringRequest = async () => {
    await store.deleteArtefact(project.id, 'quality-source');
  };
  expect((await gate()).code).toBe(3);
  expect(requests).toBe(benchmark.cases.length);
});

it('diagnostic runs do not attach an assessment without current quality provenance', async () => {
  await store.writeArtefact(project.id, 'quality', passingQuality());
  const result = await service.runAgent(project.id, project.agents[0]!.id);
  expect(result.suiteQuality?.assessed).toBe(false);
  expect(result.suiteQuality?.warnings.join(' ')).toMatch(/not been quality-checked/);
});

it('diagnostic runs do not attach incomplete assessment metrics as current quality', async () => {
  const incomplete = passingQuality();
  incomplete.measures = [];
  await saveQuality(incomplete);
  const result = await service.runAgent(project.id, project.agents[0]!.id);
  expect(result.suiteQuality?.assessed).toBe(false);
});

it('assessment warnings refuse before candidate contact', async () => {
  await saveQuality({
    ...passingQuality(),
    warnings: ['An unresolved assessment warning'],
  } as BenchmarkQuality);
  expect((await gate()).code).toBe(3);
  expect(requests).toBe(0);
});

it.each(['id', 'cases'] as const)(
  'diagnostic runs reject assessments with the wrong benchmark %s',
  async (field) => {
    const invalid = passingQuality();
    if (field === 'id') invalid.benchmarkId = 'not-this-suite';
    else invalid.cases = benchmark.cases.length + 1;
    await saveQuality(invalid);
    const result = await service.runAgent(project.id, project.agents[0]!.id);
    expect(result.suiteQuality?.assessed).toBe(false);
  },
);
