/**
 * Documentation that cannot quietly stop being true.
 *
 * Every command, flag, protocol string and path in the docs is a promise, and
 * the cheapest way to break one is to rename something and not notice. This
 * reads the docs and checks the claims against the code, so a rename fails a
 * test rather than a stranger's first ten minutes.
 *
 * It deliberately does *not* try to prove the prose is good. It proves the
 * parts a machine can check are not lies.
 */
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AGENT_PROTOCOL_V2 } from '@rigorrun/agent-sdk';
import { HELP } from '../../cli/src/help.ts';
import { DEFAULT_ROOT } from '../src/store.ts';

const docsDir = fileURLToPath(new URL('../../../docs/', import.meta.url));
const read = (name: string): Promise<string> => readFile(join(docsDir, name), 'utf8');

/** Commands the docs tell people to run, and where they are claimed. */
const DOCUMENTED_COMMANDS = [
  'rigorrun projects',
  'rigorrun run --project',
  'rigorrun gate --project',
  'rigorrun compare-runs --project',
  'rigorrun secret set',
  'rigorrun secret list',
  'rigorrun doctor',
  'rigorrun feedback export',
];

describe('the commands the docs promise', () => {
  it('are all in the help text', () => {
    for (const command of DOCUMENTED_COMMANDS) {
      const verb = command.replace(/^rigorrun /, '').split(' ')[0]!;
      expect(HELP, `${command} is documented but not in --help`).toContain(verb);
    }
  });

  it('are the ones the docs actually mention', async () => {
    const ci = await read('CI.md');
    for (const command of ['rigorrun projects', 'rigorrun run --project', 'rigorrun gate --project']) {
      expect(ci).toContain(command);
    }
  });

  it('never tell anybody to run an agent id that no longer exists', async () => {
    // These were renamed once and the docs kept recommending them for months,
    // including in a CI job that was failing while being reported as green.
    //
    // Matched on *invocations* rather than mentions: the audit describes this
    // bug, and a test that forbade naming a past mistake would be a test that
    // pushed the history out of the documentation.
    const invocation = /^\s*(?:\$ )?(?:pnpm )?rigorrun .*--agent (demo-weak|demo-robust)\b/m;
    for (const name of await readdir(docsDir)) {
      if (!name.endsWith('.md')) continue;
      const found = invocation.exec(await read(name));
      expect(found?.[0], `${name} tells somebody to run a removed agent id`).toBeUndefined();
    }
  });
});

describe('the protocol the docs describe', () => {
  it('is the string the SDK actually requires', async () => {
    const doc = await read('HTTP_AGENT.md');
    expect(doc).toContain(AGENT_PROTOCOL_V2);
    expect(AGENT_PROTOCOL_V2).toBe('rigorrun/agent/2');
  });

  it('documents the probe exactly as the SDK answers it', async () => {
    const doc = await read('HTTP_AGENT.md');
    expect(doc).toContain('"probe": true');
    expect(doc).toContain('"ok": true');
  });
});

describe('the paths the docs promise', () => {
  it('name the directory the store actually uses', async () => {
    const ci = await read('CI.md');
    expect(DEFAULT_ROOT.endsWith('.rigorrun')).toBe(true);
    for (const path of ['secrets.json', 'project.json', 'benchmark.json', 'runs/']) {
      expect(ci, `CI.md describes ${path}`).toContain(path);
    }
  });
});

describe('what the docs do not claim', () => {
  it('does not document a connector that is not built', async () => {
    // Writing OPENAPI_ENVIRONMENT.md, BROWSER_ENVIRONMENT.md, CLI_AGENT.md or
    // PYTHON_AGENT_SDK.md before those exist would be the exact kind of
    // breadth this product reset was called to remove. When one is built, its
    // doc arrives with it and this list shrinks.
    const names = await readdir(docsDir);
    for (const forbidden of [
      'OPENAPI_ENVIRONMENT.md',
      'BROWSER_ENVIRONMENT.md',
      'CLI_AGENT.md',
      'PYTHON_AGENT_SDK.md',
    ]) {
      expect(names, `${forbidden} exists; does the feature?`).not.toContain(forbidden);
    }
  });

  it('says plainly that this is an alpha, and what that means', async () => {
    // It used to say "not published yet", which stopped being true. What has
    // to stay true is that nobody thinks they are installing something
    // finished.
    const started = await read('GETTING_STARTED.md');
    expect(started).toMatch(/\*\*Alpha\.\*\*/);
    expect(started).toMatch(/not tagged `latest`/);
  });

  it('tells a stranger to install the prerelease, not whatever is on latest', async () => {
    // `npx rigorrun` would install `latest`, which this is deliberately not.
    // Somebody following the docs must get the thing the docs describe.
    const started = await read('GETTING_STARTED.md');
    expect(started).toContain('npx rigorrun@alpha');

    const protocol = await read('THIRD_PARTY_DOGFOOD.md');
    expect(protocol).toContain('npx rigorrun@alpha');
  });

  it('promises the feedback bundle keeps a stranger’s data out of it', async () => {
    // This is the promise on which somebody decides whether to send us a file
    // from a machine with their production credentials on it.
    const started = await read('GETTING_STARTED.md');
    expect(started).toMatch(/no credentials, no\s+tool arguments, no results/);
  });

  it('offers both ways in, and both leave somebody with an interface', async () => {
    // A clean clone following the README used to get a runner that came up
    // saying "the interface is not built". The API worked, which made it worse
    // rather than better: the first thing a person saw was a dead end with a
    // working service behind it.
    const manifest = JSON.parse(
      await readFile(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts['start'], 'the documented first command must exist').toBeTruthy();
    expect(manifest.scripts['start']).toContain('build:web');
    expect(manifest.scripts['start']).toContain('rigorrun');

    const readme = await readFile(
      fileURLToPath(new URL('../../../README.md', import.meta.url)),
      'utf8',
    );
    // The one anybody without this repository uses...
    expect(readme).toContain('npx rigorrun@alpha');
    // ...and the one for somebody who has it. `pnpm rigorrun` alone would
    // leave them with a working API and no interface.
    expect(readme).toContain('pnpm install && pnpm start');
  });
});

describe('every doc the getting-started page links to', () => {
  it('exists', async () => {
    const body = await read('GETTING_STARTED.md');
    const links = [...body.matchAll(/\]\(([A-Z_]+\.md)\)/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThan(4);
    const names = await readdir(docsDir);
    for (const link of new Set(links)) {
      expect(names, `GETTING_STARTED.md links to ${link}`).toContain(link);
    }
  });
});
