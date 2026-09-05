/**
 * A public MCP server RigorRun has never met.
 *
 * `fixtures/external/mcp-venue-desk` is quarantined by a test and imports
 * nothing from RigorRun, but it is still four hundred lines written in this
 * repository — by people who knew what the client on the other side expected.
 * That proves the client works. It does not prove *MCP* works.
 *
 * So this connects to `@modelcontextprotocol/server-filesystem`, unmodified,
 * from npm, pinned in the lockfile, pointed at a directory that exists for the
 * length of the test. Nobody here chose its tools, its argument names, its
 * annotations or the shape of what it returns.
 *
 * What it found is worth stating plainly, because it is not all good news:
 *
 *   - Discovery, risk classification and argument schemas all work against a
 *     server nobody here designed for.
 *   - It annotates carefully — `readOnly` on all eight reads, `destructive` on
 *     write, edit and move — and RigorRun still refuses to act on any of it.
 *     Every tool counts as writing until a person says otherwise, because a
 *     server that annotates well is indistinguishable, from the client side,
 *     from one that annotates conveniently.
 *   - **Its reads return prose, not records.** `list_directory` answers with
 *     "[FILE] a.md\n[FILE] b.md". There is nothing structured to induce, so
 *     RigorRun cannot verify against this system by reading it back.
 *
 * The last one is the finding. RigorRun used to discover it at the end — after
 * somebody had connected, nominated reads and done the whole job — and then
 * blame the recording for changing nothing. It now says so before any of that,
 * and says which of the two problems it actually is.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  McpConnection,
  induceSchema,
  isConfirmedReadOnly,
  mayMutate,
  type McpStdioConfig,
} from '../src/index.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const server = join(repo, 'node_modules', '.bin', 'mcp-server-filesystem');

let sandbox: string;
let config: McpStdioConfig;

beforeAll(async () => {
  // Everything this server can touch, and it goes away at the end.
  sandbox = await mkdtemp(join(tmpdir(), 'rigorrun-thirdparty-'));
  await mkdir(join(sandbox, 'drafts'), { recursive: true });
  await mkdir(join(sandbox, 'published'), { recursive: true });
  await writeFile(join(sandbox, 'drafts', 'q3-plan.md'), 'title: Q3 plan\nowner: dana\n');
  config = { transport: 'stdio', command: server, args: [sandbox] };
});

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('a public MCP server nobody here wrote', () => {
  it('completes a handshake and names itself', async () => {
    const connection = await McpConnection.open(config);
    try {
      expect(connection.discovery.serverName).toBe('secure-filesystem-server');
      expect(connection.discovery.tools.length).toBeGreaterThan(10);
    } finally {
      await connection.close();
    }
  }, 60_000);

  it('reads argument schemas it has never seen, without guessing', async () => {
    const connection = await McpConnection.open(config);
    try {
      const write = connection.discovery.tools.find((tool) => tool.name === 'write_file')!;
      const byName = Object.fromEntries(write.params.map((param) => [param.name, param]));
      expect(byName['path']).toMatchObject({ type: 'string', required: true });
      expect(byName['content']).toMatchObject({ type: 'string', required: true });
      // Nothing was quietly dropped on the way in.
      expect(write.unsupported).toEqual([]);
      expect(write.schemaTruncated).toBe(false);
    } finally {
      await connection.close();
    }
  }, 60_000);

  it('will not act on this server’s annotations, correct though they are', async () => {
    const connection = await McpConnection.open(config);
    try {
      // This server annotates carefully — `readOnly: true` on all eight reads,
      // `destructive: true` on write, edit and move. It is a good citizen, and
      // the point of this test is that being a good citizen is not enough.
      const read = connection.discovery.tools.find((tool) => tool.name === 'list_directory')!;
      expect(read.hints.readOnly).toBe(true);
      expect(read.risk).toMatchObject({ level: 'read', source: 'server-hint' });

      // And yet: not one tool is *confirmed* read-only, because the only thing
      // vouching for it is the server itself. The specification is blunt about
      // why — "clients should never make tool use decisions based on
      // ToolAnnotations received from untrusted servers" — and a server that
      // annotates well is indistinguishable, from here, from one that annotates
      // conveniently. A person has to say.
      for (const tool of connection.discovery.tools) {
        expect(isConfirmedReadOnly(tool.risk)).toBe(false);
        expect(mayMutate(tool.risk)).toBe(true);
      }

      const write = connection.discovery.tools.find((tool) => tool.name === 'write_file')!;
      expect(write.risk).toMatchObject({ level: 'destructive', source: 'server-hint' });
    } finally {
      await connection.close();
    }
  }, 60_000);

  it('calls a tool and gets the server’s own answer back', async () => {
    const connection = await McpConnection.open(config);
    try {
      const listed = await connection.call('list_directory', { path: join(sandbox, 'drafts') });
      expect(listed.ok).toBe(true);
      expect(JSON.stringify(listed.structured ?? listed.content)).toContain('q3-plan.md');
    } finally {
      await connection.close();
    }
  }, 60_000);

  it('finds no records to verify against, because this system answers in prose', async () => {
    const connection = await McpConnection.open(config);
    try {
      const observations = [];
      for (const [tool, args] of [
        ['list_directory', { path: sandbox }],
        ['get_file_info', { path: join(sandbox, 'drafts', 'q3-plan.md') }],
        ['read_text_file', { path: join(sandbox, 'drafts', 'q3-plan.md') }],
      ] as const) {
        const result = await connection.call(tool, args as Record<string, unknown>);
        expect(result.ok).toBe(true);
        observations.push({ tool, payload: result.structured ?? result.content });
      }

      // This is the honest answer, not a bug. `[FILE] q3-plan.md` is a
      // sentence, and RigorRun reads structure rather than prose because
      // guessing at what a sentence means is how a verdict stops being worth
      // anything. A system like this can be watched and cannot be checked.
      expect(induceSchema(observations).schema.entities).toEqual([]);
    } finally {
      await connection.close();
    }
  }, 60_000);
});
