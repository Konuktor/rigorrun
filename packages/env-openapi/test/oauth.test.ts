/**
 * Signing in to an API that wants a client id and a secret.
 *
 * A real token endpoint runs for the length of this file, checking the
 * credentials, counting exchanges and expiring what it issues. What is worth
 * asserting is not that a token is fetched — it is what happens around that:
 * one exchange for many calls, a second when the API says the token is no
 * longer good, and no credential anywhere near a URL or an error message.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ClientCredentials, OpenApiConnection, clientCredentialsFlow, loadDocument } from '../src/index.ts';

const SPEC = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Allotment registry', version: '2.1.0' },
  paths: {
    '/plots': {
      get: {
        operationId: 'listPlots',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { plots: { type: 'array', items: { type: 'object' } } },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      registry: {
        type: 'oauth2',
        flows: {
          clientCredentials: {
            tokenUrl: 'https://example.invalid/oauth/token',
            scopes: { 'plots:read': 'Read plots' },
          },
        },
      },
    },
  },
});

let api: Server;
let baseUrl = '';
let tokenUrl = '';
/** Every exchange, so "one token for many calls" is a count and not a hope. */
let exchanges = 0;
/** Bodies the token endpoint received, to prove where the credentials went. */
const tokenBodies: string[] = [];
let issued = 'token-one';
let acceptOnly = 'token-one';
const seenAuthorization: string[] = [];

beforeAll(async () => {
  api = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/oauth/token' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        tokenBodies.push(Buffer.concat(chunks).toString());
        const credentials = Buffer.from(
          (request.headers.authorization ?? '').replace(/^Basic\s+/i, ''),
          'base64',
        ).toString();
        if (credentials !== 'a-client:a-secret') {
          response.writeHead(401, { 'content-type': 'application/json' });
          // A hostile-shaped answer: it echoes what it was sent. RigorRun must
          // not put this in front of anybody.
          response.end(JSON.stringify({ error: 'invalid_client', sent: credentials }));
          return;
        }
        exchanges += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ access_token: issued, token_type: 'Bearer', expires_in: 3600 }));
      });
      return;
    }

    if (url.pathname === '/plots') {
      seenAuthorization.push(request.headers.authorization ?? '');
      if (request.headers.authorization !== `Bearer ${acceptOnly}`) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'expired' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ plots: [{ plotRef: 'P-1', rods: 5 }] }));
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  tokenUrl = `${baseUrl}/oauth/token`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

describe('what the document says about signing in', () => {
  it('finds the token endpoint rather than asking somebody to type it', async () => {
    const flow = clientCredentialsFlow(await loadDocument(SPEC));
    expect(flow).toMatchObject({
      scheme: 'registry',
      tokenUrl: 'https://example.invalid/oauth/token',
      scopes: ['plots:read'],
    });
  });

  it('says nothing about a document whose only flow ends in a browser', async () => {
    const browserOnly = JSON.stringify({
      openapi: '3.0.3',
      paths: {},
      components: {
        securitySchemes: {
          web: {
            type: 'oauth2',
            flows: { authorizationCode: { tokenUrl: 'https://x.invalid/t', scopes: {} } },
          },
        },
      },
    });
    // Half-attempting a flow that needs a person is worse than saying no.
    expect(clientCredentialsFlow(await loadDocument(browserOnly))).toBeNull();
  });

  it('says nothing about a document with no security at all', async () => {
    expect(clientCredentialsFlow(await loadDocument('{"openapi":"3.0.3","paths":{}}'))).toBeNull();
  });
});

describe('calling an API that wants a token', () => {
  it('exchanges once and reuses it', async () => {
    exchanges = 0;
    const connection = await OpenApiConnection.open({
      spec: SPEC,
      baseUrl,
      oauth: { tokenUrl, clientId: 'a-client', clientSecret: 'a-secret', scope: 'plots:read' },
    });
    try {
      for (let index = 0; index < 4; index += 1) {
        const answer = await connection.call('listPlots', {});
        expect(answer.ok).toBe(true);
      }
    } finally {
      await connection.close();
    }
    // Four calls, one token. A token per request is a rate limit waiting to
    // be hit halfway through somebody's suite.
    expect(exchanges).toBe(1);
    expect(tokenBodies.at(-1)).toContain('grant_type=client_credentials');
    expect(tokenBodies.at(-1)).toContain('scope=plots%3Aread');
    // The credentials went in the header, not the body that ends up in a log.
    expect(tokenBodies.at(-1)).not.toContain('a-secret');
  }, 30_000);

  it('never puts a token in a URL', async () => {
    const connection = await OpenApiConnection.open({
      spec: SPEC,
      baseUrl,
      oauth: { tokenUrl, clientId: 'a-client', clientSecret: 'a-secret' },
    });
    try {
      await connection.call('listPlots', {});
    } finally {
      await connection.close();
    }
    expect(seenAuthorization.some((value) => value.startsWith('Bearer '))).toBe(true);
  }, 30_000);

  it('signs in again when the API says the token is no longer good', async () => {
    exchanges = 0;
    issued = 'token-one';
    acceptOnly = 'token-one';
    const connection = await OpenApiConnection.open({
      spec: SPEC,
      baseUrl,
      oauth: { tokenUrl, clientId: 'a-client', clientSecret: 'a-secret' },
    });
    try {
      expect((await connection.call('listPlots', {})).ok).toBe(true);

      // The server rotates. The token in hand is now refused.
      issued = 'token-two';
      acceptOnly = 'token-two';
      const after = await connection.call('listPlots', {});
      // One 401, one fresh exchange, and the call succeeds — rather than a run
      // failing at case seven for a reason nobody can see.
      expect(after.ok).toBe(true);
      expect(exchanges).toBe(2);
    } finally {
      await connection.close();
    }
  }, 30_000);

  it('does not repeat a token that is refused twice', async () => {
    exchanges = 0;
    issued = 'not-accepted';
    acceptOnly = 'something-else';
    const connection = await OpenApiConnection.open({
      spec: SPEC,
      baseUrl,
      oauth: { tokenUrl, clientId: 'a-client', clientSecret: 'a-secret' },
    });
    try {
      const answer = await connection.call('listPlots', {});
      expect(answer.ok).toBe(false);
      expect(answer.error?.code).toBe('HTTP_401');
      // Exactly one retry. A loop here is a lockout.
      expect(exchanges).toBe(2);
    } finally {
      await connection.close();
      issued = 'token-one';
      acceptOnly = 'token-one';
    }
  }, 30_000);

  it('says what is wrong without repeating the secret back', async () => {
    const credentials = new ClientCredentials({
      tokenUrl,
      clientId: 'a-client',
      clientSecret: 'the-wrong-secret',
    });
    const problem = await credentials.header().then(
      () => new Error('it should not have got a token'),
      (error: Error) => error,
    );
    expect(problem.message).toContain('answered 401');
    // The token endpoint echoed what it was sent. Asserted on the message
    // itself rather than through a negated matcher, because a matcher that
    // cannot fail is worse than no test.
    expect(problem.message).not.toContain('the-wrong-secret');
    expect(problem.message).toContain('Check the client id and secret');
  }, 30_000);

  it('exchanges once for a burst of calls that all start together', async () => {
    exchanges = 0;
    const connection = await OpenApiConnection.open({
      spec: SPEC,
      baseUrl,
      oauth: { tokenUrl, clientId: 'a-client', clientSecret: 'a-secret' },
    });
    try {
      const answers = await Promise.all(
        [1, 2, 3, 4, 5].map(async () => connection.call('listPlots', {})),
      );
      expect(answers.every((answer) => answer.ok)).toBe(true);
    } finally {
      await connection.close();
    }
    expect(exchanges).toBe(1);
  }, 30_000);
});
