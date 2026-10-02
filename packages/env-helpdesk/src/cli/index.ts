import { cmdTwin, HelpdeskUsageError, TWIN_USAGE } from './twin.ts';

export const HELPDESK_USAGE = `rigorrun helpdesk - permission and scope tests for the Larch Helpdesk twin

  rigorrun helpdesk twin [--port <n>]    run the local MCP twin
  rigorrun helpdesk init                 coming soon
  rigorrun helpdesk try                  coming soon

Run \`rigorrun helpdesk twin --help\` for twin options.`;

export async function helpdeskCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${HELPDESK_USAGE}\n`);
    return command === undefined ? 2 : 0;
  }
  if (command !== 'twin') {
    process.stderr.write(`Unknown command "helpdesk ${command}".\n`);
    process.stderr.write('Run `rigorrun helpdesk --help` for the commands.\n');
    return 2;
  }
  try {
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

export { cmdTwin, TWIN_USAGE };
