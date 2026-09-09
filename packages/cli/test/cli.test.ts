import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main.ts';

const originalCwd = process.cwd();
let workDir: string;

/** Runs the CLI in-process and captures everything it printed. */
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
    const code = await main(args);
    return { code, out, err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'rigorrun-cli-'));
  process.chdir(workDir);
});

afterAll(async () => {
  process.chdir(originalCwd);
  await rm(workDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('help and version', () => {
  it('starts the runner when called with no command', async () => {
    // The bare command is not a help page. Everything a person wants to do
    // first happens in the interface, and the interface only exists while the
    // runner is running, so `rigorrun` starts it. `--once` prints the URL and
    // stops, which is the only part a test can assert without hanging.
    const { code, out } = await cli('--once', '--home', join(workDir, 'home'));
    expect(code).toBe(0);
    expect(out).toMatch(/http:\/\/127\.0\.0\.1:\d+\/\?code=[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
    expect(out).toContain('stay there');
  }, 30_000);

  it('exits 0 for --help, and leads with the product rather than the example', async () => {
    const { code, out } = await cli('--help');
    expect(code).toBe(0);
    expect(out).toContain('PROJECTS');
    expect(out).toContain('EXIT CODES');
    // The bundled example is still documented, and is no longer the headline.
    expect(out.indexOf('PROJECTS')).toBeLessThan(out.indexOf('THE BUNDLED EXAMPLE'));
  });

  it('documents per-command options', async () => {
    const { out } = await cli('gate', '--help');
    expect(out).toContain('--max-policy-violations');
    expect(out).toContain('Exits 0 when every threshold is met');
  });

  it('prints the version', async () => {
    const { code, out } = await cli('--version');
    expect(code).toBe(0);
    // A prerelease tag is part of the version, and `--version` is what somebody
    // pastes into a bug report — so it has to be the whole thing.
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/);
  });

  it('rejects an unknown command with exit 2', async () => {
    const { code, err } = await cli('teleport');
    expect(code).toBe(2);
    expect(err).toContain('Unknown command');
  });
});

describe('the full pipeline through the CLI', () => {
  it('runs the demo and writes every artefact', async () => {
    const { code, out } = await cli('demo', '--quiet');
    expect(code).toBe(0);
    expect(out).toContain('Head to head');
    expect(out).toContain('Time from "start recording"');

    for (const file of ['trace.json', 'contract.json', 'benchmark.json', 'report.html']) {
      await expect(readFile(join(workDir, '.rigorrun', file), 'utf8')).resolves.toBeTruthy();
    }
  }, 30_000);

  it('compiles a trace and reports what it could not know', async () => {
    const { code, out } = await cli('compile', '.rigorrun/trace.json', '-o', 'contract.json');
    expect(code).toBe(0);
    expect(out).toContain('Observed');
    expect(out).toContain('inferred');
    // Every proposed rule arrives with the question a person has to answer.
    expect(out).toMatch(/\?/);
  });

  it('generates a benchmark from that contract', async () => {
    const { code, out } = await cli('generate', 'contract.json', '-o', 'benchmark.json');
    expect(code).toBe(0);
    expect(out).toContain('prompt_injection');
    const benchmark = JSON.parse(await readFile(join(workDir, 'benchmark.json'), 'utf8'));
    expect(benchmark.cases.length).toBeGreaterThanOrEqual(10);
  });

  it('compares agents head to head', async () => {
    const { out } = await cli('compare', 'benchmark.json', '--quiet');
    expect(out).toContain('Agent A (naive)');
    expect(out).toContain('Agent B (careful)');
    expect(out).toContain('Wilson intervals');
  }, 30_000);
});

describe('gate exit codes are the CI contract', () => {
  it('exits 1 for the agent that violates policy', async () => {
    const { code, out } = await cli('gate', 'benchmark.json', '--agent', 'naive', '--quiet');
    expect(code).toBe(1);
    expect(out).toContain('FAIL');
    expect(out).toContain('unsafe action(s) > allowed 0');
  }, 30_000);

  it('exits 0 for an implementation that follows the policy', async () => {
    // `reference` replays the plan the expectation engine derived, so this is
    // really a check that the benchmark is satisfiable: a suite no correct
    // actor can pass is a broken suite, and it would fail here.
    const { code, out } = await cli(
      'gate',
      'benchmark.json',
      '--agent',
      'reference',
      '--allow-reference',
      '--quiet',
    );
    expect(code).toBe(0);
    expect(out).toContain('PASS');
  }, 30_000);

  it('refuses to gate on the reference implementation unless asked by name', async () => {
    // A gate that cannot fail is not a gate. The oracle is handed the answer,
    // so gating a build on it was a guaranteed pass dressed as a check.
    const { code, err } = await cli('gate', 'benchmark.json', '--agent', 'reference', '--quiet');
    expect(code).toBe(2);
    expect(err).toContain('handed the answer');
  }, 30_000);

  it('honours a lowered bar', async () => {
    const { code } = await cli(
      'gate',
      'benchmark.json',
      '--agent',
      'naive',
      '--quiet',
      '--min-success',
      '0.1',
      '--min-policy',
      '0.1',
      '--max-policy-violations',
      '100',
      '--max-unsafe',
      '100',
    );
    expect(code).toBe(0);
  }, 30_000);

  it('needs exactly one agent', async () => {
    const { code, err } = await cli(
      'gate',
      'benchmark.json',
      '--agent',
      'naive',
      '--agent',
      'careful',
    );
    expect(code).toBe(2);
    expect(err).toContain('exactly one');
  });
});

describe('checking privacy', () => {
  it('says what a recording captured and what would leave the machine', async () => {
    const { code, out } = await cli('privacy', 'inspect', '.rigorrun/trace.json');
    expect(code).toBe(0);
    expect(out).toContain('Captured');
    expect(out).toContain('Leaves this machine');
    expect(out).toContain('nothing');
    expect(out).toContain('Stays local');
  });

  it('refuses a file that is not a recording', async () => {
    await writeFile(join(workDir, 'notatrace.json'), '{"hello":"world"}');
    const { code, err } = await cli('privacy', 'inspect', 'notatrace.json');
    expect(code).toBe(2);
    expect(err).toContain('not a RigorRun trace');
  });
});

describe('reports', () => {
  it('renders a full report and a sanitised one', async () => {
    await cli('run', 'benchmark.json', '--agent', 'naive', '--quiet');
    const runs = JSON.parse(await readFile(join(workDir, 'benchmark.json'), 'utf8'));
    expect(runs).toBeTruthy();

    const { out } = await cli('demo', '--quiet');
    const runId = /runs\/(run_[a-z0-9]+)\.json/.exec(out)?.[1];
    expect(runId).toBeDefined();

    const full = await cli('report', runId!, '-o', 'full.html');
    expect(full.code).toBe(0);
    const fullHtml = await readFile(join(workDir, 'full.html'), 'utf8');
    expect(fullHtml).toMatch(/\b[A-Z]{2,6}-\d{3,}\b/);

    const published = await cli('report', runId!, '-o', 'pub.html', '--published');
    expect(published.code).toBe(0);
    const pubHtml = await readFile(join(workDir, 'pub.html'), 'utf8');
    expect(pubHtml).not.toContain('ORD-3016');
    expect(pubHtml).toContain('Sanitised for publication');
  }, 60_000);
});

describe('argument and input validation', () => {
  it('refuses a path outside the working directory', async () => {
    const { code, err } = await cli('run', '../escape.json', '--agent', 'careful');
    expect(code).toBe(2);
    expect(err).toContain('outside the working directory');
  });

  it('reports a missing file as a configuration error', async () => {
    const { code, err } = await cli('run', 'nope.json', '--agent', 'careful');
    expect(code).toBe(2);
    expect(err).toContain('Cannot read');
  });

  it('rejects malformed JSON', async () => {
    await writeFile(join(workDir, 'broken.json'), '{ not json');
    const { code, err } = await cli('run', 'broken.json', '--agent', 'careful');
    expect(code).toBe(2);
    expect(err).toContain('not valid JSON');
  });

  it('rejects a JSON file that is not a benchmark', async () => {
    await writeFile(join(workDir, 'wrong.json'), JSON.stringify({ hello: 'world' }));
    const { code, err } = await cli('run', 'wrong.json', '--agent', 'careful');
    expect(code).toBe(2);
    expect(err).toContain('not a valid benchmark');
  });

  it('catches a percentage passed where a rate is expected', async () => {
    const { code, err } = await cli(
      'gate',
      'benchmark.json',
      '--agent',
      'careful',
      '--min-success',
      '95',
    );
    expect(code).toBe(2);
    expect(err).toContain('use 0.95, not 95');
  });

  it('names the available agents when given an unknown one', async () => {
    const { code, err } = await cli('gate', 'benchmark.json', '--agent', 'ghost');
    expect(code).toBe(2);
    expect(err).toContain('careful');
  });
});

describe('doctor and agents', () => {
  it('checks this machine, and says there is nothing to check yet', async () => {
    // `doctor` used to report which model providers were configured, which
    // nobody was asking. It now answers the question people actually have:
    // can this machine do the things RigorRun needs, and is my project's
    // system reachable from here. With no projects, the honest answer is that
    // there is nothing to look at.
    //
    // `--home` matters: a diagnostics command must never read the real store
    // during a test run.
    const { code, out } = await cli('doctor', '--home', join(workDir, 'doctor-home'));
    expect(code).toBe(0);
    expect(out).toContain('This machine');
    expect(out).toContain('loopback port');
    expect(out).toContain('No projects yet');
  }, 30_000);

  it('lists both demo agents as machine-readable JSON', async () => {
    const { code, out } = await cli('agents', '--json');
    expect(code).toBe(0);
    const agents = JSON.parse(out);
    expect(agents.map((a: { id: string }) => a.id)).toEqual(['naive', 'careful']);
  });
});
