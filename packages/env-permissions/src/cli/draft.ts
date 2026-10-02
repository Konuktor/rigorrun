import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { draftMatrix } from '../draft.ts';
import { openSide } from '../connection.ts';
import type {
  MatrixCredential,
  MatrixCredentials,
  MatrixServer,
  PermissionMatrix,
} from '../matrix.ts';

export const DRAFT_USAGE = `rigorrun permissions draft - prepare a permission matrix for review

  rigorrun permissions draft --mcp-command <cmd> [--mcp-arg <arg>]... \\
    --agent-secret <ENV_NAME> --apply-env <name> [--out <file>]
  rigorrun permissions draft --mcp-url <url> \\
    --agent-secret <ENV_NAME> --apply-header <name> [--apply-prefix <prefix>] [--out <file>]

OPTIONS
      --mcp-command <cmd>       Executable for a stdio MCP server.
      --mcp-arg <arg>           One argument for that executable; may be repeated.
      --mcp-url <url>           Streamable HTTP MCP URL.
      --agent-secret <name>     Environment variable holding the agent-side credential.
      --apply-header <name>     HTTP header that receives the credential.
      --apply-prefix <prefix>   Text placed before the credential in that header.
      --apply-env <name>        Child environment variable that receives the credential.
      --out <file>              Output file. Default permissions.json.
      --json                    Print the summary as JSON.`;

export class PermissionsDraftUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionsDraftUsageError';
  }
}

const say = (text = '') => process.stdout.write(`${text}\n`);

function exactlyOne(left: unknown, right: unknown): boolean {
  return (left === undefined) !== (right === undefined);
}

function inputs(values: {
  mcpCommand?: string;
  mcpArg?: string[];
  mcpUrl?: string;
  agentSecret?: string;
  applyHeader?: string;
  applyPrefix?: string;
  applyEnv?: string;
}): { server: MatrixServer; credentials: MatrixCredentials; secretValue: string } {
  if (!exactlyOne(values.mcpCommand, values.mcpUrl)) {
    throw new PermissionsDraftUsageError('Choose exactly one of --mcp-command or --mcp-url.');
  }
  if (!exactlyOne(values.applyHeader, values.applyEnv)) {
    throw new PermissionsDraftUsageError('Choose exactly one of --apply-header or --apply-env.');
  }
  if (!values.agentSecret) {
    throw new PermissionsDraftUsageError('--agent-secret is required.');
  }
  const secretValue = process.env[values.agentSecret];
  if (secretValue === undefined) {
    throw new PermissionsDraftUsageError(
      `Environment variable ${values.agentSecret} is not set.`,
    );
  }

  if (values.mcpCommand !== undefined) {
    if (values.applyEnv === undefined || values.applyHeader !== undefined) {
      throw new PermissionsDraftUsageError('A stdio server requires --apply-env.');
    }
    if (values.applyPrefix !== undefined) {
      throw new PermissionsDraftUsageError('--apply-prefix may only be used with --apply-header.');
    }
    return {
      server: { transport: 'stdio', command: values.mcpCommand, args: values.mcpArg ?? [] },
      credentials: {
        agent: { secret: values.agentSecret, apply: { env: values.applyEnv } },
        observer: { secret: 'TODO', apply: { env: 'TODO' } },
      },
      secretValue,
    };
  }

  if (values.applyHeader === undefined || values.applyEnv !== undefined) {
    throw new PermissionsDraftUsageError('An HTTP server requires --apply-header.');
  }
  if (values.mcpArg !== undefined) {
    throw new PermissionsDraftUsageError('--mcp-arg may only be used with --mcp-command.');
  }
  const agent: MatrixCredential = {
    secret: values.agentSecret,
    apply: {
      header: values.applyHeader,
      ...(values.applyPrefix === undefined ? {} : { prefix: values.applyPrefix }),
    },
  };
  return {
    server: { transport: 'http', url: values.mcpUrl! },
    credentials: {
      agent,
      observer: { secret: 'TODO', apply: { header: 'TODO' } },
    },
    secretValue,
  };
}

function addObserverConfirmation(matrix: PermissionMatrix): PermissionMatrix {
  return {
    ...matrix,
    unconfirmed: [
      'credentials.observer.secret',
      'credentials.observer.apply',
      ...matrix.unconfirmed,
    ],
  };
}

export async function cmdDraft(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'mcp-command': { type: 'string' },
      'mcp-arg': { type: 'string', multiple: true },
      'mcp-url': { type: 'string' },
      'agent-secret': { type: 'string' },
      'apply-header': { type: 'string' },
      'apply-prefix': { type: 'string' },
      'apply-env': { type: 'string' },
      out: { type: 'string', default: 'permissions.json' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    say(DRAFT_USAGE);
    return 0;
  }

  const prepared = inputs({
    ...(values['mcp-command'] === undefined ? {} : { mcpCommand: values['mcp-command'] }),
    ...(values['mcp-arg'] === undefined ? {} : { mcpArg: values['mcp-arg'] }),
    ...(values['mcp-url'] === undefined ? {} : { mcpUrl: values['mcp-url'] }),
    ...(values['agent-secret'] === undefined ? {} : { agentSecret: values['agent-secret'] }),
    ...(values['apply-header'] === undefined ? {} : { applyHeader: values['apply-header'] }),
    ...(values['apply-prefix'] === undefined ? {} : { applyPrefix: values['apply-prefix'] }),
    ...(values['apply-env'] === undefined ? {} : { applyEnv: values['apply-env'] }),
  });
  const shell = draftMatrix([], prepared.server, prepared.credentials);
  const connection = await openSide(shell, 'agent', prepared.secretValue);
  let matrix: PermissionMatrix;
  try {
    matrix = addObserverConfirmation(
      draftMatrix(connection.discovery.tools, prepared.server, prepared.credentials),
    );
  } finally {
    await connection.close();
  }

  await writeFile(values.out, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
  const guessed = {
    reads: matrix.reads.length,
    sinks: matrix.sinks?.length ?? 0,
    forbidden: matrix.forbidden?.length ?? 0,
    reset: matrix.reset?.tool ?? null,
    placeholders: [
      'observer credential',
      'tenant',
      'labels',
      'reference',
      'person',
      'fingerprint fields',
      'outside address',
      'policy',
    ],
  };
  if (values.json) {
    say(
      JSON.stringify({
        file: values.out,
        tools: connection.discovery.tools.map((tool) => tool.name),
        guessed,
        unconfirmed: matrix.unconfirmed,
      }),
    );
    return 0;
  }

  say(`Found ${connection.discovery.tools.length} tool(s):`);
  for (const tool of connection.discovery.tools) say(`  ${tool.name}`);
  say(
    `Guessed: ${guessed.reads} read(s), ${guessed.sinks} sink(s), ` +
      `${guessed.forbidden} forbidden operation(s), reset ${guessed.reset ?? 'not found'}.`,
  );
  say(`Placeholders: ${guessed.placeholders.join(', ')}.`);
  say(`Wrote ${values.out}; edit, then remove each path from \`unconfirmed\`.`);
  return 0;
}
