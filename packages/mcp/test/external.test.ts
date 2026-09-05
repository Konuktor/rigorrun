/**
 * The dogfood fixtures have to stay somebody else's code.
 *
 * The whole value of pointing RigorRun at `fixtures/external` is that it is not
 * RigorRun. The instant one of those files imports a `@rigorrun/*` package, the
 * test stops proving that a stranger's system works and starts proving that our
 * own does — and it would happen the way these things always happen, by
 * somebody reaching for a helper that was right there.
 */
import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const externalDir = fileURLToPath(new URL('../../../fixtures/external/', import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) found.push(path);
  }
  return found;
}

describe('fixtures/external', () => {
  it('exists and contains something', async () => {
    const files = await sourceFiles(externalDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports nothing from RigorRun', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(externalDir)) {
      const source = await readFile(file, 'utf8');
      if (source.includes('@rigorrun/')) {
        offenders.push(file.slice(externalDir.length));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is not reachable from RigorRun’s own dependency graph', async () => {
    // The inverse direction: no product package may depend on a fixture, which
    // would make the fixture load-bearing and quietly turn it into a demo.
    const packagesDir = fileURLToPath(new URL('../../', import.meta.url));
    const offenders: string[] = [];
    for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(packagesDir, entry.name, 'package.json');
      const source = await readFile(manifest, 'utf8').catch(() => '');
      if (source.includes('venue-desk') || source.includes('fixtures/external')) {
        offenders.push(entry.name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
