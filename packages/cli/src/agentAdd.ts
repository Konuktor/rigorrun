/**
 * `rigorrun agent add|list` — the agents on a project, from the command line.
 *
 * `setup` can register agents, but only while it creates the project they
 * belong to. A project a pack set up, or one somebody built in the interface,
 * still needs its agent connected, and on a build server there is no
 * interface to do it in. This is that step on its own.
 *
 * Black-box agents only, for now: the kind that answers on an address and does
 * the work itself, wherever it runs. It goes through the same schema the
 * interface and the API use, the same address check the run uses, and the
 * same `Service.addAgent` — which probes it before calling it connected — so
 * nothing typed here is accepted on terms the other ways in would refuse.
 */
import { readFile } from 'node:fs/promises';
import {
  BlackBoxRequestSchema,
  ProjectStore,
  assertBlackBoxUrl,
  describeAgent,
  storeRoot,
} from '@rigorrun/daemon';
import { CliError, safePath } from './io.ts';
import { c, heading, line, table } from './ui.ts';
import type { Flags } from './commands.ts';
import { withService } from './project.ts';

/** What `agent add` was told, before any of it is checked. */
export interface AgentAddFlags {
  name?: string | undefined;
  blackBox?: string | undefined;
  allowHost: string[];
  bodyTemplate?: string | undefined;
  completion?: string | undefined;
  claimPath?: string | undefined;
  /** `Name=secret_name`. The value is a secret's name, never a credential. */
  header: string[];
  /** Seconds to wait after the agent answers, for work it finishes afterwards. */
  settleSeconds?: number | undefined;
}

export async function cmdAgent(
  action: string | undefined,
  flags: Flags,
  add: AgentAddFlags,
): Promise<number> {
  if (action === 'add') return cmdAgentAdd(flags, add);
  if (action === 'list') return cmdAgentList(flags);
  throw new CliError(
    'Try `rigorrun agent add --project <id> --black-box <url>` or `rigorrun agent list --project <id>`.',
  );
}

async function cmdAgentAdd(flags: Flags, add: AgentAddFlags): Promise<number> {
  const projectId = flags.project;
  if (!projectId)
    throw new CliError('Which project? Try `rigorrun agent add --project <id> --black-box <url>`.');
  if (!add.blackBox) {
    throw new CliError(
      "Say where the agent answers: `--black-box <url>`. It is sent each case's work there and does it itself.",
    );
  }

  const parsed = BlackBoxRequestSchema.safeParse({
    endpoint: add.blackBox,
    allowedHosts: add.allowHost.map((host) => host.trim().toLowerCase()).filter(Boolean),
    headers: headersFrom(add.header),
    bodyTemplate: add.bodyTemplate === undefined ? null : await bodyTemplateFrom(add.bodyTemplate),
    ...(add.completion === undefined ? {} : { completion: add.completion }),
    ...(add.claimPath === undefined ? {} : { claimPath: add.claimPath }),
    ...(add.settleSeconds === undefined
      ? {}
      : { settleQuietMs: Math.round(add.settleSeconds * 1000) }),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ` : '';
    throw new CliError(
      `That black-box agent is incomplete: ${where}${issue?.message ?? 'unknown shape'}`,
    );
  }
  // Refused before anything is stored. The probe would record the same
  // problem on a saved agent; an address RigorRun will never send work to is
  // not something to save at all.
  try {
    assertBlackBoxUrl(parsed.data.endpoint, parsed.data.allowedHosts);
  } catch (error) {
    throw new CliError(
      `${(error as Error).message}${parsed.data.allowedHosts.length === 0 ? ' Name it with --allow-host.' : ''}`,
    );
  }

  // Every header's secret has to exist before the agent is saved. A name that
  // is not set is most often the credential itself, pasted where its name
  // belongs — and saving it would write that credential into the project file.
  const store = new ProjectStore(storeRoot(flags.home));
  for (const [header, secret] of Object.entries(parsed.data.headers)) {
    if ((await store.secret(secret)) === undefined) {
      throw new CliError(
        `The ${header} header comes from a secret that is not set on this machine. --header takes the ` +
          "secret's name, never the credential: set it with `rigorrun secrets set <name>` (in CI, " +
          'RIGORRUN_SECRET__<NAME>), then pass --header Name=<name>.',
      );
    }
  }

  return withService(flags.home, async (service) => {
    await service.readProject(projectId).catch(() => {
      throw new CliError(`No project "${projectId}" on this machine. Try \`rigorrun projects\`.`);
    });
    const { agent } = await service.addAgent(projectId, {
      name: add.name ?? '',
      blackBox: parsed.data,
    });

    if (flags.json) {
      line(JSON.stringify({ agent }, null, 2));
    } else if (!flags.quiet) {
      line(
        `${agent.lastProbeOk ? c.green('answers') : c.red('does not answer')}  ${agent.name}  ${c.grey(describeAgent(agent))}`,
      );
      if (!agent.lastProbeOk) line(c.grey(`  ${agent.lastProbeProblem}`));
    }
    if (!flags.json) line(agent.id);
    // Stored either way, as the interface stores it: the address was
    // acceptable, and the agent may simply not be running yet. A script still
    // has to be able to tell, so an agent that did not answer is not exit 0.
    return agent.lastProbeOk ? 0 : 1;
  });
}

async function cmdAgentList(flags: Flags): Promise<number> {
  const projectId = flags.project;
  if (!projectId) throw new CliError('Which project? Try `rigorrun agent list --project <id>`.');
  return withService(flags.home, async (service) => {
    const project = await service.readProject(projectId).catch(() => {
      throw new CliError(`No project "${projectId}" on this machine. Try \`rigorrun projects\`.`);
    });
    if (flags.json) {
      line(JSON.stringify({ agents: project.agents }, null, 2));
      return 0;
    }
    if (project.agents.length === 0) {
      heading(`No agents on ${project.name}`);
      line(c.grey('Add one with `rigorrun agent add --project <id> --black-box <url>`.'));
      return 0;
    }
    heading(`Agents on ${project.name}`);
    table(
      ['id', 'name', 'kind', 'reached at', 'answering'],
      project.agents.map((agent) => [
        agent.id,
        agent.name,
        agent.kind,
        describeAgent(agent),
        agent.lastProbeOk
          ? 'yes'
          : `no${agent.lastProbeProblem ? ` — ${agent.lastProbeProblem}` : ''}`,
      ]),
    );
    return 0;
  });
}

/** `--header Name=secret_name`, as a header name against a secret's name. */
function headersFrom(entries: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of entries) {
    const at = entry.indexOf('=');
    const header = at > 0 ? entry.slice(0, at).trim() : '';
    const secret = at > 0 ? entry.slice(at + 1).trim() : '';
    if (!header || !secret) {
      throw new CliError(
        `--header takes Name=secret_name, got "${entry}". The value is the name of a secret on this machine ` +
          '(`rigorrun secrets set <name>`), never the credential itself.',
      );
    }
    headers[header] = secret;
  }
  return headers;
}

/**
 * The body template, read and checked now rather than at the first case.
 *
 * Every value goes into the template inside a JSON string, so a usable
 * template is JSON before it is filled; and every placeholder must be one a
 * case can fill. Either mistake would otherwise surface as every case failing.
 */
async function bodyTemplateFrom(path: string): Promise<string> {
  let template: string;
  try {
    template = await readFile(safePath(path), 'utf8');
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`Cannot read the body template ${path}.`);
  }
  try {
    JSON.parse(template);
  } catch (error) {
    throw new CliError(
      `${path} is not JSON: ${(error as Error).message}. Placeholders go inside strings, as "{{task.text}}".`,
    );
  }
  for (const [, placeholder] of template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    if (!/^(caseId|task\.\w+|inputs\.\w+)$/.test(placeholder ?? '')) {
      throw new CliError(
        `${path} uses {{${placeholder}}}, which no case can fill. Use {{caseId}}, {{task.text}}, ` +
          '{{task.instruction}}, {{task.policyBrief}} or {{inputs.<name>}}.',
      );
    }
  }
  return template;
}
