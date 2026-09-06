/**
 * Signing in to an MCP server that requires it.
 *
 * A real authorization server stands up for the length of this file — metadata
 * documents, dynamic registration, an authorize endpoint that redirects, and a
 * token endpoint that checks PKCE. Not a mock: a mock of an OAuth server proves
 * that the mock agrees with the code, which is the one thing never in doubt.
 *
 * The assertions worth reading are the ones about what RigorRun does with what
 * comes back — tokens into the credential store rather than the project, a
 * loopback redirect that refuses a code carrying the wrong state, and no token
 * anywhere near a URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as proxyRequest, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { McpConnection } from '../src/index.ts';
import { LocalOAuthProvider, type TokenStore } from '../src/oauth.ts';

/** A store that keeps things in memory, standing in for the real one. */
function memoryStore(): TokenStore & { seen: Map<string, string> } {
  const seen = new Map<string, string>();
  return {
    seen,
    get: async (name) => seen.get(name),
    set: async (name, value) => void seen.set(name, value),
    remove: async (name) => void seen.delete(name),
  };
}

let authServer: Server;
let issuer = '';
/** Every request the authorization server received, for the assertions below. */
const requests: { method: string; path: string; query: URLSearchParams }[] = [];
const codes = new Map<string, { challenge: string; redirect: string }>();
/** What the client registered, so the test can assert on the redirect URI. */
let registered: Record<string, unknown> = {};

beforeAll(async () => {
  authServer = createServer((request, response) => {
    const url = new URL(request.url ?? '/', issuer || 'http://127.0.0.1');
    requests.push({
      method: request.method ?? '',
      path: url.pathname,
      query: url.searchParams,
    });
    const json = (body: unknown): void => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

    if (url.pathname === '/.well-known/oauth-authorization-server') {
      json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
      return;
    }

    if (url.pathname === '/register') {
      // A registration response echoes back what was registered, which is how
      // the redirect URI RigorRun asked for becomes the one the server holds.
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        registered = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        json({
          ...registered,
          client_id: 'client-abc',
          client_id_issued_at: Math.floor(Date.now() / 1000),
        });
      });
      return;
    }

    if (url.pathname === '/authorize') {
      // What a person's browser would be sent to. Approve immediately and
      // bounce back, which is the only part of this a test can skip honestly.
      const asked = url.searchParams.get('redirect_uri') ?? '';
      const allowed = (registered['redirect_uris'] as string[] | undefined) ?? [];
      if (!allowed.includes(asked)) {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end('unregistered redirect_uri');
        return;
      }
      const code = randomBytes(8).toString('hex');
      codes.set(code, {
        challenge: url.searchParams.get('code_challenge') ?? '',
        redirect: url.searchParams.get('redirect_uri') ?? '',
      });
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.toString() });
      response.end();
      return;
    }

    if (url.pathname === '/token' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = new URLSearchParams(Buffer.concat(chunks).toString());
        const record = codes.get(body.get('code') ?? '');
        const verifier = body.get('code_verifier') ?? '';
        const computed = createHash('sha256').update(verifier).digest('base64url');
        if (!record || record.challenge !== computed) {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        json({
          access_token: 'an-access-token',
          refresh_token: 'a-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      });
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => authServer.listen(0, '127.0.0.1', resolve));
  const address = authServer.address();
  issuer = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => authServer.close(() => resolve()));
});

describe('the half of OAuth that belongs to the client', () => {
  it('signs in through a browser and keeps the tokens with the credentials', async () => {
    const store = memoryStore();
    const opened: string[] = [];
    const provider = new LocalOAuthProvider({
      serverKey: 'desk',
      store,
      open: async (url) => {
        opened.push(url);
        // What a browser does: follow it, and follow the redirect back.
        await fetch(url, { redirect: 'follow' });
      },
    });

    await provider.start();
    const waiting = provider.waitForCode();
    // The SDK owns discovery, PKCE and exchange; this drives the same calls it
    // would, so the assertions are about RigorRun's half.
    const { startAuthorization, exchangeAuthorization, registerClient, discoverAuthorizationServerMetadata } =
      await import('@modelcontextprotocol/sdk/client/auth.js');

    const metadata = await discoverAuthorizationServerMetadata(issuer);
    if (!metadata) throw new Error('The authorization server published no metadata.');
    expect(metadata.code_challenge_methods_supported).toContain('S256');

    const client = await registerClient(issuer, {
      metadata,
      clientMetadata: provider.clientMetadata,
    });
    await provider.saveClientInformation(client);

    const { authorizationUrl, codeVerifier } = await startAuthorization(issuer, {
      metadata,
      clientInformation: client,
      redirectUrl: provider.redirectUrl,
      state: provider.state(),
    });
    await provider.saveCodeVerifier(codeVerifier);

    // PKCE, and the method the server said it supports.
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy();

    await provider.redirectToAuthorization(authorizationUrl);
    const code = await waiting;
    await provider.close();

    expect(opened).toHaveLength(1);
    const tokens = await exchangeAuthorization(issuer, {
      metadata,
      clientInformation: client,
      authorizationCode: code,
      codeVerifier: await provider.codeVerifier(),
      redirectUri: provider.redirectUrl,
    });
    await provider.saveTokens(tokens);

    // Where they went. Not into a project file, which is what makes a project
    // safe to copy or attach to a support request.
    // The redirect the server holds is a loopback address on this machine.
    // Nobody else's server is ever handed a code for your system.
    expect((registered['redirect_uris'] as string[])[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    expect([...store.seen.keys()]).toContain('oauth:desk:tokens');
    expect(store.seen.get('oauth:desk:tokens')).toContain('an-access-token');
    expect(await provider.tokens()).toMatchObject({ access_token: 'an-access-token' });
  }, 60_000);

  it('never puts a token in a URL', () => {
    // The specification is explicit, and it is the kind of thing that ends up
    // in a proxy log, a browser history and a screenshot.
    for (const request of requests) {
      expect(request.query.get('access_token')).toBeNull();
      expect(request.query.get('token')).toBeNull();
    }
    expect(requests.some((request) => request.path === '/token' && request.method === 'POST')).toBe(
      true,
    );
  });

  it('refuses a code that carries the wrong state', async () => {
    const provider = new LocalOAuthProvider({ serverKey: 'desk', store: memoryStore() });
    await provider.start();
    let settled = 'still waiting';
    const waiting = provider.waitForCode().then(
      () => void (settled = 'accepted'),
      () => void (settled = 'refused'),
    );
    provider.state();

    // A code arriving with a state RigorRun did not issue is a code somebody
    // else started the flow for.
    const answer = await fetch(`${provider.redirectUrl}?code=stolen&state=not-ours`);
    expect(answer.status).toBe(404);

    // And the sign-in is still waiting rather than having accepted it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(settled).toBe('still waiting');
    await provider.close();
    await waiting;
  }, 30_000);

  it('says so when the authorization server refuses', async () => {
    const provider = new LocalOAuthProvider({ serverKey: 'desk', store: memoryStore() });
    await provider.start();
    // The assertion is attached before the refusal arrives, so nothing is
    // momentarily an unhandled rejection.
    const waiting = expect(provider.waitForCode()).rejects.toThrow(/access_denied/);
    await fetch(`${provider.redirectUrl}?error=access_denied`);
    await waiting;
    await provider.close();
  }, 30_000);

  it('keeps one machine’s several servers apart', async () => {
    const store = memoryStore();
    await new LocalOAuthProvider({ serverKey: 'desk', store }).saveTokens({
      access_token: 'desk-token',
      token_type: 'Bearer',
    });
    await new LocalOAuthProvider({ serverKey: 'billing', store }).saveTokens({
      access_token: 'billing-token',
      token_type: 'Bearer',
    });

    expect(await new LocalOAuthProvider({ serverKey: 'desk', store }).tokens()).toMatchObject({
      access_token: 'desk-token',
    });
    expect(await new LocalOAuthProvider({ serverKey: 'billing', store }).tokens()).toMatchObject({
      access_token: 'billing-token',
    });
  });
});

/**
 * The whole thing, against a real MCP server that demands a token.
 *
 * The desk fixture runs in its own process as it does everywhere else, with a
 * gateway in front that refuses anything without a bearer token and answers a
 * 401 the way an OAuth 2.1 resource server has to — a `WWW-Authenticate` that
 * names where its protected-resource metadata lives.
 *
 * Nothing here is stubbed on RigorRun's side: the SDK discovers, registers,
 * redirects, and exchanges; RigorRun supplies the listener the browser comes
 * back to, keeps the tokens, and connects. What is asserted at the end is that
 * a tool call works — because the point of signing in is not the sign-in.
 */
describe('connecting to an MCP server that requires signing in', () => {
  const DESK_PORT = 8935;
  const gatewayPortHolder = { url: '' };
  let desk: ChildProcess;
  let gateway: Server;
  let resourceServer: Server;

  beforeAll(async () => {
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    desk = spawn(join(repoRoot, 'node_modules', '.bin', 'tsx'), [
      join(repoRoot, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'http.ts'),
    ], { env: { ...process.env, PORT: String(DESK_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the fixture never said it was listening')), 30_000);
      desk.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      desk.on('error', reject);
    });

    // The protected-resource metadata document, which is what a 401 points at
    // and how a client learns which authorization server to go to.
    resourceServer = createServer((incoming, response) => {
      if (incoming.url?.startsWith('/.well-known/oauth-protected-resource')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ resource: gatewayPortHolder.url, authorization_servers: [issuer] }),
        );
        return;
      }
      response.writeHead(404).end();
    });

    gateway = createServer((incoming, response) => {
      if (incoming.url?.startsWith('/.well-known/')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ resource: gatewayPortHolder.url, authorization_servers: [issuer] }),
        );
        return;
      }
      if (incoming.headers.authorization !== 'Bearer an-access-token') {
        // What makes this an OAuth resource server rather than a locked door.
        response.writeHead(401, {
          'www-authenticate': `Bearer realm="desk", resource_metadata="${gatewayPortHolder.url}/.well-known/oauth-protected-resource"`,
        });
        response.end();
        return;
      }
      // Piped rather than buffered: a streamable-HTTP response is a stream,
      // and buffering it here would make this a test about the gateway.
      const upstream = proxyRequest(
        {
          host: '127.0.0.1',
          port: DESK_PORT,
          path: incoming.url,
          method: incoming.method,
          headers: { ...incoming.headers, host: `127.0.0.1:${DESK_PORT}` },
        },
        (answer) => {
          response.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(response);
        },
      );
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      incoming.pipe(upstream);
    });

    await new Promise<void>((resolve) => resourceServer.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    const address = gateway.address();
    gatewayPortHolder.url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  }, 60_000);

  afterAll(async () => {
    desk?.kill('SIGTERM');
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await new Promise<void>((resolve) => resourceServer.close(() => resolve()));
  });

  it('refuses to pretend, when there is no way to sign in', async () => {
    // Without a provider the server is simply shut, and the message says so
    // rather than blaming the network. This also proves the gateway below is
    // genuinely demanding a token.
    await expect(
      McpConnection.open({ transport: 'http', url: `${gatewayPortHolder.url}/mcp` }),
    ).rejects.toThrow(/Could not reach/);
  }, 30_000);

  it('is refused, signs in, and comes back able to work', async () => {
    const store = memoryStore();
    let opened = 0;
    const provider = new LocalOAuthProvider({
      serverKey: 'protected-desk',
      store,
      // Standing in for a browser: follow where it was sent, and follow the
      // redirect back to the loopback listener.
      open: async (url) => {
        opened += 1;
        await fetch(url, { redirect: 'follow' });
      },
    });

    const connection = await McpConnection.open({
      transport: 'http',
      url: `${gatewayPortHolder.url}/mcp`,
      auth: provider,
    });
    try {
      expect(connection.discovery.serverName).toBe('venue-desk');
      // A sign-in that leaves you unable to call anything is not a sign-in.
      const answer = await connection.call('list_venues', {});
      expect(answer.ok).toBe(true);
    } finally {
      await connection.close();
    }

    // Somebody was actually sent to approve this, once.
    expect(opened).toBe(1);
    // Kept with the credentials, under this server's own name.
    expect(store.seen.has('oauth:protected-desk:tokens')).toBe(true);
    // And the listener is gone: it exists for the length of one sign-in.
    expect(provider.redirectUrl).not.toBe('');
    await expect(fetch(provider.redirectUrl).then(() => 'answered')).rejects.toThrow();
  }, 60_000);

  it('uses the token it already has, without sending anybody to a browser', async () => {
    const store = memoryStore();
    await store.set(
      'oauth:protected-desk:tokens',
      JSON.stringify({ access_token: 'an-access-token', token_type: 'Bearer' }),
    );
    let opened = 0;
    const provider = new LocalOAuthProvider({
      serverKey: 'protected-desk',
      store,
      open: async () => void (opened += 1),
    });

    const connection = await McpConnection.open({
      transport: 'http',
      url: `${gatewayPortHolder.url}/mcp`,
      auth: provider,
    });
    try {
      expect(connection.discovery.serverName).toBe('venue-desk');
    } finally {
      await connection.close();
    }
    // Signing in once is the whole point of keeping the token.
    expect(opened).toBe(0);
  }, 60_000);
});
