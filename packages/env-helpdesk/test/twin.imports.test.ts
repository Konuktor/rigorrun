import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const twinDirectory = fileURLToPath(new URL('../src/twin/', import.meta.url));

describe('twin boundary', () => {
  it('imports nothing from RigorRun', async () => {
    const files = (await readdir(twinDirectory)).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(join(dirname(join(twinDirectory, file)), file), 'utf8');
      expect(source, file).not.toMatch(/from\s+['"]@rigorrun\//);
    }
  });
});
