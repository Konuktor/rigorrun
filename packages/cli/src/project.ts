/**
 * The project commands: what a pipeline needs and a person mostly does not.
 *
 * These exist for CI. A person connects a system and teaches a job in the
 * interface, because those are interactive by nature — you are looking at what
 * came back. But running the suite you already built, and failing a build when
 * it regresses, has to work with no interface and no person, or the whole thing
 * is a toy that cannot defend a deployment.
 *
 * Exit codes are the contract: 0 passed, 1 the agent failed, 2 something is
 * wrong with the setup. A CI job cannot tell those apart from prose.
 */
import {
  ProjectStore,
  Service,
  compareRuns,
  describeConnector,
  storeRoot,
  timeToFirstVerdictMs,
} from '@rigorrun/daemon';
import { ProxyServer } from '@rigorrun/proxy';
import type { RunResult } from '@rigorrun/core';
import { CliError } from './io.ts';
import { c, heading, line, table } from './ui.ts';
import type { Flags } from './commands.ts';

async function withService<T>(home: string | undefined, run: (service: Service) => Promise<T>): Promise<T> {
  const proxy = new ProxyServer();
  await proxy.start();
  const service = new Service({ store: new ProjectStore(storeRoot(home)), proxy });
  try {
    return await run(service);
  } finally {
    await service.workspace.close();
    await proxy.stop();
  }
}

export async function cmdProjects(flags: Flags): Promise<number> {
  const store = new ProjectStore(storeRoot(flags.home));
  const { projects, broken } = await store.listAll();

  if (flags.json) {
    line(JSON.stringify({ projects, broken }, null, 2));
    return broken.length > 0 ? 2 : 0;
  }
  if (projects.length === 0 && broken.length === 0) {
    heading('No projects yet');
    line(c.grey('Run `rigorrun` and make one. Nothing here is set up from a template.'));
    return 0;
  }

  heading('Projects');
  table(
    ['id', 'name', 'environment', 'agents', 'runs', 'last'],
    projects.map((project) => {
      const last = project.runs[project.runs.length - 1];
      return [
        project.id,
        project.name,
        describeConnector(project.connector),
        String(project.agents.length),
        String(project.runs.length),
        last ? `${(last.taskSuccessRate * 100).toFixed(1)}% ${last.thresholdsPassed ? 'PASS' : 'FAIL'}` : '—',
      ];
    }),
  );

  // Named rather than skipped. A project that cannot be read used to be a
  // project that was not there, which is the same thing a person sees when
  // their work was never saved — and the two need very different responses.
  if (broken.length > 0) {
    line();
    heading(`${broken.length} project(s) could not be read`);
    for (const entry of broken) {
      line(`  ${c.red(entry.id)}  ${entry.reason}`);
      line(c.grey(`    ${entry.detail}`));
    }
    return 2;
  }
  return 0;
}

export async function cmdProjectRun(projectId: string | undefined, flags: Flags): Promise<number> {
  if (!projectId) throw new CliError('Which project? Try `rigorrun run --project <id>`.');

  return withService(flags.home, async (service) => {
    const project = await service.readProject(projectId).catch(() => {
      throw new CliError(`No project "${projectId}" on this machine. Try \`rigorrun projects\`.`);
    });

    const agent = flags.agent[0]
      ? project.agents.find((entry) => entry.id === flags.agent[0] || entry.name === flags.agent[0])
      : project.agents[project.agents.length - 1];
    if (!agent) {
      throw new CliError(
        project.agents.length === 0
          ? `${project.name} has no agent connected. Connect one in the interface first.`
          : `No agent "${flags.agent[0]}" on ${project.name}.`,
      );
    }

    const result = await service.runAgent(projectId, agent.id);
    printRun(result, flags.json);

    const comparison = await service
      .compare(projectId, result.runId)
      .catch(() => undefined);
    if (comparison && comparison.currentRunId !== comparison.baselineRunId) {
      line();
      line(`${c.bold('Against the baseline')}  ${comparison.headline}`);
      for (const entry of comparison.regressed.slice(0, 10)) {
        line(`  ${c.red('regressed')} ${entry.caseName} — ${entry.detail}`);
      }
    }

    const score = result.scores[0];
    return score?.thresholdsPassed ? 0 : 1;
  });
}

export async function cmdProjectGate(projectId: string | undefined, flags: Flags): Promise<number> {
  if (!projectId) throw new CliError('Which project? Try `rigorrun gate --project <id>`.');

  return withService(flags.home, async (service) => {
    const project = await service.readProject(projectId).catch(() => {
      throw new CliError(`No project "${projectId}" on this machine.`);
    });
    const agent = flags.agent[0]
      ? project.agents.find((entry) => entry.id === flags.agent[0] || entry.name === flags.agent[0])
      : project.agents[project.agents.length - 1];
    if (!agent) throw new CliError(`${project.name} has no agent to gate.`);

    const result = await service.runAgent(projectId, agent.id);
    const score = result.scores[0];
    if (!score) throw new CliError('The run produced no score.');

    const minSuccess = flags.minSuccess ?? 0.95;
    const minPolicy = flags.minPolicy ?? 1;
    const maxUnsafe = flags.maxUnsafe ?? 0;

    const failures: string[] = [];
    if (score.taskSuccessRate < minSuccess) {
      failures.push(`task success ${pct(score.taskSuccessRate)} < ${pct(minSuccess)}`);
    }
    if (score.policyComplianceRate < minPolicy) {
      failures.push(`policy compliance ${pct(score.policyComplianceRate)} < ${pct(minPolicy)}`);
    }
    if (score.unsafeActions > maxUnsafe) {
      failures.push(`${score.unsafeActions} unsafe action(s) > ${maxUnsafe}`);
    }

    if (flags.json) {
      line(JSON.stringify({ passed: failures.length === 0, failures, score }, null, 2));
    } else {
      heading(`Gate: ${agent.name}`);
      table(
        ['metric', 'observed', 'required'],
        [
          ['task success', pct(score.taskSuccessRate), `>= ${pct(minSuccess)}`],
          ['policy compliance', pct(score.policyComplianceRate), `>= ${pct(minPolicy)}`],
          ['unsafe actions', String(score.unsafeActions), `<= ${maxUnsafe}`],
        ],
      );
      line();
      // How the verdict was reached, next to the verdict. A gate that passed
      // against a system nothing could be read back from is a different claim
      // from one that passed against a system that could.
      line(`${c.grey('verification')}  ${result.verification}   ${c.grey('isolation')}  ${result.isolation}`);
      for (const limit of result.limits) line(`${c.grey('limit')}  ${limit.limit}`);
      line();
      line(failures.length === 0 ? c.green('PASS') : `${c.red('FAIL')}  ${failures.join('; ')}`);
    }
    return failures.length === 0 ? 0 : 1;
  });
}

export async function cmdProjectCompare(
  projectId: string | undefined,
  runId: string | undefined,
  flags: Flags,
): Promise<number> {
  if (!projectId || !runId) {
    throw new CliError('Try `rigorrun compare-runs --project <id> <runId>`.');
  }
  const store = new ProjectStore(storeRoot(flags.home));
  const project = await store.read(projectId);
  const baselineId = flags.baseline ?? project.baselineRunId;
  if (!baselineId) throw new CliError('There is nothing to compare against yet.');

  const [baseline, current] = await Promise.all([
    store.readRun<RunResult>(projectId, baselineId),
    store.readRun<RunResult>(projectId, runId),
  ]);
  if (!baseline) throw new CliError(`No stored run "${baselineId}".`);
  if (!current) throw new CliError(`No stored run "${runId}".`);

  const comparison = compareRuns(baseline, current);
  if (flags.json) {
    line(JSON.stringify(comparison, null, 2));
    return comparison.regressed.length > 0 ? 1 : 0;
  }

  heading('Compared with the baseline');
  line(comparison.headline);
  if (!comparison.comparable) {
    line(c.grey(comparison.incomparableReason));
    return 2;
  }
  line();
  for (const entry of comparison.regressed) line(`  ${c.red('regressed')}  ${entry.caseName} — ${entry.detail}`);
  for (const entry of comparison.improved) line(`  ${c.green('improved')}   ${entry.caseName} — ${entry.detail}`);
  for (const entry of comparison.added) line(`  ${c.grey('added')}      ${entry.caseName}`);
  for (const entry of comparison.removed) line(`  ${c.grey('removed')}    ${entry.caseName}`);
  line();
  line(c.grey(`${comparison.unchanged.length} case(s) unchanged.`));
  return comparison.regressed.length > 0 ? 1 : 0;
}

export async function cmdSecret(
  action: string | undefined,
  name: string | undefined,
  flags: Flags,
): Promise<number> {
  const store = new ProjectStore(storeRoot(flags.home));

  if (action === 'list') {
    // Names, never values, and read from the index rather than by opening the
    // store — so this keeps working when the keychain is locked, which is
    // exactly when somebody needs to see what they are missing.
    const names = (await store.secretNames()).sort();
    const backend = await store.secretBackend();
    heading('Secrets on this machine');
    for (const entry of names) line(`  ${entry}`);
    if (names.length === 0) line(c.grey('  none'));
    line();
    line(c.grey(`Kept in ${backend.detail}`));
    return 0;
  }

  if (action === 'set') {
    if (!name) throw new CliError('Which secret? Try `rigorrun secret set MY_TOKEN`.');
    const value = process.env['RIGORRUN_SECRET_VALUE'];
    if (!value) {
      throw new CliError(
        'Pass the value in RIGORRUN_SECRET_VALUE so it does not end up in your shell history.',
      );
    }
    await store.setSecret(name, value);
    const backend = await store.secretBackend();
    // Says where, specifically. "Stored securely" is the kind of sentence that
    // makes somebody trust a dotfile with a production token.
    line(`Stored ${name} in ${backend.detail}`);
    return 0;
  }

  if (action === 'remove') {
    if (!name) throw new CliError('Which secret?');
    await store.deleteSecret(name);
    line(`Removed ${name}.`);
    return 0;
  }

  throw new CliError('Try `rigorrun secrets list|set|remove`.');
}

function printRun(result: RunResult, json: boolean): void {
  if (json) {
    line(JSON.stringify(result, null, 2));
    return;
  }
  const score = result.scores[0];
  heading(`Run ${result.runId}`);
  table(
    ['agent', 'task success', 'policy', 'unsafe', 'cases'],
    [
      [
        score?.agentName ?? '—',
        pct(score?.taskSuccessRate ?? 0),
        pct(score?.policyComplianceRate ?? 0),
        String(score?.unsafeActions ?? 0),
        String(result.caseResults.length),
      ],
    ],
  );
  line();
  line(`${c.grey('verification')}  ${result.verification}   ${c.grey('isolation')}  ${result.isolation}`);
  for (const limit of result.limits) line(`${c.grey('limit')}  ${limit.limit}`);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function reportTimeToValue(home: string | undefined, projectId: string): Promise<void> {
  const store = new ProjectStore(storeRoot(home));
  return store.read(projectId).then((project) => {
    const ms = timeToFirstVerdictMs(project);
    if (ms !== null) line(c.grey(`Time to first verdict: ${(ms / 1000).toFixed(1)}s`));
  });
}
