/**
 * The one OAuth flow an HTTP API can complete without a person.
 *
 * MCP's flow is a browser, a redirect and somebody clicking approve, because
 * an MCP server acts on behalf of the person sitting there. A REST API under
 * test is usually the other shape: a client id and a secret, exchanged for a
 * token, no human in it anywhere. That is `client_credentials`, and it is what
 * an enterprise API hands a service account.
 *
 * The token URL is read out of the document rather than asked for, because
 * `securitySchemes` already declares it and a field somebody has to fill in
 * from a PDF is a field they will get wrong.
 *
 * Nothing here is cached to disk. A token lives in this process for as long as
 * it is valid and dies with it — a benchmark run is minutes, and a token
 * written down is a token to lose.
 */
import type { OpenApiDocument } from './document.ts';

export interface ClientCredentialsConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Space-separated, as the specification writes them. Optional. */
  scope?: string;
}

/** How early to replace a token, so a request never races its expiry. */
const EARLY_MS = 30_000;
/** A token response beyond this is not a token response. */
const MAX_BYTES = 64 * 1024;

/**
 * What the document says about signing in, if it says anything.
 *
 * Only `clientCredentials` is looked for. The other three flows all end in a
 * browser, and an API whose only flow is a browser is one RigorRun should say
 * it cannot sign in to rather than half-attempt.
 */
export function clientCredentialsFlow(
  document: OpenApiDocument,
): { scheme: string; tokenUrl: string; scopes: string[] } | null {
  const schemes = (document.components as { securitySchemes?: Record<string, unknown> } | undefined)
    ?.securitySchemes;
  if (!schemes || typeof schemes !== 'object') return null;

  for (const [scheme, value] of Object.entries(schemes)) {
    const declared = value as {
      type?: string;
      flows?: { clientCredentials?: { tokenUrl?: string; scopes?: Record<string, string> } };
    };
    if (declared?.type !== 'oauth2') continue;
    const flow = declared.flows?.clientCredentials;
    if (!flow?.tokenUrl) continue;
    return {
      scheme,
      tokenUrl: flow.tokenUrl,
      scopes: Object.keys(flow.scopes ?? {}),
    };
  }
  return null;
}

/**
 * Holds one token and replaces it when it runs out.
 *
 * Deliberately not a general OAuth client. It does the one exchange, keeps the
 * answer for as long as the server said, and hands back a header.
 */
export class ClientCredentials {
  private token = '';
  private expiresAt = 0;
  /** So a burst of parallel calls performs one exchange rather than eight. */
  private inFlight: Promise<string> | undefined;

  constructor(private readonly config: ClientCredentialsConfig) {}

  /** Throws away the token, for a 401 that says it is no longer good. */
  invalidate(): void {
    this.token = '';
    this.expiresAt = 0;
  }

  async header(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return `Bearer ${this.token}`;
    this.inFlight ??= this.fetchToken().finally(() => {
      this.inFlight = undefined;
    });
    return `Bearer ${await this.inFlight}`;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (this.config.scope) body.set('scope', this.config.scope);

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        // The credentials go in the header, which is where RFC 6749 puts them
        // and, more to the point, not in a body that ends up in a log.
        authorization: `Basic ${Buffer.from(
          `${encodeURIComponent(this.config.clientId)}:${encodeURIComponent(this.config.clientSecret)}`,
        ).toString('base64')}`,
      },
      body: body.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });

    const text = (await response.text()).slice(0, MAX_BYTES);
    if (!response.ok) {
      // Never the body verbatim: an authorization server that echoes the
      // request back would echo the secret with it.
      throw new Error(
        `The token endpoint at ${this.config.tokenUrl} answered ${response.status}. ` +
          'Check the client id and secret, and that this API grants client credentials.',
      );
    }

    let parsed: { access_token?: unknown; expires_in?: unknown };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(`The token endpoint at ${this.config.tokenUrl} did not answer with JSON.`);
    }
    if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
      throw new Error(
        `The token endpoint at ${this.config.tokenUrl} answered without an access_token.`,
      );
    }

    // A server that says nothing about expiry gets an hour, which is the
    // customary default and is re-fetched long before a run of any length ends.
    const seconds = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600;
    this.token = parsed.access_token;
    this.expiresAt = Date.now() + Math.max(0, seconds * 1000 - EARLY_MS);
    return this.token;
  }
}
