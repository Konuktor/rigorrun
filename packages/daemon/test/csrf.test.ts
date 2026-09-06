/**
 * Cross-origin defence on state-changing routes.
 *
 * The session cookie is `SameSite=Strict`, which stops a cross-*site* page from
 * sending it — but every `127.0.0.1:<port>` is the *same* site, so a hostile
 * page a person happens to have open on another local port is same-site and its
 * fetch would carry the cookie. The runner therefore refuses a mutating request
 * a browser reports as anything but same-origin. These tests drive the real
 * HTTP server the way a browser and a CI client each would.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service, Runner } from '../src/index.ts';

let home: string;
let proxy: ProxyServer;
let runner: Runner;
let token: string;
let origin: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-csrf-'));
  proxy = new ProxyServer();
  await proxy.start();
  const service = new Service({ store: new ProjectStore(home), proxy });
  runner = new Runner({ service, version: 'test' });
  await runner.start();
  token = runner.pairing.token;
  origin = `http://127.0.0.1:${runner.port}`;
});

afterAll(async () => {
  await runner.stop();
  await proxy.stop?.();
  await rm(home, { recursive: true, force: true });
});

const create = (headers: Record<string, string>) =>
  fetch(`${origin}/api/projects`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `rigorrun_session=${token}`,
      ...headers,
    },
    body: JSON.stringify({ name: 'csrf', goal: 'csrf test' }),
  });

describe('a state-changing request', () => {
  it('is allowed when the browser says it is same-origin', async () => {
    const res = await create({ 'sec-fetch-site': 'same-origin' });
    expect(res.status).toBe(201);
  });

  it('is allowed for a direct navigation (sec-fetch-site: none)', async () => {
    const res = await create({ 'sec-fetch-site': 'none' });
    expect(res.status).toBe(201);
  });

  it('is refused when the browser says it is cross-site', async () => {
    const res = await create({ 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/cross-origin/i);
  });

  it('is refused when the browser says it is same-site (another local port)', async () => {
    // This is the exact vector SameSite=Strict does not close: a page on
    // 127.0.0.1:OTHER is same-site, so its cookie would be sent.
    const res = await create({ 'sec-fetch-site': 'same-site' });
    expect(res.status).toBe(403);
  });

  it('falls back to Origin for a browser that sends no Sec-Fetch-Site', async () => {
    const good = await create({ origin });
    expect(good.status).toBe(201);
    const evil = await create({ origin: 'http://127.0.0.1:59999' });
    expect(evil.status).toBe(403);
  });

  it('is unaffected for a non-browser caller that sends neither header', async () => {
    // CI and bearer-key clients do not send Origin or Sec-Fetch-Site, and must
    // not be caught by a browser-only defence.
    const res = await create({});
    expect(res.status).toBe(201);
  });
});

describe('a read', () => {
  it('is never blocked by the cross-origin defence', async () => {
    const res = await fetch(`${origin}/api/projects`, {
      headers: { cookie: `rigorrun_session=${token}`, 'sec-fetch-site': 'cross-site' },
    });
    expect(res.status).toBe(200);
  });
});

// The Host allowlist (a foreign `Host` → 403) is exercised in the audit with a
// client that can set that header; `fetch`/undici forbids overriding `Host`, so
// it cannot be driven from here. `hostIsLocal` and its middleware are unchanged.
