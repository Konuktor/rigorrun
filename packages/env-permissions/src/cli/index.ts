import { cmdDraft, DRAFT_USAGE, PermissionsDraftUsageError } from './draft.ts';
import { cmdInit, INIT_USAGE, PermissionsInitUsageError } from './init.ts';

export const PERMISSIONS_USAGE = `rigorrun permissions - permission tests on your own MCP server (v0)

  rigorrun permissions draft --mcp-url <url> --agent-secret <ENV> --apply-header <name>
                                          list the server's tools, write a matrix to edit and confirm
  rigorrun permissions init --matrix permissions.json [--yes]
                                          a project that gates your agent on the confirmed matrix

Add --help to a command for its options.`;

export async function permissionsCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${PERMISSIONS_USAGE}\n`);
    return command === undefined ? 2 : 0;
  }
  if (command !== 'draft' && command !== 'init') {
    process.stderr.write(`Unknown command "permissions ${command}".\n`);
    process.stderr.write('Run `rigorrun permissions --help` for the commands.\n');
    return 2;
  }
  try {
    return command === 'draft' ? await cmdDraft(rest) : await cmdInit(rest);
  } catch (error) {
    if (
      error instanceof PermissionsDraftUsageError ||
      error instanceof PermissionsInitUsageError ||
      (error as { code?: unknown }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
    ) {
      process.stderr.write(`${(error as Error).message}\n`);
      return 2;
    }
    throw error;
  }
}

export { DRAFT_USAGE, INIT_USAGE };
