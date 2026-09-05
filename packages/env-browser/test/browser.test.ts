/**
 * A web application, and the one thing that must not go wrong.
 *
 * The browser lane has been called the largest gap in this product for months,
 * and it is also the one with the most obvious way to build it badly: drive the
 * page, read the page, call that a verdict. A page saying "Booking confirmed"
 * is a claim by the same system that would have to be wrong for the booking not
 * to be confirmed — which is exactly the mistake RigorRun exists to stop people
 * making about an agent's own report, and it does not become acceptable because
 * the claim is rendered in a div.
 *
 * So the assertions that matter most here are the ones about what RigorRun
 * refuses to conclude.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { SystemEnvironment } from '@rigorrun/connector';
import { verificationStrength } from '@rigorrun/environment';
import { BrowserConnection, BROWSER_MISSING, parseLocator } from '../src/index.ts';

/** A page in a business none of this code has seen. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Allotment registry</title>
<body>
  <h1>Plot PLOT-14</h1>
  <label for="tenant">Tenant</label>
  <input id="tenant" name="tenant" />
  <button type="button" data-testid="assign" onclick="document.getElementById('done').textContent='Tenant assigned'">Assign</button>
  <p id="done"></p>
</body>`;

let site: Server;
let baseUrl: string;
let available = true;

beforeAll(async () => {
  site = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;

  // The browser lane is optional by design, so the suite has to survive its
  // absence — a package that fails the build when an optional peer is missing
  // is not optional.
  try {
    const connection = await BrowserConnection.open({ startUrl: baseUrl });
    await connection.close();
  } catch (error) {
    available = !String((error as Error).message).includes('Playwright');
  }
  process.stdout.write(`\n  browser available: ${available}\n`);
}, 120_000);

describe('the suite itself', () => {
  it('is actually driving a browser, not quietly skipping', () => {
    // A suite that passes by doing nothing is worse than a failing one. If
    // Playwright is genuinely absent this is the one test that says so, out
    // loud, rather than six green ticks that mean nothing.
    expect(available, 'Playwright is not installed; the browser tests did nothing').toBe(true);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
});

describe('reading a selector', () => {
  it('treats a bare string as text, because that is what people type', () => {
    expect(parseLocator('Assign')).toEqual({ text: 'Assign' });
    expect(parseLocator('{"testId":"assign"}')).toEqual({ testId: 'assign' });
    // Not JSON, and not an error either: it is text with a brace in it.
    expect(parseLocator('{not json')).toEqual({ text: '{not json' });
  });

  it('says what to do when Playwright is not installed', () => {
    // The message is the feature. A missing optional dependency that produces
    // a module-not-found stack is a dead end.
    expect(BROWSER_MISSING).toMatch(/playwright install/);
    expect(BROWSER_MISSING).toMatch(/nothing you have set up is lost/);
  });
});

describe('driving a page', () => {
  it('does the job, and says what it saw rather than what it changed', async () => {
    if (!available) return;
    const connection = await BrowserConnection.open({ startUrl: baseUrl });
    try {
      const filled = await connection.call('fill', {
        selector: '{"label":"Tenant"}',
        value: 'TEN-3',
      });
      expect(filled.ok).toBe(true);

      const clicked = await connection.call('click', { selector: '{"testId":"assign"}' });
      expect(clicked.ok).toBe(true);

      // What is on the page comes back as roles and names — the closest thing
      // a page has to describing itself in words a person would use, and
      // stable against the styling changes that break every class selector.
      const seen = await connection.call('read_page', {});
      expect(JSON.stringify(seen.structured)).toContain('Tenant assigned');
    } finally {
      await connection.close();
    }
  }, 120_000);

  it('stays on the site it was pointed at', async () => {
    if (!available) return;
    const connection = await BrowserConnection.open({ startUrl: baseUrl });
    try {
      const away = await connection.call('navigate', { url: 'http://example.com/' });
      // A page can link anywhere. An agent following one off-site would be
      // RigorRun driving a browser to an address nobody named.
      expect(away.ok).toBe(false);
      expect(away.error?.code).toBe('OFF_SITE');
    } finally {
      await connection.close();
    }
  }, 120_000);
});

describe('what a browser is not allowed to conclude', () => {
  it('reports OBSERVATIONAL when there is nothing behind it', async () => {
    if (!available) return;
    const connection = await BrowserConnection.open({ startUrl: baseUrl });
    try {
      // Even with reads nominated. The page cannot answer them, and pretending
      // it can is the whole failure mode.
      const environment = new SystemEnvironment(
        connection,
        { entities: [], relationships: [] },
        {
          id: 'site',
          name: 'Allotment registry',
          description: 'The web application.',
          verifierReads: [{ tool: 'read_page' }],
          reset: { kind: 'none' },
          safety: 'staging',
          readOnlyTools: ['read_page'],
        },
      );

      expect(connection.canReadState).toBe(false);
      expect(environment.capabilities().stateRead).toBe('none');
      expect(verificationStrength(environment.capabilities())).toBe('OBSERVATIONAL');

      // And it genuinely reads nothing back, rather than returning the page as
      // if it were records.
      expect(await environment.getState()).toEqual({ entities: {} });
    } finally {
      await connection.close();
    }
  }, 120_000);

  it('reads records when something that has them is attached', async () => {
    if (!available) return;
    // A stand-in for an MCP or OpenAPI connection to the same system. What
    // matters is that it is not the browser.
    const verifier = {
      discovery: { serverName: 'records', serverVersion: '', protocolVersion: '', tools: [], latencyMs: 0 },
      childPid: null,
      call: async () => ({
        ok: true,
        structured: { plots: [{ plotRef: 'PLOT-14', tenantRef: 'TEN-3' }] },
        durationMs: 0,
      }),
      close: async () => undefined,
    };

    const connection = await BrowserConnection.open({ startUrl: baseUrl, verifier });
    try {
      expect(connection.canReadState).toBe(true);
      // A nominated read that is not a browser action reaches the verifier,
      // which is how clicking gets watched in the page and the verdict comes
      // from records.
      const read = await connection.call('listPlots', {});
      expect(JSON.stringify(read.structured)).toContain('PLOT-14');

      const environment = new SystemEnvironment(
        connection,
        {
          entities: [
            {
              name: 'Plot',
              idField: 'plotRef',
              mutable: true,
              appendOnly: false,
              fields: [
                { name: 'plotRef', type: 'string', nullable: false, role: 'identifier' },
                { name: 'tenantRef', type: 'string', nullable: true },
              ],
            },
          ],
          relationships: [],
        },
        {
          id: 'site',
          name: 'Allotment registry',
          description: 'The web application, with its API behind it.',
          verifierReads: [{ tool: 'listPlots' }],
          reset: { kind: 'none' },
          safety: 'staging',
          readOnlyTools: ['read_page', 'listPlots'],
        },
      );

      expect(verificationStrength(environment.capabilities())).toBe('PARTIAL');
      const state = await environment.getState();
      expect(Object.keys(state.entities['Plot'] ?? {})).toEqual(['PLOT-14']);
    } finally {
      await connection.close();
    }
  }, 120_000);
});
