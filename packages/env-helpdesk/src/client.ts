import { helpdeskStateSchema } from './twin/db.ts';
import type { HelpdeskState } from './twin/seed.ts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class HelpdeskHostRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'HelpdeskHostRefused';
  }
}

export class HelpdeskHttpError extends Error {
  constructor(
    readonly request: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`The Larch Helpdesk twin refused ${request} (${status}): ${bodyText(body)}`);
    this.name = 'HelpdeskHttpError';
  }
}

export function assertHelpdeskBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HelpdeskHostRefused(`"${raw}" is not a URL.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new HelpdeskHostRefused('The Larch Helpdesk twin URL must not carry credentials.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new HelpdeskHostRefused(
      `The Larch Helpdesk twin runs on loopback only; ${url.origin} is not a loopback address.`,
    );
  }
  if (url.search !== '' || url.hash !== '' || (url.pathname !== '/' && url.pathname !== '/mcp')) {
    throw new HelpdeskHostRefused(
      'The twin URL may have no path other than /mcp, query, or fragment.',
    );
  }
  return url;
}

export class HelpdeskClient {
  private readonly origin: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.origin = assertHelpdeskBaseUrl(baseUrl).origin;
  }

  async seed(state: HelpdeskState): Promise<void> {
    await this.request('POST', '/_twin/seed', state);
  }

  async dump(): Promise<HelpdeskState> {
    const body = await this.request('GET', '/_twin/dump');
    return helpdeskStateSchema.parse(body);
  }

  async reset(): Promise<void> {
    await this.request('POST', '/_twin/reset');
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const label = `${method} ${path}`;
    const response = await this.fetchImpl(this.origin + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const decoded = decodeBody(text);
    if (!response.ok) throw new HelpdeskHttpError(label, response.status, decoded);
    if (text !== '' && decoded === text) throw new HelpdeskHttpError(label, response.status, text);
    return decoded;
  }
}

function decodeBody(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function bodyText(body: unknown): string {
  return typeof body === 'string' ? body : (JSON.stringify(body) ?? String(body));
}

export function createHelpdeskClient(
  baseUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): HelpdeskClient {
  return new HelpdeskClient(baseUrl, fetchImpl);
}
