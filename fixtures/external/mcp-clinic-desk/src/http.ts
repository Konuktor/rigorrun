#!/usr/bin/env node
import { createServer, type IncomingMessage } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ClinicDb } from './db.ts';
import { handleFixtureRoute } from './hooks.ts';
import { createClinicServer } from './server.ts';

const port = Number(process.env['PORT'] ?? 8932);
const db = new ClinicDb();

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

const http = createServer((request, response) => {
  void (async () => {
    try {
      if (request.url?.startsWith('/fixture/')) {
        const body = request.method === 'POST' ? await readBody(request) : undefined;
        const fixture = handleFixtureRoute(
          db,
          request.method,
          request.url,
          request.socket.remoteAddress,
          body,
        );
        response.writeHead(fixture?.status ?? 404, { 'content-type': 'application/json' });
        response.end(JSON.stringify(fixture?.body ?? { error: 'not found' }));
        return;
      }

      if (request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, service: 'clinic-desk-mcp' }));
        return;
      }
      if (!request.url?.startsWith('/mcp')) {
        response.writeHead(404).end();
        return;
      }

      const header = request.headers['x-api-key'];
      const key = Array.isArray(header) ? header[0] : header;
      const server = createClinicServer(db.authenticate(key), db);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, await readBody(request));
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      if (!response.writableEnded)
        response.end(JSON.stringify({ error: (error as Error).message }));
    }
  })();
});

http.listen(port, '127.0.0.1', () => {
  console.log(`clinic-desk-mcp listening on http://127.0.0.1:${port}/mcp`);
});
