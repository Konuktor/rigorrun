/**
 * The only file that knows the word "docker".
 *
 * Everything here builds an argument array and hands it to `@rigorrun/exec`,
 * which is still the single place in the repository that starts a process. No
 * string is ever assembled into a command, and every value that is not a
 * compile-time constant is checked before it becomes an argument.
 *
 * That check matters more than it looks. `assertRunnable` in the exec package
 * inspects the *command*, not the arguments — which is correct, because
 * arguments never reach a shell. But an argument that begins with a dash is a
 * flag, and a flag we did not intend is how a hardened container quietly stops
 * being one. So the values that flow in from outside are validated here.
 */
import { runCommand, type ExecResult } from '@rigorrun/exec';

export class DockerError extends Error {}

/** Ids and tags RigorRun generates. Nothing else may become an argument. */
const SAFE_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
/** `repo@sha256:<64 hex>` or `repo:tag`. */
const SAFE_IMAGE = /^[a-z0-9][a-z0-9._/-]{0,127}(@sha256:[0-9a-f]{64}|:[a-zA-Z0-9_.-]{1,64})$/;

export function assertSafeToken(value: string, what: string): string {
  if (!SAFE_TOKEN.test(value)) {
    throw new DockerError(`${what} "${value}" is not a name RigorRun will pass to a container.`);
  }
  return value;
}

export function assertSafeImage(value: string): string {
  if (!SAFE_IMAGE.test(value)) {
    throw new DockerError(
      `"${value}" is not an image reference RigorRun will run. An image must be pinned by ` +
        'digest or carry an ordinary tag.',
    );
  }
  return value;
}

/**
 * Arguments that would undo the posture, refused wherever they appear.
 *
 * This is belt and braces — every argv here is built from constants and
 * validated tokens — but the cost is one array scan and the failure it
 * prevents is a container running with the host's filesystem mounted.
 */
const FORBIDDEN_ARGS = [
  '--privileged',
  '--cap-add',
  '--device',
  '--pid=host',
  '--net=host',
  '--network=host',
  '--userns=host',
  '-v',
  '--volume',
  '--mount',
];

export function assertPostureIntact(args: readonly string[]): void {
  for (const arg of args) {
    const head = arg.split('=')[0] ?? arg;
    if (FORBIDDEN_ARGS.includes(head) || FORBIDDEN_ARGS.includes(arg)) {
      throw new DockerError(`Refusing to run a container with ${arg}.`);
    }
    if (arg.includes('docker.sock')) {
      throw new DockerError('Refusing to give a container access to the container runtime.');
    }
  }
}

export interface DockerInfo {
  available: boolean;
  version: string;
  /** Whether the daemon runs rootless. Changes what an escape reaches. */
  rootless: boolean;
  detail: string;
}

async function docker(args: string[], timeoutMs = 60_000): Promise<ExecResult> {
  assertPostureIntact(args);
  return runCommand({
    command: 'docker',
    args,
    timeoutMs,
    provenance: 'rigorrun-internal',
  });
}

/** What runtime is here, if any. A missing runtime is a configuration error. */
export async function inspectRuntime(): Promise<DockerInfo> {
  try {
    const version = await docker(['version', '--format', '{{.Server.Version}}'], 20_000);
    if (version.code !== 0) {
      return {
        available: false,
        version: '',
        rootless: false,
        detail:
          version.stderr.trim() ||
          'The docker command exists but the daemon did not answer. Is it running?',
      };
    }
    const security = await docker(['info', '--format', '{{.SecurityOptions}}'], 20_000);
    const rootless = security.stdout.includes('rootless');
    return {
      available: true,
      version: version.stdout.trim(),
      rootless,
      detail: security.stdout.trim(),
    };
  } catch (error) {
    return {
      available: false,
      version: '',
      rootless: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The digest a local tag currently points at. A tag is not an identity. */
export async function imageDigest(image: string): Promise<string> {
  const result = await docker(['image', 'inspect', image, '--format', '{{index .RepoDigests 0}}']);
  if (result.code !== 0) return '';
  return result.stdout.trim();
}

export async function imageId(image: string): Promise<string> {
  const result = await docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  return result.code === 0 ? result.stdout.trim() : '';
}

export async function pullImage(image: string): Promise<void> {
  const result = await docker(['pull', assertSafeImage(image)], 600_000);
  if (result.code !== 0) {
    throw new DockerError(`Could not pull ${image}: ${result.stderr.trim()}`);
  }
}

export async function buildImage(contextDir: string, tag: string): Promise<void> {
  assertSafeToken(tag.replace(/^rigorrun-target:/, ''), 'image tag');
  const result = await docker(
    // No RUN instruction exists in the generated Dockerfile, so nothing the
    // target ships can execute during a build. `--network none` makes that
    // checkable from the argv rather than only from the Dockerfile.
    ['build', '--network', 'none', '--pull=false', '-t', tag, contextDir],
    600_000,
  );
  if (result.code !== 0) {
    throw new DockerError(`Building the target image failed:\n${result.stderr.trim()}`);
  }
}

export async function removeImage(tag: string): Promise<void> {
  await docker(['image', 'rm', '-f', tag], 60_000);
}

/** Kills and removes a container by name. Idempotent, and never throws. */
export async function forceRemove(name: string): Promise<void> {
  try {
    await docker(['rm', '-f', assertSafeToken(name, 'container name')], 30_000);
  } catch {
    // A container that is already gone is the outcome we wanted.
  }
}

/** Every container this harness has left behind, by label. */
export async function reapOrphans(): Promise<string[]> {
  const listed = await docker(['ps', '-aq', '--filter', 'label=rigorrun.harness=1'], 30_000);
  if (listed.code !== 0) return [];
  const ids = listed.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) await forceRemove(id);
  return ids;
}

export async function execInContainer(
  name: string,
  argv: readonly string[],
  timeoutMs = 60_000,
): Promise<ExecResult> {
  return docker(['exec', assertSafeToken(name, 'container name'), ...argv], timeoutMs);
}

/** `docker diff`, used as a posture control rather than as a state surface. */
export async function containerLayerChanges(name: string): Promise<string[]> {
  const result = await docker(['diff', assertSafeToken(name, 'container name')], 30_000);
  if (result.code !== 0) return [];
  return result.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}
