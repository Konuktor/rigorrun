/**
 * A loopback HTTP server that hands out one MCP endpoint per case.
 *
 * Bound to 127.0.0.1 and nothing else. A proxy session is a live channel into a
 * running benchmark — it can call the customer's real system — so it must not
 * be reachable from anywhere except the machine that started it. That is
 * enforced three ways rather than one, because each covers a different mistake:
 *
 *  - the socket only listens on loopback, so nothing off-box can connect;
 *  - the `Host` header is checked, because a page on this machine can be made
 *    to resolve an attacker's domain to 127.0.0.1 and talk to us as though it
 *    were local, which is what DNS rebinding is;
 *  - a session id is an unguessable secret, so a page that gets past both still
 *    has to know which case it wants.
 *
 * Sessions are removed the moment the case ends. An endpoint that outlives its
 * case would be a way to touch a customer's system with nobody watching.
 */
import { randomBytes } from 'node:crypto';
import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MAX_BODY_BYTES = 4 * 1024 * 1024;

interface Session {
  server: Server;
  transport: WebStandardStreamableHTTPServerTransport;
}

export interface ProxyServerOptions {
  /** 0 asks the operating system for a free port, which is the sane default. */
  port?: number;
}

export class ProxyServer {
  private readonly sessions = new Map<string, Session>();
  private http: ServerType | undefined;
  private boundPort = 0;

  async start(options: ProxyServerOptions = {}): Promise<number> {
    if (this.http) return this.boundPort;

    const app = new Hono();

    // Every route is behind this. See the note above on DNS rebinding: a
    // hostile page can point a domain it owns at 127.0.0.1, but it cannot
    // choose the Host header the browser sends.
    app.use('*', async (context, next) => {
      if (!hostIsLocal(context.req.header('host'))) return context.text('forbidden host', 403);
      const declared = Number(context.req.header('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return context.text('body too large', 413);
      }
      await next();
      return undefined;
    });

    app.get('/health', (context) =>
      context.json({ ok: true, service: 'rigorrun-proxy', sessions: this.sessions.size }),
    );

    app.all('/mcp/:sessionId', async (context) => {
      const sessionId = context.req.param('sessionId');
      const session = /^[0-9a-f]{32}$/.test(sessionId) ? this.sessions.get(sessionId) : undefined;
      // The same answer whether the id was malformed, expired or never
      // existed, so probing cannot tell a live session from a dead one.
      if (!session) return context.json({ error: 'not found' }, 404);
      return session.transport.handleRequest(context.req.raw);
    });

    this.http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: options.port ?? 0 });
    await new Promise<void>((resolve) => this.http!.once('listening', () => resolve()));

    const address = this.http.address();
    this.boundPort = typeof address === 'object' && address ? address.port : 0;
    return this.boundPort;
  }

  get port(): number {
    return this.boundPort;
  }

  /**
   * Publishes a session and returns the URL an agent should be pointed at.
   *
   * The id carries 128 bits of randomness because it is the only thing between
   * another process on this machine and a live channel into somebody's system.
   */
  async publish(server: Server): Promise<{ sessionId: string; url: string }> {
    const sessionId = randomBytes(16).toString('hex');
    // MCP's session identity is made to *be* ours rather than sit alongside it.
    //
    // The alternative is stateless mode, which the SDK requires a fresh
    // transport per request for — and closing one safely means waiting for an
    // SSE body to finish streaming, which is a second lifetime to get wrong on
    // top of the case's. Handing the transport our own id gives exactly one
    // thing to end: revoking the session ends the case's channel and the MCP
    // session in the same move.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });
    await server.connect(transport as unknown as Parameters<Server['connect']>[0]);
    this.sessions.set(sessionId, { server, transport });
    return { sessionId, url: `http://127.0.0.1:${this.boundPort}/mcp/${sessionId}` };
  }

  /** Ends a session. The endpoint stops existing immediately. */
  async revoke(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
  }

  async stop(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) await this.revoke(sessionId);
    const http = this.http;
    this.http = undefined;
    if (!http) return;
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
}

/**
 * Whether the `Host` header names this machine.
 *
 * The defence against DNS rebinding: a hostile page cannot control what it
 * sends here, so a request arriving with somebody else's domain in `Host` is
 * not a request a local tool made.
 */
function hostIsLocal(host: string | undefined): boolean {
  if (!host) return false;
  const withoutPort = host.replace(/:\d+$/, '');
  return ALLOWED_HOSTS.has(withoutPort.toLowerCase());
}
