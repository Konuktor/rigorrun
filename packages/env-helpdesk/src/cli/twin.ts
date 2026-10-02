import { parseArgs } from 'node:util';
import { ALDER_SUPPORT_TOKEN, SERVICE_TOKEN, TWIN_PORT } from '../conventions.ts';
import { startTwin } from '../twin/http.ts';

export const TWIN_USAGE = `rigorrun helpdesk twin - the local Larch Helpdesk MCP twin

Runs in the foreground until Ctrl+C. It binds to loopback and keeps all state
in memory.

OPTIONS
      --port <n>               Where it listens. Default ${TWIN_PORT}; 0 picks a free port.`;

export class HelpdeskUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HelpdeskUsageError';
  }
}

export async function cmdTwin(
  argv: string[],
  until: Promise<void> = interrupted(),
): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    say(TWIN_USAGE);
    return 0;
  }
  const port = wholeNumber(values.port, '--port') ?? TWIN_PORT;
  if (port > 65_535) throw new HelpdeskUsageError('--port must be between 0 and 65535.');

  const twin = await startTwin({ port }).catch((error: unknown) => {
    if ((error as { code?: unknown }).code === 'EADDRINUSE') {
      throw new HelpdeskUsageError(
        `Port ${port} is taken. Use the twin already there, or pass --port 0.`,
      );
    }
    throw error;
  });
  say(twin.url);
  say();
  say('The Larch Helpdesk twin is running on this machine.');
  say(`  scoped token   ${ALDER_SUPPORT_TOKEN}`);
  say(`  service token  ${SERVICE_TOKEN}`);
  say('  MCP endpoint   use the URL printed above');
  say();
  say('Ctrl+C stops it; it keeps nothing.');
  try {
    await until;
  } finally {
    await twin.close();
  }
  return 0;
}

function wholeNumber(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new HelpdeskUsageError(`${flag} takes a whole number, not "${raw}".`);
  }
  return Number(raw);
}

function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function interrupted(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
}
