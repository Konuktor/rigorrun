/**
 * Signing in to an MCP server that requires it.
 *
 * A static `Authorization` header covers a great many servers and none of the
 * hosted ones. The specification says an MCP server is an OAuth 2.1 resource
 * server: a 401 carries a `WWW-Authenticate` pointing at protected-resource
 * metadata, which names an authorization server, which is discovered, possibly
 * registered with, and then talked to with PKCE.
 *
 * All of that is in the SDK. What is not, and what this file is, is the part
 * that belongs to whoever is running the client: where the tokens are kept, and
 * how a person is asked to approve.
 *
 * **Tokens go where credentials go.** The same store as every other secret —
 * the OS keychain where there is one — rather than a file beside the project.
 * A project file can still be read, copied and attached to a support request
 * without carrying anything, which is the arrangement the whole product rests
 * on, and an access token is exactly the kind of thing that quietly breaks it.
 *
 * **Approval happens in a browser, on this machine.** The redirect comes back
 * to a loopback listener that exists for the length of one sign-in and refuses
 * anything but the state it issued. RigorRun already runs a local server and
 * already opens browsers, so this is the shape that fits — and there is no
 * hosted callback anywhere, because a hosted callback would mean somebody
 * else's server holding a code for your system.
 */
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/** Where the runner keeps things that must not be in a project file. */
export interface TokenStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface OAuthOptions {
  /** Names the secrets, so one machine can hold several servers' tokens. */
  serverKey: string;
  store: TokenStore;
  /** Opens a browser. Absent means print the URL and wait. */
  open?: (url: string) => Promise<void>;
  /** Told the URL, so an interface can show it rather than only opening it. */
  onAuthorizationUrl?: (url: string) => void;
  /** How long somebody has to finish signing in. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** The name RigorRun gives itself to an authorization server. */
const CLIENT_METADATA: OAuthClientMetadata = {
  client_name: 'RigorRun',
  client_uri: 'https://rigorrun.pages.dev',
  redirect_uris: [],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

/**
 * The half of OAuth that belongs to the client, for a local tool.
 *
 * Everything protocol-shaped — discovery, PKCE, registration, exchange,
 * refresh — is the SDK's. This is storage and consent.
 */
export class LocalOAuthProvider {
  private listener: Server | undefined;
  private redirect = '';
  private issuedState = '';
  private arrival: Promise<string> | undefined;
  private settle:
    | { resolve: (code: string) => void; reject: (error: Error) => void }
    | undefined;

  constructor(private readonly options: OAuthOptions) {}

  /**
   * Where the authorization server sends the browser back to.
   *
   * Empty until `start()`, because it names a port that does not exist before
   * then. The SDK reads this synchronously, so a sign-in starts the listener
   * first and hands the provider over second.
   */
  get redirectUrl(): string {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return { ...CLIENT_METADATA, redirect_uris: [this.redirect] };
  }

  /** A fresh, unguessable state per sign-in, checked when the code comes back. */
  state(): string {
    this.issuedState = randomBytes(16).toString('hex');
    return this.issuedState;
  }

  private key(part: string): string {
    return `oauth:${this.options.serverKey}:${part}`;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const saved = await this.options.store.get(this.key('client'));
    return saved ? (JSON.parse(saved) as OAuthClientInformationMixed) : undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.options.store.set(this.key('client'), JSON.stringify(info));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const saved = await this.options.store.get(this.key('tokens'));
    return saved ? (JSON.parse(saved) as OAuthTokens) : undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // Into the credential store, not into the project. See the file header.
    await this.options.store.set(this.key('tokens'), JSON.stringify(tokens));
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await this.options.store.set(this.key('verifier'), verifier);
  }

  async codeVerifier(): Promise<string> {
    const saved = await this.options.store.get(this.key('verifier'));
    if (!saved) throw new Error('No sign-in is in progress for this server.');
    return saved;
  }

  /**
   * Throws away credentials the server has told us are no longer good.
   *
   * The SDK calls this rather than making somebody work out for themselves
   * that a stale registration is why signing in keeps failing.
   */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    const parts =
      scope === 'all' ? (['client', 'tokens', 'verifier'] as const) : ([scope] as const);
    for (const part of parts) await this.options.store.remove(this.key(part));
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.options.onAuthorizationUrl?.(url.toString());
    await this.options.open?.(url.toString());
  }

  /**
   * Opens the loopback listener the redirect comes back to, and answers with
   * the address to send the browser back to.
   *
   * Started before the browser, torn down whatever happens, and it answers
   * exactly one thing: a code carrying the state it issued. Anything else gets
   * the same flat refusal, so probing it says nothing.
   */
  async start(): Promise<string> {
    if (this.listener) return this.redirect;

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const failed = url.searchParams.get('error');

      const say = (status: number, body: string): void => {
        response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><meta charset="utf-8"><title>RigorRun</title>
<body style="font:14px system-ui;margin:3rem;max-width:34rem">${body}`);
      };

      if (failed) {
        say(400, `<h1>Sign-in was refused.</h1><p>${escapeHtml(failed)}</p>`);
        this.settle?.reject(new Error(`The authorization server refused: ${failed}`));
        return;
      }
      // Compared before anything else is read, and with the same answer a
      // wrong path gets. A code arriving with a state RigorRun did not issue
      // is a code somebody else started the flow for.
      if (!code || !this.issuedState || state !== this.issuedState) {
        say(404, '<h1>Not found.</h1>');
        return;
      }
      say(200, '<h1>Signed in.</h1><p>You can close this tab and go back to RigorRun.</p>');
      this.settle?.resolve(code);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    this.listener = server;
    this.redirect = `http://127.0.0.1:${port}/callback`;

    // The waiting promise exists from the moment the port does, so a redirect
    // that arrives before anybody awaits it is still the one that settles it.
    this.arrival = new Promise<string>((resolve, reject) => {
      this.settle = { resolve, reject };
      setTimeout(
        () => reject(new Error('Nobody finished signing in. Try connecting again.')),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ).unref();
    });
    // Nothing may await this until `waitForCode`, and a rejection in between
    // would otherwise take the process down.
    this.arrival.catch(() => undefined);

    return this.redirect;
  }

  /** The code, once the browser has come back. `start()` first. */
  async waitForCode(): Promise<string> {
    if (!this.arrival) throw new Error('No sign-in is in progress for this server.');
    return this.arrival;
  }

  /** Ends the listener. Called whatever happened, including on a refusal. */
  async close(): Promise<void> {
    const server = this.listener;
    this.listener = undefined;
    // A sign-in nobody finished should not leave a promise that can still be
    // settled by a late redirect to a port RigorRun has given up.
    this.settle?.reject(new Error('The sign-in was closed.'));
    this.settle = undefined;
    this.arrival = undefined;
    this.issuedState = '';
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return '&quot;';
    }
  });
}
