/**
 * Where credentials rest, and what happens when the OS store is not there.
 *
 * The behaviour worth protecting is not "it uses the keychain" — it is that
 * RigorRun *knows* which one it used and says so. A tool that implies a
 * keychain and quietly writes a dotfile is worse than one that only ever wrote
 * the dotfile, because the person deciding whether to point it at staging made
 * their decision on the stronger claim.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore } from '../src/secrets.ts';

const roots: string[] = [];
async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rigorrun-secrets-'));
  roots.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('the secret store', () => {
  it('round-trips a value and forgets it when asked', async () => {
    const store = new SecretStore(await root());
    await store.set('DESK_TOKEN', 'sk-not-a-real-token');
    expect(await store.get('DESK_TOKEN')).toBe('sk-not-a-real-token');

    await store.remove('DESK_TOKEN');
    expect(await store.get('DESK_TOKEN')).toBeUndefined();
    expect(await store.names()).toEqual([]);
  });

  it('keeps names readable separately from values', async () => {
    const dir = await root();
    const store = new SecretStore(dir);
    await store.set('B_TOKEN', 'b');
    await store.set('A_TOKEN', 'a');

    // Sorted, and a plain file: `rigorrun secrets list` and "this project needs
    // a credential you have not set" both have to work when the OS store is
    // locked, which is exactly when somebody needs to be told what is missing.
    expect(await store.names()).toEqual(['A_TOKEN', 'B_TOKEN']);
    const index = await readFile(join(dir, 'secrets.index.json'), 'utf8');
    expect(index).toContain('A_TOKEN');
    expect(index).not.toContain('"a"');
  });

  it('says which store it is actually using, in a sentence', async () => {
    const info = await new SecretStore(await root()).backendInfo();
    // Pinned to the file backend for tests; what matters is that the answer is
    // specific enough to act on rather than a reassuring adjective.
    expect(info.kind).toBe('file');
    expect(info.detail).toMatch(/only you can read/);
    expect(info.detail).toMatch(/backup tool|sync client/);
  });

  it('writes the fallback file so only its owner can read it', async () => {
    const dir = await root();
    await new SecretStore(dir).set('DESK_TOKEN', 'sk-not-a-real-token');
    expect((await stat(join(dir, 'secrets.json'))).mode & 0o777).toBe(0o600);
  });

  it('still finds credentials written before there was an index', async () => {
    const dir = await root();
    // A workspace from an earlier RigorRun: values in the file, no index.
    const { writeJsonAtomic } = await import('../src/atomic.ts');
    await writeJsonAtomic(join(dir, 'secrets.json'), { OLD_TOKEN: 'still-here' });

    const store = new SecretStore(dir);
    expect(await store.names()).toEqual(['OLD_TOKEN']);
    expect(await store.get('OLD_TOKEN')).toBe('still-here');
  });

  it('never returns a value for a name nobody set', async () => {
    expect(await new SecretStore(await root()).get('NOT_SET')).toBeUndefined();
  });
});
