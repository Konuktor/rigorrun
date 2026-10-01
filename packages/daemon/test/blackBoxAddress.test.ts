/**
 * A black-box agent's address is stored in the project and printed wherever
 * the agent is listed, so a credential in its query would sit in a file meant
 * to be copied and in every log that lists agents. The service refuses one
 * before anything is stored, whichever way the agent arrived, and describes
 * every address without its query.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service, describeAgent } from '../src/index.ts';
import type { AgentConfig } from '../src/project.ts';

let home: string;
let proxy: ProxyServer;
let service: Service;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-blackbox-address-'));
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store: new ProjectStore(home), proxy });
});

afterAll(async () => {
  await service.workspace.close();
  await proxy.stop();
  await rm(home, { recursive: true, force: true });
});

describe('a black-box agent’s address', () => {
  it('is refused with a credential in its query, and nothing is stored', async () => {
    const project = await service.createProject({ name: 'Query secrets' });
    await expect(
      service.addAgent(project.id, {
        name: 'leaky',
        blackBox: { endpoint: 'http://127.0.0.1:9/run?api_key=sk_test_SECRET123' },
      }),
    ).rejects.toThrow(/credential in its query \(api_key\)/);
    expect((await service.readProject(project.id)).agents).toEqual([]);
  });

  it('is described without its query, while two queries are still two agents', async () => {
    const project = await service.createProject({ name: 'Two tenants' });
    for (const tenant of ['acme', 'globex']) {
      await service.addAgent(project.id, {
        name: tenant,
        blackBox: { endpoint: `http://127.0.0.1:9/run?tenant=${tenant}` },
      });
    }
    const agents = (await service.readProject(project.id)).agents;
    expect(agents).toHaveLength(2);
    for (const agent of agents) {
      expect(describeAgent(agent)).toBe('http://127.0.0.1:9/run?… (black box)');
    }
  });

  it('is described without its query for an HTTP agent too', () => {
    const agent = {
      id: 'a_1',
      name: 'http',
      kind: 'http',
      endpoint: 'http://127.0.0.1:9/mcp?session=private',
      lastProbeAt: null,
      lastProbeOk: false,
      lastProbeProblem: '',
    } as AgentConfig;
    expect(describeAgent(agent)).toBe('http://127.0.0.1:9/mcp?…');
  });
});
