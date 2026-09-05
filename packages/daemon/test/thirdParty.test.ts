/**
 * What RigorRun does about a system it cannot check.
 *
 * `packages/mcp/test/thirdParty.test.ts` establishes the fact: the public
 * `@modelcontextprotocol/server-filesystem` answers its reads in prose, so
 * there are no records to compare before against after. This is about the
 * product's behaviour in that situation, which is the part that decides whether
 * somebody's afternoon is wasted.
 *
 * The behaviour before this test existed: RigorRun connected happily, accepted
 * the nominated reads, let the person do the entire job, and then refused at
 * compile time with "the recording performed write_file but nothing in the
 * system changed". The recording was fine. The reads were the problem, and the
 * person was sent to fix the wrong thing at the latest possible moment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '../src/index.ts';
import type { Project } from '../src/project.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const server = join(repo, 'node_modules', '.bin', 'mcp-server-filesystem');

let sandbox: string;
let home: string;
let store: ProjectStore;
let proxy: ProxyServer;
let service: Service;
let project: Project;

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'rigorrun-fs-system-'));
  await mkdir(join(sandbox, 'drafts'), { recursive: true });
  await mkdir(join(sandbox, 'published'), { recursive: true });
  await writeFile(join(sandbox, 'drafts', 'q3-plan.md'), 'title: Q3 plan\nowner: dana\n');

  home = await mkdtemp(join(tmpdir(), 'rigorrun-fs-home-'));
  store = new ProjectStore(home);
  proxy = new ProxyServer();
  await proxy.start();
  service = new Service({ store, proxy });
}, 60_000);

afterAll(async () => {
  await service?.workspace.close();
  await proxy?.stop();
  await rm(home, { recursive: true, force: true });
  await rm(sandbox, { recursive: true, force: true });
});

describe('connecting a system that cannot be read back', () => {
  it('connects, and finds everything the server publishes', async () => {
    project = await service.createProject({
      name: 'Draft review',
      goal: 'Publish a draft once it has been reviewed.',
    });
    const connected = await service.connectEnvironment(
      project.id,
      {
        kind: 'mcp',
        transport: 'stdio',
        command: server,
        args: [sandbox],
        url: '',
        secretNames: [],
      },
      'ephemeral',
    );
    project = connected.project;
    expect(connected.serverName).toBe('secure-filesystem-server');
    expect(connected.tools.length).toBeGreaterThan(10);
  }, 60_000);

  it('says the reads cannot tell it anything, before anybody records a job', async () => {
    const configured = await service.configureEnvironment(project.id, {
      readOnlyTools: ['list_directory', 'read_text_file', 'get_file_info', 'directory_tree'],
      verifierReads: [{ tool: 'list_directory', args: { path: sandbox } }],
      reset: { kind: 'none' },
    });
    project = configured.project;

    // Specific about which of the two possible problems this is, and about
    // what a person could do instead.
    expect(configured.readsProblem).toMatch(/structured records/);
    expect(configured.readsProblem).toMatch(/text back/);
    expect(configured.readsProblem).toMatch(/cannot check the result/);
  }, 60_000);

  it('saves the configuration anyway, because it is the person’s call', async () => {
    // A warning, not a refusal. Somebody may want to watch an agent work in a
    // system they cannot verify, and RigorRun's job is to say what that buys
    // them rather than to stop them.
    expect((await store.read(project.id)).verifierReads).toHaveLength(1);
  });

  it('blames the reads rather than the recording when it still cannot compile', async () => {
    await service.startTeaching(project.id);
    await service.teachStep(project.id, 'list_directory', { path: join(sandbox, 'drafts') });
    await service.teachStep(project.id, 'write_file', {
      path: join(sandbox, 'published', 'q3-plan.md'),
      content: 'title: Q3 plan\nowner: dana\n',
    });
    await service.finishTeaching(project.id);

    // The job genuinely happened — a file was written — so telling this person
    // their recording changed nothing would be false as well as unhelpful.
    await expect(service.compile(project.id)).rejects.toThrow(/cannot see any records/);
    await expect(service.compile(project.id)).rejects.toThrow(/text rather than structured records/);
  }, 120_000);
});
