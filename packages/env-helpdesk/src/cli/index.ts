import { cmdInit, INIT_USAGE } from './init.ts';
import { cmdTry, TRY_USAGE } from './try.ts';
import { cmdTwin, HelpdeskUsageError, TWIN_USAGE } from './twin.ts';

export const HELPDESK_USAGE = `rigorrun helpdesk - permission and scope tests for the Larch Helpdesk twin

  rigorrun helpdesk try                  the suite now, on two built-in agents, no keys
  rigorrun helpdesk try --agent <url>    the suite on your own agent
  rigorrun helpdesk twin [--port <n>]    run the local MCP twin
  rigorrun helpdesk init [--yes]         a project that gates your agent on the suite, for CI

Add --help to a command for its options.`;

export async function helpdeskCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${HELPDESK_USAGE}\n`);
    return command === undefined ? 2 : 0;
  }
  if (command !== 'twin' && command !== 'try' && command !== 'init') {
    process.stderr.write(`Unknown command "helpdesk ${command}".\n`);
    process.stderr.write('Run `rigorrun helpdesk --help` for the commands.\n');
    return 2;
  }
  try {
    if (command === 'try') return await cmdTry(rest);
    if (command === 'init') return await cmdInit(rest);
    return await cmdTwin(rest);
  } catch (error) {
    if (
      error instanceof HelpdeskUsageError ||
      (error as { code?: unknown }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
    ) {
      process.stderr.write(`${(error as Error).message}\n`);
      return 2;
    }
    throw error;
  }
}

export { cmdInit, cmdTry, cmdTwin, INIT_USAGE, TRY_USAGE, TWIN_USAGE };
