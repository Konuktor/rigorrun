/**
 * The packs this build ships, and the way into each one's own commands.
 *
 * A pack is a system RigorRun ships its own client for (see `pack.ts` in
 * `@rigorrun/environment`). Its records, its suite and its questions are its
 * own, so its setup commands are too: `rigorrun <pack> …` is handed to the
 * pack whole, before RigorRun's own argument parser has a chance to refuse a
 * flag only the pack understands.
 *
 * The list below is the only place a pack is named. Everything else in the
 * command line reaches a pack by the id a project stores, through the
 * registry, and knows nothing about what business it is for.
 */
import { getPack, hasPack, listPacks } from '@rigorrun/environment';
import { registerHelpdeskPack } from '@rigorrun/env-helpdesk';
import { registerStripePack } from '@rigorrun/env-stripe';

/**
 * One registration per pack this build includes, run once at startup.
 *
 * Static on purpose. A pack runs inside this process with the credentials it
 * is handed, so which packs exist is decided when RigorRun is built, never by
 * a file or a flag somebody passes in.
 */
const BUILT_IN: readonly (() => unknown)[] = [registerStripePack, registerHelpdeskPack];

let registered = false;

/** Registers every pack this build ships. Safe to call more than once. */
export function registerBuiltInPacks(): void {
  if (registered) return;
  registered = true;
  for (const register of BUILT_IN) register();
}

/**
 * Hands the whole command line to a pack, when its first word names one.
 *
 * Resolves to the pack's exit code, or to `undefined` when this is not a pack
 * command — the first word is a flag, one of RigorRun's own commands, or not a
 * registered pack with commands of its own. RigorRun's own commands always
 * win: a pack cannot take over `run` by choosing it as an id.
 */
export async function routeToPack(
  argv: readonly string[],
  ownCommands: ReadonlySet<string>,
): Promise<number | undefined> {
  const [first, ...rest] = argv;
  if (first === undefined || first.startsWith('-') || ownCommands.has(first)) return undefined;
  if (!hasPack(first)) return undefined;
  const pack = getPack(first);
  if (!pack.cli) return undefined;
  return pack.cli(rest);
}

/** The packs a person can address by name on the command line, for `--help`. */
export function packCommands(
  ownCommands: ReadonlySet<string>,
): { id: string; description: string }[] {
  return listPacks()
    .filter((pack) => pack.cli !== undefined && !ownCommands.has(pack.id))
    .map((pack) => ({ id: pack.id, description: pack.description }));
}
