/**
 * A project whose system is a web application.
 *
 * The claim under test is not "RigorRun can click things" — `env-browser` has
 * its own tests for that. It is that a browser arrives at the same engine every
 * other connector does, and that the one thing which must not go wrong does not
 * go wrong: a page is never allowed to be the evidence for what a page did.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '../src/index.ts';
import type { Project } from '../src/project.ts';

/** A page in a business none of this code has seen. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Allotment registry</title>
<body>
  <h1>Plot PLOT-14</h1>
  <label for="tenant">Tenant</label>
  <input id="tenant" name="tenant" />
  <button type="button" data-testid="assign"
    onclick="document.getElementById('done').textContent='Tenant assigned'">Assign</button>
  <p id="done"></p>
</body>`;

let site: Server;
let baseUrl: string;
let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;
let available = true;

beforeAll(async () => {
  site = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;

  home = await mkdtemp(join(tmpdir(), 'rigorrun-browser-project-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
}, 120_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await rm(home, { recursive: true, force: true });
});

describe('connecting a web application', () => {
  it('connects, and publishes the actions a browser has', async () => {
    project = await service.createProject({
      name: 'Allotment site',
      goal: 'Assign a plot to a tenant.',
    });
    try {
      const connected = await service.connectEnvironment(
        project.id,
        {
          kind: 'browser',
          startUrl: baseUrl,
          browser: 'chromium',
          headless: true,
          verifier: null,
          secretNames: [],
        },
        'staging',
      );
      project = connected.project;
      expect(connected.tools.map((tool) => tool.name).sort()).toEqual([
        'click',
        'fill',
        'navigate',
        'press',
        'read_page',
        'screenshot',
        'select',
      ]);
    } catch (error) {
      available = !String((error as Error).message).includes('Playwright');
      if (available) throw error;
    }
  }, 120_000);

  it('is actually driving a browser, not quietly skipping', () => {
    expect(available, 'Playwright is not installed; these tests did nothing').toBe(true);
  });

  it('says out loud that it cannot check its own work', async () => {
    // The heart of it. Nominating `read_page` is the obvious thing somebody
    // will try, and it must not turn a page's own words into verification.
    const configured = await service.configureEnvironment(project.id, {
      readOnlyTools: ['read_page', 'screenshot'],
      verifierReads: [{ tool: 'read_page' }],
      reset: { kind: 'none' },
    });
    project = configured.project;

    // Asked before anything is called: for a browser the answer does not
    // depend on what the reads return. `read_page` answers with a page, and a
    // page is structured enough to look like records — which is exactly how
    // this goes wrong.
    expect(configured.readsProblem).toMatch(/cannot check its own work/);
    expect(configured.readsProblem).toMatch(/OBSERVATIONAL/);
  }, 120_000);

  it('watches a job being done, and grades nothing from the page', async () => {
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'fill', {
      selector: '{"label":"Tenant"}',
      value: 'TEN-3',
    });
    await service.teachStep(project.id, 'click', { selector: '{"testId":"assign"}' });
    const finished = await service.finishTeaching(project.id);

    // The page now says "Tenant assigned". RigorRun read it, kept it as
    // evidence, and derived no *records* from it — because the only read it
    // has is the page, and the page is a rendering of the state rather than
    // the state.
    expect(finished.schema.entities).toEqual([]);
    await expect(service.compile(project.id)).rejects.toThrow(/cannot see any records/);
  }, 180_000);
});
