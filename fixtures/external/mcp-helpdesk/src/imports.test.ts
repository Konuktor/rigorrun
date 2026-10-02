import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

describe('fixture boundary', () => {
  it('imports nothing from RigorRun or from outside its own directory', async () => {
    const files = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.ts'));
    for (const file of files) {
      const source = await readFile(join(sourceDirectory, file), 'utf8');
      assert.doesNotMatch(source, /from\s+['"]@rigorrun\//, file);
      assert.doesNotMatch(source, /from\s+['"]\.\.\//, file);
    }
  });
});
