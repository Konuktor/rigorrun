#!/usr/bin/env node
/**
 * The desk over streamable HTTP — what a remote connector is pointed at.
 *
 * The same `createDeskServer()` as the stdio entry point, on a different
 * transport. That is deliberate: if the two entry points built different
 * servers, "RigorRun works over HTTP" would be a claim about a second fixture
 * rather than about the transport.
 *
 * Stateless, one transport per request. A fixture has no reason to keep session
 * state alive between calls, and stateless removes the one thing about this
 * file that could go subtly wrong and be blamed on RigorRun.
 *
 * Loopback only, because this exists to be connected to from the machine
 * running the test and there is no version of "expose the fixture to the
 * network" that is a good idea.
 *
 *   PORT=8931 tsx src/http.ts
 */
import { createServer, type IncomingMessage } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createDeskServer } from './server.ts';

const port = Number(process.env['PORT'] ?? 8931);

/** Reads the body itself: the SDK wants it parsed, and this has no framework. */
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // A fixture that can be made to eat memory is a flaky test waiting to
    // happen, so it refuses rather than buffers.
    if (size > 4 * 1024 * 1024) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const http = createServer((request, response) => {
  void (async () => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, service: 'venue-desk-mcp' }));
      return;
    }
    if (!request.url?.startsWith('/mcp')) {
      response.writeHead(404).end();
      return;
    }

    const server = createDeskServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, await readBody(request));
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      if (!response.writableEnded) {
        response.end(JSON.stringify({ error: (error as Error).message }));
      }
    }
  })();
});

http.listen(port, '127.0.0.1', () => {
  // The line the test waits for. Matches the shape the stdio entry point has.
  console.log(`venue-desk-mcp listening on http://127.0.0.1:${port}/mcp`);
});
