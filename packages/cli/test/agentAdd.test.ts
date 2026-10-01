/**
 * `rigorrun agent add|list`, and `--case` on a project run.
 *
 * An agent added here goes through the same schema, address check and probe
 * as one added in the interface, so the things the interface refuses are
 * refused here too — and refused before anything is written. `--case` narrows
 * a project run to named cases without losing what the after-case hook is
 * handed about each one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CASE_BINDINGS_ENV, type RunResult } from '@rigorrun/core';
import { clearPacks, registerPack } from '@rigorrun/environment';
import { ProjectStore, Service, type Project } from '@rigorrun/daemon';
import { ProxyServer } from '@rigorrun/proxy';
import { main } from '../src/main.ts';
import {
  DEFAULT_KEY_SECRET,
  PACK_ID,
  blackBoxAgent,
  fakeItemsPack,
} from '../../daemon/test/packFixture.ts';

let dir: string;
let home: string;
const servers: Server[] = [];

async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  try {
    return { code: await main(args), out, err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

/** A loopback endpoint that answers the probe, and nothing else. */
function answering(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/task`);
    });
  });
}

async function withService<T>(
  work: (service: Service, store: ProjectStore) => Promise<T>,
): Promise<T> {
  const proxy = new ProxyServer();
  await proxy.start();
  const store = new ProjectStore(home);
  const service = new Service({ store, proxy });
  try {
    return await work(service, store);
  } finally {
    await service.workspace.close();
    await proxy.stop();
  }
}

const readProject = (id: string): Promise<Project> => new ProjectStore(home).read(id);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rigorrun-agent-add-'));
  home = join(dir, 'home');
});

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  clearPacks();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('agent add --black-box', () => {
  it('probes the agent, stores it on the project, and lists it', async () => {
    const project = await withService((service) => service.createProject({ name: 'Somewhere' }));
    const endpoint = await answering();
    await writeFile(
      join(dir, 'secret-free.json'),
      '{"text": "{{task.text}}", "ref": "{{inputs.reference}}"}',
    );
    await withService((_service, store) => store.setSecret('agent_token', 'not-in-any-file'));

    const added = await cli(
      'agent',
      'add',
      '--project',
      project.id,
      '--home',
      home,
      '--name',
      'Front desk',
      '--black-box',
      endpoint,
      '--body-template',
      join(dir, 'secret-free.json'),
      '--completion',
      'settle',
      '--settle',
      '2',
      '--claim-path',
      'result.message',
      '--header',
      'Authorization=agent_token',
    );
    expect(added.code, added.err).toBe(0);

    const [agent] = (await readProject(project.id)).agents;
    expect(agent).toMatchObject({
      kind: 'blackbox',
      name: 'Front desk',
      endpoint,
      headers: { Authorization: 'agent_token' },
      bodyTemplate: '{"text": "{{task.text}}", "ref": "{{inputs.reference}}"}',
      completion: 'settle',
      settleQuietMs: 2000,
      claimPath: 'result.message',
      allowedHosts: [],
      lastProbeOk: true,
    });
    expect(added.out).toContain(agent!.id);
    // The header's value lives in the secret store; the project names it.
    expect(JSON.stringify(await readProject(project.id))).not.toContain('not-in-any-file');

    const listed = await cli('agent', 'list', '--project', project.id, '--home', home);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain('Front desk');
    expect(listed.out).toContain(`${endpoint} (black box)`);
  });

  it('stores an agent that does not answer yet, and exits 1 so a script can tell', async () => {
    const project = await withService((service) => service.createProject({ name: 'Not running' }));
    const { code, out } = await cli(
      'agent',
      'add',
      '--project',
      project.id,
      '--home',
      home,
      '--black-box',
      'http://127.0.0.1:9/task',
    );
    expect(code).toBe(1);
    expect(out).toContain('does not answer');
    expect((await readProject(project.id)).agents).toHaveLength(1);
  });

  it.each([
    ['an address that is not a URL', ['--black-box', 'not a url'], /not a URL/],
    [
      'a remote host nobody named',
      ['--black-box', 'https://agent.example.com/task'],
      /not on this agent's list.*--allow-host/,
    ],
    [
      'a named remote host over plain http',
      ['--black-box', 'http://agent.example.com/task', '--allow-host', 'agent.example.com'],
      /only reach it over https/,
    ],
    [
      'a completion RigorRun does not know',
      ['--black-box', 'http://127.0.0.1:9/', '--completion', 'whenever'],
      /completion/,
    ],
    [
      'a header without a secret name',
      ['--black-box', 'http://127.0.0.1:9/', '--header', 'Authorization'],
      /Name=secret_name/,
    ],
    [
      'a header whose secret is not set',
      ['--black-box', 'http://127.0.0.1:9/', '--header', 'Authorization=sk-pasted-credential'],
      /secret that is not set/,
    ],
  ])('refuses %s, and stores nothing', async (_what, args, message) => {
    const project = await withService((service) => service.createProject({ name: 'Refusals' }));
    const { code, err } = await cli(
      'agent',
      'add',
      '--project',
      project.id,
      '--home',
      home,
      ...args,
    );
    expect(code).toBe(2);
    expect(err).toMatch(message);
    // A pasted credential is never echoed back, and never stored.
    expect(err).not.toContain('sk-pasted-credential');
    expect((await readProject(project.id)).agents).toEqual([]);
  });

  it('refuses a body template a case could not fill', async () => {
    const project = await withService((service) => service.createProject({ name: 'Template' }));
    await writeFile(join(dir, 'bad.json'), '{"text": "{{ticket}}"}');
    const { code, err } = await cli(
      'agent',
      'add',
      '--project',
      project.id,
      '--home',
      home,
      '--black-box',
      'http://127.0.0.1:9/',
      '--body-template',
      join(dir, 'bad.json'),
    );
    expect(code).toBe(2);
    expect(err).toContain('{{ticket}}');
    expect((await readProject(project.id)).agents).toEqual([]);
  });

  it('refuses a project that does not exist, and a missing address', async () => {
    expect(
      (
        await cli(
          'agent',
          'add',
          '--project',
          'p_nope',
          '--home',
          home,
          '--black-box',
          'http://127.0.0.1:9/',
        )
      ).code,
    ).toBe(2);
    expect((await cli('agent', 'add', '--project', 'p_nope', '--home', home)).err).toContain(
      '--black-box <url>',
    );
    expect((await cli('agent', 'remove', '--project', 'p_nope', '--home', home)).code).toBe(2);
  });
});

describe('--case on a project run', () => {
  it('runs only the named cases, and the after-case hook still gets each case’s records', async () => {
    const fake = fakeItemsPack();
    registerPack(fake.pack);
    const endpoint = await blackBoxAgent(
      () => fake.sessions[fake.sessions.length - 1]!,
      5,
      servers,
    );
    const project = await withService(async (service, store) => {
      await store.setSecret(DEFAULT_KEY_SECRET, 'k');
      const created = await service.createProject({ name: 'Items' });
      await service.connectEnvironment(
        created.id,
        { kind: 'pack', pack: PACK_ID, mode: 'twin' },
        'ephemeral',
      );
      await service.installPackSuite(
        created.id,
        {},
        { confirmedRuleIds: ['items.exact', 'items.no_other'] },
      );
      return created;
    });
    expect(
      (await cli('agent', 'add', '--project', project.id, '--home', home, '--black-box', endpoint))
        .code,
    ).toBe(0);

    const seen = join(dir, 'seen.jsonl');
    const hook = join(dir, 'hook.cjs');
    await writeFile(
      hook,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        `const keys = ["RIGORRUN_CASE_ID", "RIGORRUN_CASE_INDEX", "RIGORRUN_CASE_ATTEMPT", ${JSON.stringify(CASE_BINDINGS_ENV)}];`,
        `fs.appendFileSync(${JSON.stringify(seen)}, JSON.stringify(Object.fromEntries(keys.map((k) => [k, process.env[k]]))) + "\\n");`,
      ].join('\n'),
    );
    await chmod(hook, 0o755);

    const gate = await cli(
      'gate',
      '--project',
      project.id,
      '--home',
      home,
      '--case',
      'case_b',
      '--case',
      'case_c',
      '--after-case',
      hook,
    );
    expect(gate.code, gate.out + gate.err).toBe(0);
    expect(gate.out).toContain('Ran 2 of the suite');

    const lines = (await readFile(seen, 'utf8'))
      .trim()
      .split('\n')
      .map((entry) => JSON.parse(entry) as Record<string, string>);
    expect(lines.map((entry) => [entry['RIGORRUN_CASE_ID'], entry['RIGORRUN_CASE_INDEX']])).toEqual(
      [
        ['case_b', '0'],
        ['case_c', '1'],
      ],
    );
    for (const entry of lines) {
      expect(entry['RIGORRUN_CASE_ATTEMPT']).toBe('0');
      expect(Object.keys(JSON.parse(entry[CASE_BINDINGS_ENV]!) as object)).toEqual([
        'record',
        'label',
      ]);
    }

    const run = await cli(
      'run',
      '--project',
      project.id,
      '--home',
      home,
      '--case',
      'case_a',
      '--json',
    );
    expect(run.code, run.err).toBe(0);
    const result = JSON.parse(run.out) as RunResult;
    expect(result.caseResults.map((entry) => entry.caseId)).toEqual(['case_a']);
  });

  it('refuses a case the suite does not have, and --case without a project', async () => {
    const fake = fakeItemsPack();
    registerPack(fake.pack);
    const endpoint = await blackBoxAgent(
      () => fake.sessions[fake.sessions.length - 1]!,
      5,
      servers,
    );
    const project = await withService(async (service, store) => {
      await store.setSecret(DEFAULT_KEY_SECRET, 'k');
      const created = await service.createProject({ name: 'Items' });
      await service.connectEnvironment(
        created.id,
        { kind: 'pack', pack: PACK_ID, mode: 'twin' },
        'ephemeral',
      );
      await service.installPackSuite(created.id, {});
      await service.addAgent(created.id, { name: 'adds', blackBox: { endpoint } });
      return created;
    });

    const unknown = await cli('gate', '--project', project.id, '--home', home, '--case', 'case_zz');
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('no case case_zz');
    expect(fake.sessions.flatMap((session) => session.made)).toEqual([]);

    const fileRun = await cli('run', 'benchmark.json', '--case', 'case_a');
    expect(fileRun.code).toBe(2);
    expect(fileRun.err).toContain('Use it with --project');
  });
});
