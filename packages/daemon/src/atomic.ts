/**
 * Writing a file in a way that survives the machine dying mid-write.
 *
 * The product's central promise is that closing the laptop does not cost
 * somebody the twenty minutes they spent connecting a system and teaching it a
 * job. `writeFile` does not keep that promise: it truncates the target first
 * and then streams into it, so a crash, a full disk or a `kill -9` at the wrong
 * moment leaves a project file that is half a project. The reader then throws,
 * and — before this — the project silently vanished from the list.
 *
 * The sequence below is the standard one, and every step earns its line:
 *
 *   1. write to a temporary name in the *same directory*, so the rename is
 *      within one filesystem and therefore atomic;
 *   2. `fsync` the file before closing it. Without this the rename can be
 *      durable while the bytes are not, which produces an atomically-renamed
 *      empty file — strictly worse than the truncation it was meant to prevent;
 *   3. `rename` over the target. POSIX makes this atomic: a concurrent reader
 *      sees either the whole old file or the whole new one, never a mixture;
 *   4. `fsync` the directory, so the rename itself survives a power cut.
 *
 * Step 4 fails on Windows, which does not allow opening a directory as a file.
 * That is the platform's limit rather than a bug here: Windows still gets the
 * atomicity of step 3, and loses only the durability of the rename across a
 * power cut. It is swallowed rather than reported for that reason.
 */
import { chmod, open, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, basename, join } from 'node:path';

/** Files only the owner may read. Credentials and customer data both qualify. */
export const OWNER_ONLY = 0o600;

export async function writeJsonAtomic(
  path: string,
  value: unknown,
  mode: number = OWNER_ONLY,
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  const temporary = join(dir, `.${basename(path)}.tmp-${randomBytes(6).toString('hex')}`);
  // Serialise before opening anything. A value that cannot be stringified — a
  // cycle, a `toJSON` that throws — must fail with the previous file intact,
  // not with a truncated one and an empty temporary beside it.
  const body = `${JSON.stringify(value, null, 2)}\n`;

  let handle;
  try {
    handle = await open(temporary, 'wx', mode);
    await handle.writeFile(body, 'utf8');
    await handle.sync();
  } finally {
    await handle?.close();
  }

  try {
    // Set explicitly as well as at creation: an existing target's permissions
    // are irrelevant now that it is being replaced, but a restrictive umask
    // could still have narrowed ours, and a *widened* one must not survive.
    await chmod(temporary, mode).catch(() => undefined);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }

  await syncDirectory(dir);
}

async function syncDirectory(dir: string): Promise<void> {
  let handle;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // Windows. See the note at the top of this file.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Clears temporary files a crash left behind.
 *
 * They are invisible (dot-prefixed) and harmless, but a directory that
 * accumulates them for a year is a support conversation, and their presence is
 * the only evidence that a write was interrupted. Run at workspace open, when
 * nothing else is writing.
 */
export async function sweepTemporaries(dir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  let swept = 0;
  for (const entry of entries) {
    if (!/^\..*\.tmp-[0-9a-f]{12}$/.test(entry)) continue;
    await rm(join(dir, entry), { force: true });
    swept += 1;
  }
  return swept;
}
