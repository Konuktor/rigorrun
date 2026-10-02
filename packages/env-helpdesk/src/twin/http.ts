#!/usr/bin/env node
/** Streamable HTTP entry point and loopback-only test-twin hooks. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { HelpdeskDb, helpdeskDb, helpdeskStateSchema } from './db.ts';
import { createHelpdeskServer } from './server.ts';

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > 4 * 1024 * 1024) throw new Error('body too large');
    chunks.push(bytes);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** The token from `Authorization: Bearer <token>`, parsed without a regular expression. */
export function bearerToken(request: Pick<IncomingMessage, 'headers'>): string | undefined {
  const header = request.headers.authorization ?? '';
  if (header.slice(0, 7).toLowerCase() !== 'bearer ') return undefined;
  const token = header.slice(7).trim();
  return token === '' ? undefined : token;
}

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

export interface TwinResponse {
  status: number;
  body: unknown;
}

/** Pure route logic so the hooks can be checked even where listeners are sandboxed. */
export function handleTwinRequest(
  method: string | undefined,
  path: string,
  body: unknown,
  db: HelpdeskDb = helpdeskDb,
): TwinResponse | undefined {
  if (path === '/_twin/dump' && method === 'GET') {
    return { status: 200, body: db.dump() };
  }
  if (path === '/_twin/reset' && method === 'POST') {
    db.reset();
    return { status: 200, body: { reset: true } };
  }
  if (path === '/_twin/seed' && method === 'POST') {
    const parsed = helpdeskStateSchema.safeParse(body);
    if (!parsed.success) {
      return { status: 400, body: { error: 'invalid seed', issues: parsed.error.issues } };
    }
    db.replace(parsed.data);
    return { status: 200, body: { seeded: true } };
  }
  return undefined;
}

export function createHelpdeskHttpServer(db: HelpdeskDb = helpdeskDb): Server {
  return createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

      if (path === '/health' && request.method === 'GET') {
        json(response, 200, { ok: true, service: 'larch-helpdesk-mcp' });
        return;
      }

      if (path.startsWith('/_twin/') && !isLoopback(request)) {
        json(response, 403, { error: 'loopback only' });
        return;
      }
      if (path.startsWith('/_twin/')) {
        const twin = handleTwinRequest(request.method, path, await readBody(request), db);
        if (twin) {
          json(response, twin.status, twin.body);
          return;
        }
      }

      if (path !== '/mcp') {
        response.writeHead(404).end();
        return;
      }

      const principal = db.principalFor(bearerToken(request));
      const server = createHelpdeskServer(principal, db);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as never);
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport as never);
      await transport.handleRequest(request, response, await readBody(request));
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      if (!response.writableEnded) {
        response.end(
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        );
      }
    });
  });
}

export interface RunningTwin {
  /** The streamable HTTP MCP endpoint. */
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface TwinOptions {
  host?: '127.0.0.1';
  /** Zero asks the operating system for a free port. */
  port?: number;
}

/** Starts an isolated helpdesk twin on loopback. */
export async function startTwin(options: TwinOptions = {}): Promise<RunningTwin> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 8932;
  const http = createHelpdeskHttpServer(new HelpdeskDb());

  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    http.once('error', failed);
    http.listen(requestedPort, host, () => {
      http.off('error', failed);
      resolve();
    });
  });

  const address = http.address();
  if (typeof address !== 'object' || address === null) {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    throw new Error('The Larch Helpdesk twin did not report its listening port.');
  }
  const port = address.port;
  return {
    url: `http://${host}:${port}/mcp`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env['PORT'] ?? 8932);
  const twin = await startTwin({ port });
  console.log(`larch-helpdesk-mcp listening on ${twin.url}`);
}
