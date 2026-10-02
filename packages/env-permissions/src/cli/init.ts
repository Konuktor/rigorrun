/**
 * `rigorrun permissions init`: a project that holds your agent to a permission
 * suite compiled from your confirmed matrix, run by `rigorrun gate`.
 *
 * Refuses a matrix with unconfirmed paths. Lists the four rules and asks about
 * each (`--yes` confirms all); only a confirmed rule can fail an agent. Opens
 * the server once, with the credentials the matrix names, to list the tools a
 * proxied agent will be offered.
 */
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { ProjectStore, Service, storeRoot } from '@rigorrun/daemon';
import { ProxyServer } from '@rigorrun/proxy';
import { assertConfirmed, parseMatrix } from '../matrix.ts';
import { permissionsPack, registerPermissionsPack } from '../pack.ts';
import { PERMISSIONS_PACK_ID, permissionsContract } from '../rules.ts';
import { toolDescription } from '../session.ts';
import { specFromMatrix } from '../spec.ts';

export const INIT_USAGE = `rigorrun permissions init - a project that gates your agent on your permission matrix

  rigorrun permissions init --matrix permissions.json [--yes]

The matrix must be confirmed (its "unconfirmed" list empty). The credentials it names are read from
this machine's store or the environment. Asks you to confirm each rule (--yes confirms all); only a
rule you confirm can fail your agent.

OPTIONS
      --matrix <file>  The confirmed permission matrix. Default permissions.json.
      --yes            Confirm every rule without asking.
      --name <name>    The project's name.
      --home <path>    Where projects live.
      --json           Print what was made, as JSON.`;

export class PermissionsInitUsageError extends Error {}

const say = (text = '') => process.stdout.write(`${text}\n`);

export async function cmdInit(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      matrix: { type: 'string', default: 'permissions.json' },
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
  const matrix = parseMatrix(JSON.parse(await readFile(values.matrix!, 'utf8')) as unknown);
  assertConfirmed(matrix);
  if (!values.yes && !process.stdin.isTTY) {
    throw new PermissionsInitUsageError(
      'There is no terminal to ask in: add --yes to confirm every rule.',
    );
  }
  const human = !values.json;
  const spec = specFromMatrix(matrix);
  const rules = permissionsContract(spec, new Date().toISOString()).rules;
  if (human) {
    say(`Permissions · acting for ${spec.tenant.a}, tested against ${spec.tenant.b}`);
    say();
    say('Rules — only the ones you confirm can fail your agent');
  }
  const confirmedRuleIds: string[] = [];
  for (const rule of rules) {
    let yes = values.yes;
    if (!yes) {
      say(`  ${rule.statement}`);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = (await rl.question('    Confirm? [Y/n] ')).trim().toLowerCase();
        yes = answer === '' || answer === 'y' || answer === 'yes';
      } finally {
        rl.close();
      }
    } else if (human) {
      say(`  ✓ ${rule.statement}`);
    }
    if (yes) confirmedRuleIds.push(rule.id);
  }

  // The tools a proxied agent is offered: the server's, as the agent's side sees them.
  registerPermissionsPack();
  const session = await permissionsPack.open({
    mode: 'live',
    options: { matrix },
    secret: (name) => process.env[name],
  });
  const tools = session.actions().map(toolDescription);
  await session.close();

  const store = new ProjectStore(storeRoot(values.home));
  const proxy = new ProxyServer();
  await proxy.start();
  const service = new Service({ store, proxy });
  const name = values.name ?? `Permissions (${spec.tenant.a})`;
  let projectId: string;
  let caseIds: string[];
  try {
    const project = await service.createProject({
      name,
      goal: `Serve requests for ${spec.tenant.a} without touching another ${spec.tenant.label}'s data.`,
    });
    await service.connectEnvironment(
      project.id,
      { kind: 'pack', pack: PERMISSIONS_PACK_ID, mode: 'live', options: { matrix } },
      'staging',
    );
    const createdAt = new Date().toISOString();
    const installed = await service.installPackSuite(
      project.id,
      { matrix, confirmedRuleIds, createdAt, tools },
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
      JSON.stringify(
        { projectId, name, confirmedRuleIds, cases: caseIds, tools: tools.length, next },
        null,
        2,
      ),
    );
    return 0;
  }
  say();
  say(`  project  ${projectId}  ${name}`);
  say(
    `  suite    ${caseIds.length} requests · ${confirmedRuleIds.length} of ${rules.length} rules confirmed · ${tools.length} tools offered to a proxied agent`,
  );
  say();
  say('Next');
  for (const command of next) say(`  ${command}`);
  return 0;
}
