/**
 * Where credentials live, and why it is not simply a file.
 *
 * The discipline around secrets here was already good: only *names* go in a
 * project file, values are fetched in the function that is about to open the
 * socket, no command prints one, and the feedback bundle refuses to write
 * itself if it finds one in its own output. What was missing is where the value
 * rests in between. A plaintext dotfile at `0600` is the first thing any
 * security review flags, and correctly: file permissions stop another user,
 * they do not stop a backup tool, a sync client, or a process running as you.
 *
 * So values go to the operating system's own credential store when there is
 * one, and to the file when there is not — with RigorRun saying which, rather
 * than implying the stronger one.
 *
 * **No native dependency.** `keytar` and its relatives mean `node-gyp`, a
 * compiler on the user's machine and a prebuilt binary per platform, which for
 * a 285KB package installed with `npx` is not a trade worth making. Each
 * platform already ships a command-line tool that does exactly this, and
 * running one is cheap because it happens when a connection opens, not in a
 * loop.
 *
 * **Names are not secret.** They are already in `project.json` — that is the
 * whole point of storing names separately — so the index of which names exist
 * stays a plain file. That also means `rigorrun secrets list` and the
 * "credential missing" message keep working when the keychain is locked, which
 * is when a person most needs to be told what is wrong.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic, OWNER_ONLY } from './atomic.ts';
import { runCommand } from './exec.ts';

/** The service name every entry is filed under, on every platform. */
const SERVICE = 'rigorrun';
const INDEX_FILE = 'secrets.index.json';
const FILE_FALLBACK = 'secrets.json';
const PROBE_TIMEOUT_MS = 5_000;

export type SecretBackendKind = 'macos-keychain' | 'libsecret' | 'windows-dpapi' | 'file';

export interface SecretBackendInfo {
  kind: SecretBackendKind;
  /** One sentence for `rigorrun doctor` and the interface. Shown verbatim. */
  detail: string;
}

interface Backend {
  kind: SecretBackendKind;
  detail: string;
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/* ------------------------------------------------------------ the platforms */

const macos: Backend = {
  kind: 'macos-keychain',
  detail: 'the macOS keychain, under the service “rigorrun”.',
  async get(name) {
    const result = await runCommand({
      command: 'security',
      args: ['find-generic-password', '-s', SERVICE, '-a', name, '-w'],
      timeoutMs: PROBE_TIMEOUT_MS,
      provenance: 'rigorrun-internal',
    });
    return result.code === 0 ? result.stdout.replace(/\n$/, '') : undefined;
  },
  async set(name, value) {
    // `-U` updates in place. `-w` last so the value is the final argument;
    // it is still an argument, which is the one weakness of this tool — the
    // value is briefly visible to `ps` on a shared machine. Noted in
    // docs/SECURITY_MODEL.md rather than papered over.
    const result = await runCommand({
      command: 'security',
      args: ['add-generic-password', '-U', '-s', SERVICE, '-a', name, '-w', value],
      timeoutMs: PROBE_TIMEOUT_MS,
      provenance: 'rigorrun-internal',
    });
    if (result.code !== 0)
      throw new Error(result.stderr.trim() || 'the keychain refused the write');
  },
  async remove(name) {
    await runCommand({
      command: 'security',
      args: ['delete-generic-password', '-s', SERVICE, '-a', name],
      timeoutMs: PROBE_TIMEOUT_MS,
      provenance: 'rigorrun-internal',
    });
  },
};

const libsecret: Backend = {
  kind: 'libsecret',
  detail: 'the system keyring through libsecret (GNOME Keyring, KWallet).',
  async get(name) {
    const result = await runCommand({
      command: 'secret-tool',
      args: ['lookup', 'service', SERVICE, 'account', name],
      timeoutMs: PROBE_TIMEOUT_MS,
      provenance: 'rigorrun-internal',
    });
    // `secret-tool lookup` exits 1 and prints nothing when there is no match.
    return result.code === 0 && result.stdout.length > 0 ? result.stdout : undefined;
  },
  async set(name, value) {
    // The value goes in on stdin, so it never appears in the process table.
    const result = await runCommand(
      {
        command: 'secret-tool',
        args: ['store', '--label', `RigorRun: ${name}`, 'service', SERVICE, 'account', name],
        timeoutMs: PROBE_TIMEOUT_MS,
        provenance: 'rigorrun-internal',
      },
      value,
    );
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'the keyring refused the write');
  },
  async remove(name) {
    await runCommand({
      command: 'secret-tool',
      args: ['clear', 'service', SERVICE, 'account', name],
      timeoutMs: PROBE_TIMEOUT_MS,
      provenance: 'rigorrun-internal',
    });
  },
};

/**
 * Windows, through DPAPI.
 *
 * There is no credential-manager CLI that round-trips an arbitrary secret
 * value cleanly, so this uses the other thing Windows offers: DPAPI encryption
 * scoped to the current user. The ciphertext lives in the workspace, and only
 * this user account on this machine can decrypt it. Weaker than a keychain —
 * anything running as the user can read it — and considerably stronger than
 * plaintext, which is the actual alternative.
 */
function windows(root: string): Backend {
  const vault = join(root, 'secrets.dpapi.json');
  const read = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await readFile(vault, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const powershell = async (script: string, stdin?: string): Promise<string | undefined> => {
    const result = await runCommand(
      {
        command: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', script],
        timeoutMs: PROBE_TIMEOUT_MS,
        provenance: 'rigorrun-internal',
      },
      stdin,
    );
    return result.code === 0 ? result.stdout.trim() : undefined;
  };
  return {
    kind: 'windows-dpapi',
    detail: 'encrypted with Windows DPAPI, readable only by this user account.',
    async get(name) {
      const blob = (await read())[name];
      if (blob === undefined) return undefined;
      const plain = await powershell(
        '$s = [Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString; ' +
          '[Runtime.InteropServices.Marshal]::PtrToStringAuto(' +
          '[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))',
        blob,
      );
      return plain === undefined || plain.length === 0 ? undefined : plain;
    },
    async set(name, value) {
      const blob = await powershell(
        '[Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString -AsPlainText -Force | ' +
          'ConvertFrom-SecureString',
        value,
      );
      if (blob === undefined || blob.length === 0) throw new Error('DPAPI refused the write');
      await writeJsonAtomic(vault, { ...(await read()), [name]: blob }, OWNER_ONLY);
    },
    async remove(name) {
      const all = await read();
      delete all[name];
      await writeJsonAtomic(vault, all, OWNER_ONLY);
    },
  };
}

function fileBackend(root: string): Backend {
  const path = join(root, FILE_FALLBACK);
  const read = async (): Promise<Record<string, string>> => {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
      );
    } catch {
      return {};
    }
  };
  return {
    kind: 'file',
    detail:
      `a file only you can read, at ${path}. No OS credential store was available — ` +
      'file permissions stop another user on this machine, but not a backup tool or a ' +
      'sync client, so keep this machine out of both.',
    async get(name) {
      return (await read())[name];
    },
    async set(name, value) {
      await writeJsonAtomic(path, { ...(await read()), [name]: value }, OWNER_ONLY);
    },
    async remove(name) {
      const all = await read();
      delete all[name];
      await writeJsonAtomic(path, all, OWNER_ONLY);
    },
  };
}

/* --------------------------------------------------------------- the store */

/**
 * Chooses a backend by *using* it, not by asking what platform this is.
 *
 * `secret-tool` being installed does not mean a keyring daemon is running, and
 * a headless CI box has both and neither works. So the probe writes a value,
 * reads it back and deletes it. A backend that cannot do that round trip is not
 * a backend, whatever the platform says.
 */
export class SecretStore {
  private backend: Backend | undefined;

  constructor(private readonly root: string) {}

  private async choose(): Promise<Backend> {
    if (this.backend) return this.backend;

    const forced = process.env['RIGORRUN_SECRET_BACKEND'];
    if (forced === 'file') return (this.backend = fileBackend(this.root));

    const candidates: Backend[] =
      process.platform === 'darwin'
        ? [macos]
        : process.platform === 'win32'
          ? [windows(this.root)]
          : [libsecret];

    for (const candidate of candidates) {
      if (await roundTrips(candidate)) return (this.backend = candidate);
    }
    return (this.backend = fileBackend(this.root));
  }

  async backendInfo(): Promise<SecretBackendInfo> {
    const backend = await this.choose();
    return { kind: backend.kind, detail: backend.detail };
  }

  /** The names that exist. Not secret, and deliberately readable without one. */
  async names(): Promise<string[]> {
    try {
      const parsed = JSON.parse(await readFile(join(this.root, INDEX_FILE), 'utf8')) as unknown;
      return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
    } catch {
      // Before the index existed, the names were the keys of the file. Reading
      // them keeps a workspace that predates this working without a migration.
      return Object.keys(await fileNames(this.root));
    }
  }

  async get(name: string): Promise<string | undefined> {
    const backend = await this.choose();
    const value = await backend.get(name).catch(() => undefined);
    if (value !== undefined) return value;
    // A workspace written before the keychain existed still has its values in
    // the file. Read them rather than telling somebody their credentials are
    // gone; `set` moves them across on the next write.
    return backend.kind === 'file' ? undefined : (await fileNames(this.root))[name];
  }

  async set(name: string, value: string): Promise<void> {
    const backend = await this.choose();
    await backend.set(name, value);
    const names = new Set(await this.names());
    names.add(name);
    await writeJsonAtomic(join(this.root, INDEX_FILE), [...names].sort(), 0o644);
  }

  async remove(name: string): Promise<void> {
    const backend = await this.choose();
    await backend.remove(name);
    const names = (await this.names()).filter((existing) => existing !== name);
    await writeJsonAtomic(join(this.root, INDEX_FILE), names, 0o644);
    // Also clear any pre-keychain copy, so removing means removed.
    if (backend.kind !== 'file') await fileBackend(this.root).remove(name);
  }

  /** Every name and value. Only the two callers that must scan them use it. */
  async all(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of await this.names()) {
      const value = await this.get(name);
      if (value !== undefined) out[name] = value;
    }
    return out;
  }
}

async function roundTrips(backend: Backend): Promise<boolean> {
  const probe = `__rigorrun_probe_${Date.now()}`;
  try {
    await backend.set(probe, 'ok');
    const read = await backend.get(probe);
    await backend.remove(probe);
    return read === 'ok';
  } catch {
    await backend.remove(probe).catch(() => undefined);
    return false;
  }
}

async function fileNames(root: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(join(root, FILE_FALLBACK), 'utf8')) as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return {};
  }
}
