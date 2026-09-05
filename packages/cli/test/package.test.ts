/**
 * The published package, checked before anybody else has to find out.
 *
 * Every failure this guards against has the same shape: it works here and
 * breaks on a stranger's machine, which is the most expensive place to
 * discover anything. A dependency that is bundled *and* declared is dead
 * weight; one that is neither is a module-not-found on first run. A workspace
 * package left in `dependencies` cannot be installed by anybody at all,
 * because none of them are on npm.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));

async function manifest(): Promise<{
  name: string;
  version: string;
  private?: boolean;
  bin: Record<string, string>;
  files: string[];
  engines: { node: string };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  description: string;
  license: string;
}> {
  return JSON.parse(await readFile(`${here}package.json`, 'utf8')) as never;
}

async function workspaceManifest(): Promise<{ name: string }> {
  return JSON.parse(
    await readFile(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
  ) as never;
}

describe('what gets published', () => {
  it('does not share a name with the workspace that builds it', async () => {
    // Both were called `rigorrun` for about an hour. `pnpm -F rigorrun build`
    // matched both, so building the package invoked the root build, which
    // invoked the package build, forever. It presented as a slow build, which
    // is the worst way for a bug to present.
    expect((await workspaceManifest()).name).not.toBe((await manifest()).name);
  });

  it('is publishable at all', async () => {
    const pkg = await manifest();
    expect(pkg.name).toBe('rigorrun');
    // `private: true` is npm's own safety catch against publishing by accident.
    // It has to be gone, which means everything else here has to be right.
    expect(pkg.private).toBeUndefined();
    expect(pkg.license).toBeTruthy();
    expect(pkg.description.length).toBeGreaterThan(40);
  });

  it('reports the version it actually is', async () => {
    const pkg = await manifest();
    const help = await readFile(`${here}src/help.ts`, 'utf8');
    // `--version`, every feedback bundle and every run artefact carry this. A
    // stale value is a support conversation about the wrong release.
    expect(help).toContain(`export const VERSION = '${pkg.version}'`);
  });

  it('is a prerelease, and says so in its version', async () => {
    const pkg = await manifest();
    // Nobody should install this by typing `npm i rigorrun` and expecting
    // something finished. A prerelease tag is not the default `latest`.
    expect(pkg.version).toMatch(/-(alpha|beta|rc)\.\d+$/);
  });

  it('ships only what running it needs', async () => {
    const pkg = await manifest();
    expect(pkg.files.sort()).toEqual(['LICENSE', 'README.md', 'bin/', 'dist/', 'ui/']);
    // No `src/`, no `test/`, no fixtures. A published package that carries its
    // own test fixtures is one whose fixtures somebody will end up depending on.
    for (const entry of pkg.files) {
      expect(entry).not.toMatch(/^(src|test|fixtures)/);
    }
  });

  it('declares no workspace package a consumer would have to install', async () => {
    const pkg = await manifest();
    for (const name of Object.keys(pkg.dependencies)) {
      expect(name.startsWith('@rigorrun/'), `${name} cannot be installed by anybody`).toBe(false);
    }
    for (const range of Object.values(pkg.dependencies)) {
      expect(range).not.toContain('workspace:');
    }
    // They belong in devDependencies: every one is bundled into dist at build
    // time, and npm does not install devDependencies for consumers.
    expect(Object.keys(pkg.devDependencies).every((name) => name.startsWith('@rigorrun/'))).toBe(
      true,
    );
  });

  it('declares exactly the dependencies the build leaves external', async () => {
    // The two lists are written in different files and mean the same thing.
    // Either half drifting is a module-not-found on first run.
    const build = await readFile(`${here}build.mjs`, 'utf8');
    const external = [...build.matchAll(/'(@?[a-z0-9@/-]+)'/g)]
      .map((match) => match[1]!)
      .filter((name) => /^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(name) && !name.startsWith('node:'));

    const declared = Object.keys((await manifest()).dependencies).sort();
    for (const name of declared) {
      expect(external, `${name} is declared but not left external by the build`).toContain(name);
    }
    expect(declared).toEqual(['@hono/node-server', '@modelcontextprotocol/sdk', 'hono', 'zod']);
  });

  it('names the Node it needs, in both places that matter', async () => {
    const pkg = await manifest();
    expect(pkg.engines.node).toBe('>=20.11');

    // `engines` produces a warning npm prints and nobody reads. The shim is
    // what actually stops an old runtime, so it has to agree.
    const shim = await readFile(`${here}bin/rigorrun.mjs`, 'utf8');
    expect(shim).toContain('var MINIMUM = [20, 11]');
  });
});

describe('the executable shim', () => {
  it('avoids syntax an old Node could not parse', async () => {
    // The whole point of the shim is to produce a sentence rather than a
    // syntax error on a runtime too old to run the bundle. Anything modern in
    // here defeats it, because the parse happens before the check runs.
    const shim = await readFile(`${here}bin/rigorrun.mjs`, 'utf8');
    const code = shim.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\?\./);
    expect(code).not.toMatch(/\?\?/);
    expect(code).not.toMatch(/\bconst\b|\blet\b/);
    expect(code).not.toMatch(/=>/);
    // The bundle is reached only after the check, by dynamic import.
    expect(code).toContain("import('../dist/rigorrun.mjs')");
  });

  it('tells somebody what to do rather than what went wrong', async () => {
    const shim = await readFile(`${here}bin/rigorrun.mjs`, 'utf8');
    expect(shim).toContain('nodejs.org');
    expect(shim).toContain('nvm install');
    expect(shim).toContain('fnm install');
    // Exit 2: a configuration problem, never confused with an agent failing.
    expect(shim).toContain('process.exit(2)');
  });
});

describe('the README a stranger reads on npm', () => {
  it('leads with the one command, and it is the one that works', async () => {
    const readme = await readFile(`${here}README.md`, 'utf8');
    expect(readme).toContain('npx rigorrun');
    expect(readme).not.toContain('pnpm install');
    expect(readme).not.toContain('git clone');
  });

  it('says it is an alpha, and what it does not do', async () => {
    const readme = await readFile(`${here}README.md`, 'utf8');
    expect(readme).toMatch(/alpha/i);
    expect(readme).toMatch(/no OpenAPI, no browser/i);
  });
});
