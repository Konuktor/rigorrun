import type { ClinicDb } from './db.ts';

export interface FixtureResponse {
  status: number;
  body: unknown;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function handleFixtureRoute(
  db: ClinicDb,
  method: string | undefined,
  path: string | undefined,
  remoteAddress: string | undefined,
  body?: unknown,
): FixtureResponse | undefined {
  if (!path?.startsWith('/fixture/')) return undefined;
  if (!isLoopbackAddress(remoteAddress)) return { status: 403, body: { error: 'forbidden' } };

  if (method === 'GET' && path === '/fixture/state') {
    return { status: 200, body: db.dump() };
  }
  if (method === 'POST' && path === '/fixture/reset') {
    return { status: 200, body: db.reset() };
  }
  if (method === 'POST' && path === '/fixture/load') {
    try {
      return { status: 200, body: db.load(body) };
    } catch {
      return { status: 400, body: { error: 'invalid state' } };
    }
  }
  return { status: 404, body: { error: 'not found' } };
}
