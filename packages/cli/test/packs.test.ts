/**
 * `rigorrun <pack> …`: the command line handed to a pack whole.
 *
 * A pack's commands are the pack's, flags included, so the route has to run
 * before RigorRun's own parser would refuse a flag it has never heard of. And
 * RigorRun's own commands must always win: a pack cannot take over `run` by
 * choosing it as its id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { clearPacks, registerPack, type PackDefinition } from '@rigorrun/environment';
import { OWN_COMMANDS, main } from '../src/main.ts';
import { packCommands, routeToPack } from '../src/packs.ts';

const SCHEMA: PackDefinition['schema'] = {
  entities: [
    {
      name: 'Record',
      idField: 'id',
      mutable: false,
      appendOnly: false,
      fields: [{ name: 'id', type: 'string', nullable: false, role: 'identifier' }],
    },
  ],
  relationships: [],
};

function pack(id: string, cli?: (argv: string[]) => Promise<number>): PackDefinition {
  return {
    id,
    name: `Pack ${id}`,
    description: `A pack called ${id}, for this test only.`,
    schema: SCHEMA,
    open: () => Promise.reject(new Error('never opened here')),
    describeAction: () => 'nothing',
    ...(cli ? { cli } : {}),
  };
}

async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  try {
    return { code: await main(args), out, err };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

afterEach(() => clearPacks());

describe('routing to a pack', () => {
  it('hands everything after the pack’s id to the pack, flags it alone understands included', async () => {
    const seen: string[][] = [];
    registerPack(
      pack('items', async (argv) => {
        seen.push(argv);
        return 7;
      }),
    );
    const { code } = await cli('items', 'init', '--only-this-pack-knows', 'x');
    expect(code).toBe(7);
    expect(seen).toEqual([['init', '--only-this-pack-knows', 'x']]);
  });

  it('turns a pack command that throws into exit 2, like any other failure', async () => {
    registerPack(pack('items', () => Promise.reject(new Error('the pack could not start'))));
    const { code, err } = await cli('items');
    expect(code).toBe(2);
    expect(err).toContain('the pack could not start');
  });

  it('never lets a pack take over one of RigorRun’s own commands', async () => {
    const seen: string[][] = [];
    registerPack(
      pack('run', async (argv) => {
        seen.push(argv);
        return 0;
      }),
    );
    expect(await routeToPack(['run', '--help'], OWN_COMMANDS)).toBeUndefined();
    const { code } = await cli('run', '--help');
    expect(code).toBe(0);
    expect(seen).toEqual([]);
  });

  it('is not a route when the first word is a flag, an unknown word, or a pack with no commands', async () => {
    registerPack(pack('quiet-pack'));
    expect(await routeToPack(['--json', 'items'], OWN_COMMANDS)).toBeUndefined();
    expect(await routeToPack(['nothing-registered'], OWN_COMMANDS)).toBeUndefined();
    expect(await routeToPack(['quiet-pack'], OWN_COMMANDS)).toBeUndefined();
    const { code, err } = await cli('quiet-pack');
    expect(code).toBe(2);
    expect(err).toContain('Unknown command "quiet-pack"');
  });

  it('lists the packs a person can address in --help', async () => {
    registerPack(pack('items', async () => 0));
    registerPack(pack('quiet-pack'));
    expect(packCommands(OWN_COMMANDS).map((entry) => entry.id)).toEqual(['items']);
    const { out } = await cli('--help');
    expect(out).toContain('PACKS IN THIS BUILD');
    expect(out).toContain('A pack called items, for this test only.');
    expect(out).not.toContain('quiet-pack');
  });
});

describe('RigorRun’s own commands', () => {
  it('are every command the dispatcher answers to, so none can be shadowed by a pack', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../src/main.ts', import.meta.url)),
      'utf8',
    );
    const dispatched = [...source.matchAll(/^\s*case '([a-z-]+)':/gm)].map((match) => match[1]!);
    expect(dispatched.length).toBeGreaterThan(20);
    for (const command of dispatched) expect(OWN_COMMANDS.has(command), command).toBe(true);
  });
});
