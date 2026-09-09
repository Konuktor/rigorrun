/**
 * One container, from start to gone.
 *
 * The posture below is the product's actual security boundary, so it is
 * written once, in one place, and recorded verbatim in every evidence record
 * as `harness.runArgv`. A reader should be able to check what we did rather
 * than take our word for it, which is the same standard we hold servers to.
 *
 * What the flags are for:
 *
 *   --network none          the target has no way to reach anything
 *   --read-only             the image layer cannot be written at all
 *   --cap-drop ALL          no capabilities, including the ones root usually keeps
 *   --security-opt no-new-privileges  a setuid binary cannot regain them
 *   --pids-limit            a fork bomb hits a wall instead of the machine
 *   --memory/--cpus         so does a memory or CPU exhaustion attempt
 *   --user 65532            not root inside the container either
 *   --tmpfs                 the only writable storage, and it dies with the container
 *
 * What this does **not** do is prevent a container escape. On a rootful
 * daemon — which is the common installation and the one this was developed on
 * — an escape lands on the host as root. That is stated in the record rather
 * than left for a reader to discover, because a security boundary nobody
 * described is not one anybody can rely on.
 *
 * Cleanup is by name, never by pid. The process we spawn is the docker client;
 * killing it does not necessarily stop the container, and a container left
 * running with a stranger's code in it is exactly the orphan problem the
 * daemon already learned about the hard way.
 */
import { prefixedId } from '@rigorrun/core';
import {
  assertPostureIntact,
  assertSafeImage,
  assertSafeToken,
  containerLayerChanges,
  execInContainer,
  forceRemove,
} from './docker.ts';

export interface ContainerLimits {
  pids: number;
  memoryMb: number;
  cpus: number;
}

export const DEFAULT_LIMITS: ContainerLimits = { pids: 256, memoryMb: 512, cpus: 1 };

export interface SessionSpec {
  image: string;
  limits?: ContainerLimits;
  /** Args appended after the image. The entrypoint execs `node` with these. */
  command?: readonly string[];
}

/**
 * The argv for one run. Pure, so a test can assert the posture without a
 * container runtime installed at all.
 */
export function runArgv(
  name: string,
  spec: SessionSpec,
): string[] {
  const limits = spec.limits ?? DEFAULT_LIMITS;
  assertSafeToken(name, 'container name');
  assertSafeImage(spec.image);

  const argv = [
    'run',
    '--rm',
    '-i',
    '--name',
    name,
    '--label',
    'rigorrun.harness=1',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '65532:65532',
    '--pids-limit',
    String(limits.pids),
    '--memory',
    `${limits.memoryMb}m`,
    // Equal to --memory, so the limit cannot be sidestepped by swapping.
    '--memory-swap',
    `${limits.memoryMb}m`,
    '--cpus',
    String(limits.cpus),
    // /work is not noexec: a native addon is dlopen'd and would fail. /tmp is.
    '--tmpfs',
    '/work:rw,nosuid,nodev,size=256m,mode=1777',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
    spec.image,
    ...(spec.command ?? []),
  ];

  assertPostureIntact(argv);
  return argv;
}

/**
 * A container RigorRun started and is responsible for removing.
 *
 * The process is owned by the MCP transport, not by this class — the transport
 * spawns `docker run -i` and speaks JSON-RPC over its stdio. What this owns is
 * the *name*, which is the only reliable handle on the container itself.
 */
export class ContainerSession {
  readonly name: string;
  readonly argv: string[];
  private removed = false;

  constructor(spec: SessionSpec) {
    this.name = `rigorrun-verify-${prefixedId('c').replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
    this.argv = runArgv(this.name, spec);
  }

  /** Reads the writable mounts. The surface everything else is measured on. */
  async statedump(): Promise<string> {
    const result = await execInContainer(this.name, ['/rigorrun/statedump'], 120_000);
    if (result.code !== 0) return '';
    return result.stdout;
  }

  async processList(): Promise<string> {
    const result = await execInContainer(this.name, ['/rigorrun/pslist'], 60_000);
    return result.code === 0 ? result.stdout : '';
  }

  /**
   * Whether the read-only posture actually held.
   *
   * `docker diff` always reports the tmpfs mount points themselves — they are
   * directories created in the container layer at start — so those are not
   * evidence of anything. Anything else appearing here means a write reached
   * the image layer, which under `--read-only` should be impossible, and is
   * recorded as the posture having failed rather than quietly ignored.
   */
  async layerChanges(): Promise<string[]> {
    const changes = await containerLayerChanges(this.name);
    const mounts = new Set(['A /work', 'A /tmp', 'C /work', 'C /tmp']);
    return changes.filter((entry) => !mounts.has(entry));
  }

  /** Idempotent, and safe to call from a signal handler. */
  async remove(): Promise<void> {
    if (this.removed) return;
    this.removed = true;
    await forceRemove(this.name);
  }
}
