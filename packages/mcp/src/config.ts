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

/**
 * Hosts a remote connector may point at.
 *
 * Unlike an agent endpoint, an MCP environment is frequently on a private
 * network on purpose — a staging box, a service in a cluster. So this cannot
 * simply refuse private ranges the way `assertSafeAgentUrl` does. What it can
 * do is refuse the shapes that are never legitimate and are how SSRF is
 * actually done: a non-HTTP scheme, credentials smuggled into the URL, and the
 * cloud metadata addresses, which no customer's MCP server is ever hosted on
 * and which are the single highest-value target on a machine running CI.
 */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  'fd00:ec2::254',
]);

export function assertSafeMcpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`MCP server URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`MCP server URL must be http or https, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error(
      'MCP server URL must not embed credentials. Put them in headers, which stay in the runner.',
    );
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(host)) {
    throw new Error(`Refusing to connect to the cloud metadata address ${host}.`);
  }
  return url;
}

/**
 * Rejects a stdio configuration that did not come from a person.
 *
 * Cheap, and it is the check that would have to fail for a malicious benchmark
 * to run a command. Shell metacharacters in the *command* are the tell: a real
 * executable path does not contain them, and their presence means somebody is
 * trying to make one string become two.
 */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r]/;

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
