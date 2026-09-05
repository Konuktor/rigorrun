import { assertSafeSystemUrl } from '@rigorrun/connector';

/** The old name. Same function; the guard was never MCP-specific. */
export const assertSafeMcpUrl = assertSafeSystemUrl;

const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r]/;

/**
 * How an operator says where their MCP server is — and the guard rails on it.
 *
 * Two of the three security-relevant decisions in this product live in this
 * file. The first is that a stdio connector spawns a process, so the shape of
 * `McpStdioConfig` has to make command injection awkward rather than merely
 * discouraged: a command and an argument *array*, never a string to be handed
 * to a shell. The second is that a remote connector is a URL RigorRun will
 * fetch, so it has to be checked before it is used.
 *
 * The rule these enforce together, stated once: **a configuration may only ever
 * come from the person running RigorRun.** Never from a benchmark file, never
 * from an imported trace, never from something a connected server said. A
 * downloaded benchmark that could name a command would be a remote code
 * execution vector wearing a test suite's clothes.
 */

export interface McpStdioConfig {
  transport: 'stdio';
  /** The executable. Spawned directly — never through a shell. */
  command: string;
  /** Arguments, already separated. A single string here would be a bug. */
  args: string[];
  /** Extra environment for the child. Merged over a safe default set. */
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpConfig {
  transport: 'http';
  url: string;
  /** Sent on every request. Held in the runner's secret store, never synced. */
  headers?: Record<string, string>;
}

export type McpConfig = McpStdioConfig | McpHttpConfig;

export function assertSafeCommand(config: McpStdioConfig): void {
  if (config.command.trim().length === 0) {
    throw new Error('A local MCP server needs a command to run.');
  }
  if (SHELL_METACHARACTERS.test(config.command)) {
    throw new Error(
      `Refusing to run a command containing shell metacharacters: ${config.command}. ` +
        'Give the executable and its arguments separately.',
    );
  }
  if (!Array.isArray(config.args)) {
    throw new Error('Arguments must be a list, so nothing is ever handed to a shell as one string.');
  }
}

/** A one-line description for a connector, safe to show and safe to log. */
export function describeConfig(config: McpConfig): string {
  return config.transport === 'stdio'
    ? `${config.command} ${config.args.join(' ')}`.trim()
    : config.url;
}
