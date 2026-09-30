/**
 * A credential handed over through the environment, for a CI job.
 *
 * A runner in CI has no keychain and nobody to type a value into one. The
 * documented way to hand it a credential is `RIGORRUN_SECRET__<NAME>`. The
 * store on the machine still wins, the value is still known to every scan for
 * leaked credentials, and it never travels into an exported project.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore, secretEnvName } from '../src/store.ts';

const roots: string[] = [];
const touched: string[] = [];

async function store(): Promise<ProjectStore> {
  const dir = await mkdtemp(join(tmpdir(), 'rigorrun-secret-env-'));
  roots.push(dir);
  process.env['RIGORRUN_SECRET_BACKEND'] = 'file';
  return new ProjectStore(dir);
}

function setEnv(name: string, value: string): void {
  touched.push(name);
  process.env[name] = value;
}

afterEach(async () => {
  for (const name of touched.splice(0)) delete process.env[name];
  delete process.env['RIGORRUN_SECRET_BACKEND'];
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('secrets from the environment', () => {
  it('names the variable predictably', () => {
    expect(secretEnvName('DESK_TOKEN')).toBe('RIGORRUN_SECRET__DESK_TOKEN');
    expect(secretEnvName('stripe-test.key')).toBe('RIGORRUN_SECRET__STRIPE_TEST_KEY');
  });

  it('reads a credential nobody stored, from its variable', async () => {
    const projects = await store();
    setEnv('RIGORRUN_SECRET__DESK_TOKEN', 'sk-from-ci');
    expect(await projects.secret('DESK_TOKEN')).toBe('sk-from-ci');
  });

  it('prefers the value stored on this machine', async () => {
    const projects = await store();
    await projects.setSecret('DESK_TOKEN', 'sk-stored');
    setEnv('RIGORRUN_SECRET__DESK_TOKEN', 'sk-from-ci');
    expect(await projects.secret('DESK_TOKEN')).toBe('sk-stored');
  });

  it('treats an empty variable as unset', async () => {
    const projects = await store();
    setEnv('RIGORRUN_SECRET__DESK_TOKEN', '');
    expect(await projects.secret('DESK_TOKEN')).toBeUndefined();
  });

  it('lets every leak scan see the value, without passing it off as a stored name', async () => {
    const projects = await store();
    setEnv('RIGORRUN_SECRET__DESK_TOKEN', 'sk-from-ci');
    expect(Object.values(await projects.secrets())).toContain('sk-from-ci');
    // A backup copies stored names only; the environment's values stay out of it.
    expect(await projects.secretNames()).toEqual([]);
    expect((await projects.secrets())['DESK_TOKEN']).toBeUndefined();
  });
});
