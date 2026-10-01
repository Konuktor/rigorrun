/**
 * `rigorrun stripe canary` — one small refund, before the whole suite.
 *
 * The suite's canary case alone: a $1.00 payment asked back in full. It is
 * the cheapest way to see the agent, Stripe and RigorRun meet — the agent is
 * reachable, it can find the order, its refund lands where RigorRun reads —
 * and to see the shape of every verdict that follows: what the agent said,
 * and beneath it what Stripe holds.
 */
import { parseArgs } from 'node:util';
import { caseOutcome, type CaseResult } from '@rigorrun/core';
import { explainCase } from '@rigorrun/report';
import { STRIPE_PACK_ID } from '../conventions.ts';
import { CANARY_CASE_ID } from '../scenarios.ts';
import { UsageError, rows, say, withService } from './common.ts';

export const CANARY_USAGE = `rigorrun stripe canary --project <id> [--agent <name>] - one small refund, first

Runs only the suite's canary case: a $1.00 payment the customer asks back in
full. Prints what the agent said and, beneath it, what Stripe holds. Run the
whole suite afterwards with \`rigorrun gate --project <id>\`.

OPTIONS
      --project <id>    Required. A project made by \`rigorrun stripe init\`.
      --agent <name>    Which agent, by name or id. Default: the last one added.
      --home <path>     Where projects live.
      --json            Print the case's result as JSON.

EXIT CODES
  0  the agent made the refund it was asked for, and nothing else
  1  it did not
  2  the setup is wrong: no such project, agent, or canary case
  3  no verdict: RigorRun could not create the case or read Stripe back`;

export async function cmdCanary(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string' },
      agent: { type: 'string' },
      home: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    say(CANARY_USAGE);
    return 0;
  }
  const projectId = values.project;
  if (!projectId)
    throw new UsageError('Which project? Try `rigorrun stripe canary --project <id>`.');

  return withService(values.home, async (service) => {
    const project = await service.readProject(projectId).catch(() => {
      throw new UsageError(`No project "${projectId}" on this machine. Try \`rigorrun projects\`.`);
    });
    if (project.connector?.kind !== 'pack' || project.connector.pack !== STRIPE_PACK_ID) {
      throw new UsageError(
        `${project.name} is not a Stripe project. Make one with \`rigorrun stripe init\`.`,
      );
    }
    const agent = values.agent
      ? project.agents.find((entry) => entry.id === values.agent || entry.name === values.agent)
      : project.agents[project.agents.length - 1];
    if (!agent) {
      throw new UsageError(
        values.agent
          ? `No agent "${values.agent}" on ${project.name}. \`rigorrun agent list --project ${projectId}\` shows them.`
          : `${project.name} has no agent yet. Add one: rigorrun agent add --project ${projectId} --name my-agent --black-box <url> --claim-path message`,
      );
    }

    const suite = await service.artefact<{ cases: { id: string }[] }>(projectId, 'benchmark');
    if (!suite?.cases.some((testCase) => testCase.id === CANARY_CASE_ID)) {
      throw new UsageError(
        `${project.name}'s suite has no canary case; it was made before there was one. ` +
          'A project made with `rigorrun stripe init` now has it.',
      );
    }

    const run = await service.runAgent(projectId, agent.id, { caseIds: [CANARY_CASE_ID] });
    const result = run.caseResults[0];
    if (!result) throw new Error('The canary run produced no result.');
    if (values.json) {
      say(JSON.stringify(result, null, 2));
    } else {
      printCanary(
        agent.name,
        result,
        run.limits.some((limit) => limit.id === 'simulated'),
      );
      say();
      say(
        caseOutcome(result) === 'PASS'
          ? `Next  rigorrun gate --project ${projectId} --report report.html`
          : 'The lines above say what Stripe holds. Fix the agent, then run the canary again.',
      );
    }
    return exitCodeOf(caseOutcome(result));
  });
}

function printCanary(agentName: string, result: CaseResult, simulated: boolean): void {
  const explained = explainCase(result);
  say(`Canary · ${agentName} · ${explained.outcome}`);
  const lines: [string, string][] = [['agent said', explained.claim.split('\n')[0]!]];
  const reality = explained.reality;
  if (reality && reality.lines.length > 0) {
    reality.lines.forEach((text, index) =>
      lines.push([index === 0 ? `${reality.system} shows` : '', text]),
    );
  }
  if (explained.readScope) lines.push(['read', explained.readScope]);
  explained.saw
    .slice(0, 4)
    .forEach((text, index) => lines.push([index === 0 ? 'RigorRun saw' : '', text]));
  lines.push([
    'how',
    [explained.evidence, simulated ? 'against the local twin, not Stripe itself' : '']
      .filter(Boolean)
      .join(' · '),
  ]);
  for (const line of rows(lines)) say(line);
}

function exitCodeOf(outcome: string): number {
  if (outcome === 'PASS') return 0;
  if (outcome === 'ABSTAIN' || outcome === 'HARNESS_FAILURE') return 3;
  return 1;
}
