/**
 * The agent examples on the public docs site, run against the real protocol.
 *
 * The docs site once showed a GET health check and a `{report}` answer while the
 * code probed with POST and required `{status, output}`. A founder copying it
 * got "not answering" and no idea why. So the example server is not checked by
 * reading it: it is extracted, started, probed with RigorRun's own probe and
 * sent a real task envelope.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_PROTOCOL_V2, CompletionSchema, probeAgent } from '../src/httpAgent.ts';

const agentsDocs = fileURLToPath(new URL('../../../apps/docs/src/content/docs/agents/', import.meta.url));
const repoDocs = fileURLToPath(new URL('../../../docs/', import.meta.url));

const children: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function firstBlock(markdown: string, language: string): string {
  const match = new RegExp('```' + language + '\\n([\\s\\S]*?)```').exec(markdown);
  if (!match?.[1]) throw new Error(`no \`\`\`${language} block`);
  return match[1];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

async function untilProbeAnswers(endpoint: string): Promise<Awaited<ReturnType<typeof probeAgent>>> {
  let last: Awaited<ReturnType<typeof probeAgent>> = { ok: false, problem: 'never tried' };
  for (let attempt = 0; attempt < 50; attempt += 1) {
    last = await probeAgent({ endpoint });
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return last;
}

describe('the HTTP agent example on the docs site', () => {
  it('answers RigorRun’s own probe, and a real task with a completion RigorRun accepts', async () => {
    const source = firstBlock(await readFile(join(agentsDocs, 'http.md'), 'utf8'), 'js');
    const dir = await mkdtemp(join(tmpdir(), 'rigorrun-docs-agent-'));
    dirs.push(dir);
    await writeFile(join(dir, 'server.mjs'), source);
    const port = await freePort();
    const child = spawn(process.execPath, [join(dir, 'server.mjs')], {
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
    });
    children.push(child);
    const endpoint = `http://127.0.0.1:${port}`;

    const probe = await untilProbeAnswers(endpoint);
    expect(probe, JSON.stringify(probe)).toMatchObject({ ok: true });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: AGENT_PROTOCOL_V2,
        caseId: 'case_docs',
        task: { instruction: 'Do the job.', inputs: { recordId: 'R-1' }, policyBrief: '' },
        environment: { mcpUrl: 'http://127.0.0.1:1/mcp/x', expiresAt: new Date().toISOString() },
        maxSteps: 5,
      }),
    });
    const completion = CompletionSchema.safeParse(await response.json());
    expect(completion.success).toBe(true);
    expect(completion.success && completion.data.status).toBe('completed');
  });
});

describe('the driven-agent loop on the docs site', () => {
  it('uses the endpoints and fields the runner serves', async () => {
    const doc = await readFile(join(agentsDocs, 'driven.md'), 'utf8');
    expect(doc).toContain('/api/drive/');
    expect(doc).toContain('/finished');
    expect(doc).toContain('["waiting"]');
    expect(doc).toContain('"caseId"');
    expect(doc).toContain('"status"');
    expect(doc).not.toContain('"report"');
  });
});

describe('the ten-minute guide', () => {
  it('never tells anybody to point a benchmark file at an HTTP agent, which the CLI refuses', async () => {
    const doc = await readFile(join(repoDocs, 'CONNECT_AGENT_10_MINUTES.md'), 'utf8');
    expect(doc).not.toMatch(/--agent https?:\/\//);
    expect(doc).toContain(AGENT_PROTOCOL_V2);
  });
});
