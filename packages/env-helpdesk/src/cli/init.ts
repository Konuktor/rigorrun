/**
 * `rigorrun helpdesk init`: a project that holds your agent to the Larch
 * Helpdesk suite, run by `rigorrun gate` — the path into CI, where `try` is the
 * path to a first look.
 *
 * Lists the rules and asks about each (`--yes` confirms all); only a confirmed
 * rule can fail an agent. `nothing else changed` is always in force.
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { ProjectStore, Service, storeRoot } from '@rigorrun/daemon';
import { ProxyServer } from '@rigorrun/proxy';
import { HELPDESK_PACK_ID, TWIN_URL } from '../conventions.ts';
import { registerHelpdeskPack } from '../pack.ts';
import { HELPDESK_RULES_IN_FORCE, helpdeskContract } from '../rules.ts';
import { HelpdeskUsageError } from './twin.ts';

export const INIT_USAGE = `rigorrun helpdesk init - a project that gates your agent on the Larch Helpdesk suite

  rigorrun helpdesk init [--twin <url>] [--yes]

Asks you to confirm each rule of the policy (--yes confirms all); only a rule you confirm can fail
your agent. Creates the project and installs the suite. Start the twin first:
rigorrun helpdesk twin.

OPTIONS
      --twin <url>     The twin's MCP URL. Default ${TWIN_URL}.
      --yes            Confirm every rule without asking.
      --name <name>    The project's name.
      --home <path>    Where projects live.
      --json           Print what was made, as JSON.`;

const say = (text = '') => process.stdout.write(`${text}\n`);

export interface InitIo {
  ask(question: string): Promise<string>;
}

const terminalIo: InitIo = {
  async ask(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
};

export async function cmdInit(argv: string[], io: InitIo = terminalIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      twin: { type: 'string' },
      yes: { type: 'boolean', default: false },
      name: { type: 'string' },
      home: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    say(INIT_USAGE);
    return 0;
  }
  if (!values.yes && !process.stdin.isTTY && io === terminalIo) {
    throw new HelpdeskUsageError(
      'There is no terminal to ask in: add --yes to confirm every rule.',
    );
  }
  const baseUrl = values.twin ?? TWIN_URL;
  const human = !values.json;

  const contract = helpdeskContract(new Date().toISOString());
  const inForce = contract.rules.filter((rule) =>
    HELPDESK_RULES_IN_FORCE.includes(rule.id as never),
  );
  const toAsk = contract.rules.filter(
    (rule) => !HELPDESK_RULES_IN_FORCE.includes(rule.id as never),
  );
  if (human) {
    say(`Larch Helpdesk pack · twin at ${baseUrl}`);
    say();
    say('Every ticket is held to');
    for (const rule of inForce) say(`  ${rule.statement}`);
    say();
    say('Rules — only the ones you confirm can fail your agent');
  }
  const confirmedRuleIds: string[] = [];
  for (const rule of toAsk) {
    let yes = values.yes;
    if (!yes) {
      say(`  ${rule.statement}`);
      const answer = (await io.ask('    Confirm? [Y/n] ')).trim().toLowerCase();
      yes = answer === '' || answer === 'y' || answer === 'yes';
    } else if (human) {
      say(`  ✓ ${rule.statement}`);
    }
    if (yes) confirmedRuleIds.push(rule.id);
  }

  registerHelpdeskPack();
  const store = new ProjectStore(storeRoot(values.home));
  const proxy = new ProxyServer();
  await proxy.start();
  const service = new Service({ store, proxy });
  const name = values.name ?? 'Larch Helpdesk (twin)';
  let projectId: string;
  let caseIds: string[];
  try {
    const project = await service.createProject({
      name,
      goal: 'Resolve an Alder Outdoor customer’s ticket without touching another organisation’s data.',
    });
    await service.connectEnvironment(
      project.id,
      { kind: 'pack', pack: HELPDESK_PACK_ID, mode: 'twin', baseUrl },
      'local',
    );
    const installed = await service.installPackSuite(
      project.id,
      { confirmedRuleIds, createdAt: new Date().toISOString() },
      { confirmedRuleIds },
    );
    projectId = project.id;
    caseIds = installed.benchmark.cases.map((testCase) => testCase.id);
  } finally {
    await service.workspace.close();
    await proxy.stop();
  }

  const home = values.home ? ` --home ${values.home}` : '';
  const next = [
    `rigorrun agent add --project ${projectId} --name my-agent --black-box <url> --claim-path message${home}`,
    `rigorrun gate --project ${projectId} --report report.html${home}`,
  ];
  if (values.json) {
    say(
      JSON.stringify({ projectId, name, baseUrl, confirmedRuleIds, cases: caseIds, next }, null, 2),
    );
    return 0;
  }
  say();
  say(`  project  ${projectId}  ${name}`);
  say(
    `  suite    ${caseIds.length} tickets · ${confirmedRuleIds.length} of ${toAsk.length} rules confirmed · ${inForce.length} always checked`,
  );
  say();
  say('Next');
  for (const command of next) say(`  ${command}`);
  return 0;
}
