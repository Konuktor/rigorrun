/**
 * A system reached twice: once for the agent, once for the verdict.
 *
 * Audit finding R-2: a verdict could only read the target through the same
 * connection the agent used, so a read that lies, omits a field, or crashes is
 * the only witness to whether the work was done. A project may now attach a
 * second connection — another MCP server or an OpenAPI document for the same
 * system, typically read-only and run as a separate process — and nominate its
 * tools as the reads a verdict rests on.
 *
 * Its tools appear under `verifier:` so they can be nominated and never
 * collide with the system's own. They are not actions: an agent is never
 * offered them and cannot call them, because a witness the agent can reach is
 * not independent of the agent.
 */
import type { CallResult, DiscoveredTool, DiscoveryResult, SystemConnection } from './types.ts';

export const VERIFIER_PREFIX = 'verifier:';

export function isVerifierTool(name: string): boolean {
  return name.startsWith(VERIFIER_PREFIX);
}

/**
 * The nominated reads a verdict rests on, and the ones it sets aside.
 *
 * Requalification P10: a project nominated a verifier read and one of the
 * system's own reads, and the later answer's rows replaced the earlier's — so a
 * system that misreported its own state, read after the verifier, decided the
 * verdict. Once a witness the agent cannot reach is nominated, a read through
 * the system's own connection can only add the system's account of itself. It
 * is not merged in, and it is not called: calling it could only add a side
 * effect or a failure to a world that is already read.
 */
export function readsForVerdict<T extends { tool: string }>(reads: readonly T[]): { used: T[]; ignored: T[] } {
  const verifier = reads.filter((read) => isVerifierTool(read.tool));
  if (verifier.length === 0) return { used: [...reads], ignored: [] };
  return { used: verifier, ignored: reads.filter((read) => !isVerifierTool(read.tool)) };
}

export class VerifiedConnection implements SystemConnection {
  readonly discovery: DiscoveryResult;
  readonly childPid: number | null;
  readonly canReadState = true;

  constructor(
    private readonly primary: SystemConnection,
    private readonly verifier: SystemConnection,
  ) {
    this.childPid = primary.childPid;
    this.discovery = {
      ...primary.discovery,
      tools: [
        ...primary.discovery.tools,
        ...verifier.discovery.tools.map(
          (tool): DiscoveredTool => ({ ...tool, name: `${VERIFIER_PREFIX}${tool.name}` }),
        ),
      ],
    };
  }

  call(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<CallResult> {
    return isVerifierTool(name)
      ? this.verifier.call(name.slice(VERIFIER_PREFIX.length), args, timeoutMs)
      : this.primary.call(name, args, timeoutMs);
  }

  allowWrites(): void {
    // Only the system under test is written to. The verifier stays a reader.
    this.primary.allowWrites?.();
  }

  async close(): Promise<void> {
    await Promise.all([
      this.primary.close().catch(() => undefined),
      this.verifier.close().catch(() => undefined),
    ]);
  }
}
