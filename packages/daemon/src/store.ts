/**
 * Where a project lives on disk, and what never leaves it.
 *
 * `~/.rigorrun` by default, one directory per project. The layout is chosen so
 * that the sensitive material is in files somebody has to open on purpose
 * rather than fields somebody has to remember to strip:
 *
 *     ~/.rigorrun/
 *       workspace.json               the on-disk format version
 *       activation.jsonl             stages reached and how long they took
 *       secrets.json                 0600, every credential, never synced
 *       projects/<id>/
 *         project.json               metadata, connector shape, run summaries
 *         discovery.json             the tools this system published, last time
 *         demonstration.json         a recording in progress, so a reload resumes
 *         induced.json               the records worked out, and what was asked
 *         schema.json                the confirmed records
 *         trace.json                 the recorded demonstration
 *         contract.json              the compiled contract
 *         benchmark.json             the generated suite, with its private checks
 *         runs/<runId>.json          full results, including tool arguments
 *
 * Everything but `project.json` and `runs/` is an *artefact*: written whole,
 * read whole, and safe to delete at the cost of repeating one step. That is
 * what makes a reload survivable — the interface reads them back rather than
 * holding the only copy in a browser tab.
 *
 * Two of those are worth calling out. `benchmark.json` holds the assertions an
 * agent is judged against, so it is exactly the file that must never be served
 * to an agent — it is on disk next to everything else and reaches the runner by
 * a path the agent has no route to. And `runs/*.json` holds real tool
 * arguments, which is customer data; publishing goes through the sanitiser or
 * not at all.
 */
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseProject, type Project } from './project.ts';

export const DEFAULT_ROOT = join(homedir(), '.rigorrun');

/** Files only the owner may read. Credentials and customer data both qualify. */
const OWNER_ONLY = 0o600;

export class ProjectStore {
  constructor(private readonly root: string = DEFAULT_ROOT) {}

  get path(): string {
    return this.root;
  }

  private projectDir(id: string): string {
    // A project id reaching the filesystem is the obvious traversal, so it is
    // checked here rather than trusted from wherever it came.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`"${id}" is not a usable project id.`);
    return join(this.root, 'projects', id);
  }

  async list(): Promise<Project[]> {
    const dir = join(this.root, 'projects');
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const projects: Project[] = [];
    for (const id of entries.sort()) {
      const project = await this.read(id).catch(() => undefined);
      if (project) projects.push(project);
    }
    return projects;
  }

  async read(id: string): Promise<Project> {
    const raw = await readFile(join(this.projectDir(id), 'project.json'), 'utf8');
    return parseProject(JSON.parse(raw));
  }

  async has(id: string): Promise<boolean> {
    return (await this.read(id).then(() => true).catch(() => false));
  }

  async write(project: Project): Promise<void> {
    await this.writeJson(join(this.projectDir(project.id), 'project.json'), project);
  }

  async delete(id: string): Promise<void> {
    await rm(this.projectDir(id), { recursive: true, force: true });
  }

  /** An artefact belonging to a project: a trace, a contract, a benchmark. */
  async writeArtefact(id: string, name: string, value: unknown): Promise<string> {
    const path = join(this.projectDir(id), safeName(name));
    await this.writeJson(path, value);
    return path;
  }

  async readArtefact<T>(id: string, name: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(join(this.projectDir(id), safeName(name)), 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  /** Removes an artefact, for state that is finished rather than merely old. */
  async deleteArtefact(id: string, name: string): Promise<void> {
    await rm(join(this.projectDir(id), safeName(name)), { force: true });
  }

  async writeRun(id: string, runId: string, result: unknown): Promise<string> {
    const path = join(this.projectDir(id), 'runs', safeName(runId));
    await this.writeJson(path, result);
    return path;
  }

  async readRun<T>(id: string, runId: string): Promise<T | undefined> {
    try {
      const path = join(this.projectDir(id), 'runs', safeName(runId));
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  // ------------------------------------------------------------------ secrets

  /**
   * Reads a credential.
   *
   * Kept in one file for every project rather than beside each one, so there is
   * a single thing to protect, a single thing to audit and a single thing to
   * point at when somebody asks where their keys went.
   */
  async secret(name: string): Promise<string | undefined> {
    const all = await this.secrets();
    return all[name];
  }

  async secrets(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(join(this.root, 'secrets.json'), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
    } catch {
      return {};
    }
  }

  async setSecret(name: string, value: string): Promise<void> {
    const all = await this.secrets();
    all[name] = value;
    await this.writeJson(join(this.root, 'secrets.json'), all);
  }

  async deleteSecret(name: string): Promise<void> {
    const all = await this.secrets();
    delete all[name];
    await this.writeJson(join(this.root, 'secrets.json'), all);
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: OWNER_ONLY });
    // Set explicitly as well as at creation: `writeFile` only applies the mode
    // when it creates the file, so a file that already existed with looser
    // permissions would keep them.
    await chmod(path, OWNER_ONLY).catch(() => undefined);
  }
}

/** Refuses anything that could climb out of the project directory. */
function safeName(name: string): string {
  const cleaned = name.replace(/\.json$/, '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(cleaned)) {
    throw new Error(`"${name}" is not a usable file name.`);
  }
  return `${cleaned}.json`;
}

/** Where the store lives, honouring an override for tests and for CI. */
export function storeRoot(override?: string): string {
  return override ? resolve(override) : (process.env['RIGORRUN_HOME'] ?? DEFAULT_ROOT);
}
