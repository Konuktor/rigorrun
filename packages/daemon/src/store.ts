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
import { readFile, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseProject, type Project } from './project.ts';
import { OWNER_ONLY, writeJsonAtomic } from './atomic.ts';
import { SecretStore, type SecretBackendInfo } from './secrets.ts';

export const DEFAULT_ROOT = join(homedir(), '.rigorrun');

/**
 * A project directory that exists and cannot be read.
 *
 * This type is the whole point of a change made after an audit: `list()` used
 * to be `read(id).catch(() => undefined)`, so a truncated `project.json` made
 * the project *disappear* — from `rigorrun projects`, and from the interface —
 * with no message. For a product whose central claim is that your work is still
 * there tomorrow, silently dropping the work is the worst available failure.
 *
 * So a project that cannot be read is still a project. It is listed, it says
 * why, and it says what can be done about it.
 */
export interface BrokenProject {
  id: string;
  reason: 'unreadable' | 'not-json' | 'invalid' | 'too-new';
  /** What a person can do. Never a stack trace. */
  detail: string;
}

export interface Listing {
  projects: Project[];
  broken: BrokenProject[];
}

/**
 * An artefact that is present and damaged.
 *
 * Distinct from absent, which is a normal state and stays `undefined`: before
 * this, "you have not recorded a job yet" and "your recording is damaged" read
 * identically to the person who had to decide what to do next.
 */
export class ArtefactCorruptError extends Error {
  constructor(
    readonly projectId: string,
    readonly artefact: string,
    cause: unknown,
  ) {
    super(
      `${artefact}.json in project ${projectId} is damaged and cannot be read ` +
        `(${(cause as Error).message}). The step that produced it has to be repeated; ` +
        `nothing else in the project is affected.`,
    );
    this.name = 'ArtefactCorruptError';
  }
}

export class ProjectStore {
  private readonly secretStore: SecretStore;

  constructor(private readonly root: string = DEFAULT_ROOT) {
    this.secretStore = new SecretStore(root);
  }

  get path(): string {
    return this.root;
  }

  private projectDir(id: string): string {
    // A project id reaching the filesystem is the obvious traversal, so it is
    // checked here rather than trusted from wherever it came.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`"${id}" is not a usable project id.`);
    return join(this.root, 'projects', id);
  }

  /** Every project, readable or not. The interface and the CLI both use this. */
  async listAll(): Promise<Listing> {
    const dir = join(this.root, 'projects');
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return { projects: [], broken: [] };
    }
    const projects: Project[] = [];
    const broken: BrokenProject[] = [];
    for (const id of entries.sort()) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;
      try {
        projects.push(await this.read(id));
      } catch (error) {
        broken.push({ id, ...classify(error) });
      }
    }
    return { projects, broken };
  }

  async list(): Promise<Project[]> {
    return (await this.listAll()).projects;
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
    let raw: string;
    try {
      raw = await readFile(join(this.projectDir(id), safeName(name)), 'utf8');
    } catch {
      // Absent is a normal state — most artefacts do not exist until the step
      // that writes them has been done. Only *damaged* is an error.
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new ArtefactCorruptError(id, safeName(name).replace(/\.json$/, ''), error);
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
    const path = join(this.projectDir(id), 'runs', safeName(runId));
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new ArtefactCorruptError(id, `runs/${runId}`, error);
    }
  }

  // ------------------------------------------------------------------ secrets

  /**
   * Reads a credential.
   *
   * One store for every project rather than one beside each, so there is a
   * single thing to protect, a single thing to audit and a single thing to
   * point at when somebody asks where their keys went. Where that store
   * actually is depends on the machine — see `secrets.ts`; ask
   * `secretBackend()` rather than assuming, because the answer is the
   * difference between "in your keychain" and "in a file", and a person
   * deciding whether to run this against staging deserves to know which.
   */
  async secret(name: string): Promise<string | undefined> {
    return this.secretStore.get(name);
  }

  /** Every name and value. For the two callers that have to scan them. */
  async secrets(): Promise<Record<string, string>> {
    return this.secretStore.all();
  }

  /** Just the names — readable even when the keychain is locked. */
  async secretNames(): Promise<string[]> {
    return this.secretStore.names();
  }

  async secretBackend(): Promise<SecretBackendInfo> {
    return this.secretStore.backendInfo();
  }

  async setSecret(name: string, value: string): Promise<void> {
    await this.secretStore.set(name, value);
  }

  async deleteSecret(name: string): Promise<void> {
    await this.secretStore.remove(name);
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await writeJsonAtomic(path, value, OWNER_ONLY);
  }
}

/** Turns a read failure into something a person can act on. */
function classify(error: unknown): { reason: BrokenProject['reason']; detail: string } {
  const message = (error as Error).message ?? String(error);
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return {
      reason: 'unreadable',
      detail: 'The directory is there but project.json is not. Nothing can be recovered from it.',
    };
  }
  if (error instanceof SyntaxError) {
    return {
      reason: 'not-json',
      detail:
        'project.json is not valid JSON — usually a write interrupted by a crash or a full disk. ' +
        'If you have a backup under ~/.rigorrun/backups, restore it with `rigorrun restore`.',
    };
  }
  if (/schemaVersion/.test(message)) {
    return {
      reason: 'too-new',
      detail:
        'This project was written by a newer RigorRun. Upgrade rather than letting an older ' +
        'version rewrite it: `npm i -g rigorrun@latest`.',
    };
  }
  return {
    reason: 'invalid',
    detail: `project.json is readable but not a project RigorRun understands (${message}).`,
  };
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
