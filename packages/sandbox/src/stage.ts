/**
 * Getting a target onto disk, and into an image, without running any of it.
 *
 * Two properties are load-bearing here, and both are about *when* somebody
 * else's code is allowed to execute.
 *
 * **Installing runs nothing.** `npm install --ignore-scripts` is not a
 * hardening option, it is the whole point: a `postinstall` on an untrusted
 * package is arbitrary code running as the operator, on the host, before any
 * container exists. If a package genuinely needs a build step, that is said out
 * loud and the run stops, rather than quietly executing it.
 *
 * **Building runs nothing.** The generated Dockerfile contains no `RUN`
 * instruction at all, so there is no point during image construction at which
 * the target's own code can execute. That is a property worth a test, and there
 * is one.
 *
 * The container gets no network, so everything the target will ever need has to
 * be here before it starts. That is why the fetch happens on the host and the
 * tree is copied in, rather than the container installing anything itself.
 */
import { mkdir, mkdtemp, readdir, rm, writeFile, cp, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashValue, sha256 } from '@rigorrun/core';
import { runCommand } from '@rigorrun/exec';

export class StageError extends Error {}

/**
 * The base image, pinned by digest at run time.
 *
 * The tag is what a person types; the digest is what the record says. A record
 * baselined against a tag is not a baseline, because the tag moves.
 */
export const BASE_IMAGE_TAG = 'node:20-alpine';

/**
 * Copies the read-only tree onto the writable mount, then runs the server from
 * there.
 *
 * This exists because of a real and easily-missed failure: a server that keeps
 * its data file next to its own code — which the reference target does — cannot
 * start at all under a read-only root filesystem. Copying first means the
 * server writes where it expects to, and every one of those writes lands
 * somewhere RigorRun can read.
 *
 * It writes nothing to stdout, because stdout is the MCP channel.
 *
 * `cp -R`, not `cp -a`. Preserving ownership needs CAP_CHOWN, and we drop every
 * capability there is — so `-a` fails on the first file and, under `set -e`,
 * the server never starts at all. The image already stores the tree owned by
 * the unprivileged user it runs as, so there is nothing to preserve.
 */
const ENTRYPOINT = `#!/bin/sh
set -e
mkdir -p /work/target
cp -R /opt/rigorrun-target-src/. /work/target/
cd /work/target
exec node "$@"
`;

/**
 * One sorted line per file under the writable mounts: digest, then path.
 *
 * `-exec ... +` rather than a shell loop calling `sha256sum` once per file.
 * A server's dependency tree is a few thousand files and spawning a process
 * for each of them turned a state reading into tens of seconds, which is paid
 * four times per tool. Batching makes it one process per few thousand files.
 *
 * Deliberately not \`docker diff\`. Under a read-only root filesystem every
 * write lands on a tmpfs mount, and \`docker diff\` reports only the container
 * layer — so it would come back empty and look exactly like proof that nothing
 * was written. That failure would manufacture a false clean verdict for every
 * tool, which is the worst thing this harness could do.
 */
const STATEDUMP = `#!/bin/sh
find /work /tmp -type f -exec sha256sum {} + 2>/dev/null | LC_ALL=C sort -k2
`;

/**
 * Every process alive in the container, by command line.
 *
 * Catches a tool that claims to be read-only and forks a helper to do the
 * writing. A process that came and went between two readings is invisible
 * here, which is why this surface is observational rather than complete.
 */
const PSLIST = `#!/bin/sh
for entry in /proc/[0-9]*; do
  tr '\\0' ' ' < "$entry/cmdline" 2>/dev/null
  echo
done
`;

export interface StagedTarget {
  /** The build context. Contains tree/, the scripts, and the Dockerfile. */
  dir: string;
  /** Everything installed, hashed. Moves when a transitive dependency moves. */
  treeDigest: string;
  /** The target's own bytes, for a directory. Empty for a published package. */
  contentDigest: string;
  /** Path inside the container of the module to run. */
  entryModule: string;
  cleanup: () => Promise<void>;
}

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rigorrun-stage-'));
}

/** Where a package's `bin` points, or its main. Read, never guessed. */
async function entryPointOf(treeDir: string, packageName: string): Promise<string> {
  const manifestPath = join(treeDir, 'node_modules', packageName, 'package.json');
  let manifest: { bin?: unknown; main?: unknown };
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest;
  } catch {
    throw new StageError(
      `${packageName} did not install a package.json, so RigorRun cannot tell what to run.`,
    );
  }

  let relative: string | undefined;
  if (typeof manifest.bin === 'string') relative = manifest.bin;
  else if (manifest.bin && typeof manifest.bin === 'object') {
    const entries = Object.values(manifest.bin as Record<string, unknown>);
    const first = entries.find((v): v is string => typeof v === 'string');
    relative = first;
  }
  if (!relative && typeof manifest.main === 'string') relative = manifest.main;

  if (!relative) {
    throw new StageError(
      `${packageName} declares neither a bin nor a main, so there is nothing to start.`,
    );
  }
  return `/work/target/node_modules/${packageName}/${relative.replace(/^\.\//, '')}`;
}

async function writeContext(dir: string, entryModule: string): Promise<void> {
  const entry = join(dir, 'rigorrun-entrypoint');
  const dump = join(dir, 'rigorrun-statedump');
  const ps = join(dir, 'rigorrun-pslist');
  await writeFile(entry, ENTRYPOINT, 'utf8');
  await writeFile(dump, STATEDUMP, 'utf8');
  await writeFile(ps, PSLIST, 'utf8');
  await chmod(entry, 0o555);
  await chmod(dump, 0o555);
  await chmod(ps, 0o555);

  // No RUN. Nothing the target ships can execute while this is built.
  await writeFile(
    join(dir, 'Dockerfile'),
    [
      `FROM ${BASE_IMAGE_TAG}`,
      // Owned by the user the container runs as, so copying it onto the
      // writable mount needs no privilege the container does not have.
      'COPY --chown=65532:65532 tree/ /opt/rigorrun-target-src/',
      'COPY rigorrun-entrypoint /rigorrun/entrypoint',
      'COPY rigorrun-statedump /rigorrun/statedump',
      'COPY rigorrun-pslist /rigorrun/pslist',
      'USER 65532:65532',
      'ENTRYPOINT ["/rigorrun/entrypoint"]',
      `CMD ["${entryModule}"]`,
      '',
    ].join('\n'),
    'utf8',
  );
}

/**
 * A content digest over a directory: every file's path and its bytes.
 *
 * This exists because the first version of it did not, and the bug it caused is
 * worth recording. `dir:` targets were digested by their dependency closure
 * alone, so two servers with the same dependencies got the same digest even
 * when their source differed — which silently broke the one promise the record
 * makes, that evidence is about a specific artifact. A digest that does not
 * change when the code changes is not an identity.
 */
async function digestOfDirectory(sourceDir: string): Promise<string> {
  const entries: Array<readonly [string, string]> = [];

  const walk = async (dir: string, prefix: string): Promise<void> => {
    const listing = await readdir(dir, { withFileTypes: true });
    for (const item of listing.sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name === 'node_modules' || item.name === '.git') continue;
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      const full = join(dir, item.name);
      if (item.isDirectory()) await walk(full, relative);
      else if (item.isFile()) entries.push([relative, await sha256(await readFile(full, 'utf8'))]);
    }
  };

  await walk(sourceDir, '');
  return hashValue(entries);
}

/** Hashes the resolved closure, so a moved transitive dependency is visible. */
async function digestOfTree(treeDir: string): Promise<string> {
  try {
    const lock = JSON.parse(await readFile(join(treeDir, 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, { integrity?: string; version?: string; resolved?: string }>;
    };
    const entries = Object.entries(lock.packages ?? {})
      .map(([path, meta]) => [path, meta.integrity ?? meta.version ?? ''] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return hashValue(entries);
  } catch {
    return '';
  }
}

/**
 * Installs a published package into a scratch tree, running none of it.
 *
 * The tarball has already been fetched and checked against the registry's
 * digest by the caller; npm re-fetches from its own cache or the registry, and
 * would fail the same integrity check itself, so the bytes that run are the
 * bytes that were measured.
 */
export async function stageNpmPackage(
  packageName: string,
  version: string,
): Promise<StagedTarget> {
  const dir = await scratch();
  const treeDir = join(dir, 'tree');
  await mkdir(treeDir, { recursive: true });
  await writeFile(
    join(treeDir, 'package.json'),
    JSON.stringify({ name: 'rigorrun-target', private: true, version: '0.0.0' }, null, 2),
    'utf8',
  );

  const install = await runCommand({
    command: 'npm',
    args: [
      'install',
      `${packageName}@${version}`,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--omit=dev',
      '--prefix',
      treeDir,
    ],
    timeoutMs: 600_000,
    provenance: 'rigorrun-internal',
  });

  if (install.code !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new StageError(
      `Installing ${packageName}@${version} failed.\n${install.stderr.trim() || install.stdout.trim()}`,
    );
  }

  const entryModule = await entryPointOf(treeDir, packageName);
  await writeContext(dir, entryModule);

  return {
    dir,
    treeDigest: await digestOfTree(treeDir),
    contentDigest: '',
    entryModule,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Stages a directory on this machine.
 *
 * Its declared dependencies are installed fresh rather than reused from a
 * workspace, because a pnpm store is a farm of symlinks that would not survive
 * being copied into an image.
 */
export async function stageDirectory(sourceDir: string): Promise<StagedTarget> {
  const dir = await scratch();
  const treeDir = join(dir, 'tree');
  await mkdir(treeDir, { recursive: true });

  const manifest = JSON.parse(
    await readFile(join(sourceDir, 'package.json'), 'utf8'),
  ) as { name?: string; dependencies?: Record<string, string>; bin?: unknown; main?: unknown };
  const name = manifest.name;
  if (!name) throw new StageError(`${sourceDir} has no package name.`);

  // Dependencies first. npm prunes anything under node_modules that its own
  // manifest does not account for, so a package copied in beforehand is
  // deleted by the install that was meant to support it.
  const deps = Object.entries(manifest.dependencies ?? {});
  await writeFile(
    join(treeDir, 'package.json'),
    JSON.stringify(
      {
        name: 'rigorrun-target',
        private: true,
        version: '0.0.0',
        ...(deps.length > 0 ? { dependencies: manifest.dependencies } : {}),
      },
      null,
      2,
    ),
    'utf8',
  );

  if (deps.length > 0) {
    const install = await runCommand({
      command: 'npm',
      args: ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--prefix', treeDir],
      timeoutMs: 600_000,
      provenance: 'rigorrun-internal',
    });
    if (install.code !== 0) {
      await rm(dir, { recursive: true, force: true });
      throw new StageError(
        `Installing dependencies for ${sourceDir} failed.\n${install.stderr.trim()}`,
      );
    }
  }

  // Then the package itself, which npm knows nothing about.
  const packageDir = join(treeDir, 'node_modules', name);
  await mkdir(packageDir, { recursive: true });
  await cp(sourceDir, packageDir, {
    recursive: true,
    filter: (src) => !src.includes('node_modules'),
  });

  const entryModule = await entryPointOf(treeDir, name);
  await writeContext(dir, entryModule);

  return {
    dir,
    treeDigest: await digestOfTree(treeDir),
    contentDigest: await digestOfDirectory(sourceDir),
    entryModule,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
