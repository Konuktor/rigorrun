/**
 * Filesystem access for the CLI.
 *
 * Every path a user supplies is resolved and checked before anything is read
 * or written, so a downloaded benchmark or trace can never talk RigorRun into
 * touching a file outside the working directory.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 2,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** Where RigorRun keeps local artefacts. Private, gitignored, never uploaded. */
export function workspaceDir(): string {
  return resolve(process.cwd(), '.rigorrun');
}

/**
 * Resolves a user-supplied path. Relative paths that climb out of the working
 * directory are refused outright; absolute paths are allowed only because the
 * operator typed them, and never come from file contents.
 */
export function safePath(input: string, { allowAbsolute = true } = {}): string {
  const resolved = resolve(process.cwd(), input);
  if (isAbsolute(input) && !allowAbsolute) {
    throw new CliError(`Absolute paths are not allowed here: ${input}`);
  }
  if (!isAbsolute(input)) {
    const rel = relative(process.cwd(), resolved);
    if (rel === '..' || rel.startsWith(`..${'/'}`)) {
      throw new CliError(`Refusing to use a path outside the working directory: ${input}`);
    }
  }
  return resolved;
}

export async function readJson<T>(path: string): Promise<T> {
  const full = safePath(path);
  let raw: string;
  try {
    raw = await readFile(full, 'utf8');
  } catch {
    throw new CliError(`Cannot read ${path}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new CliError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

export async function writeJson(path: string, value: unknown): Promise<string> {
  const full = safePath(path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return full;
}

export async function writeText(path: string, text: string): Promise<string> {
  const full = safePath(path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text, 'utf8');
  return full;
}
