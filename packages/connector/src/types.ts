/**
 * What RigorRun needs from a system, regardless of how it reaches one.
 *
 * MCP was the only connector for long enough that its vocabulary became the
 * product's: a "tool", a "server", a handshake. Those are MCP's words. An
 * OpenAPI document publishes operations, a browser publishes nothing at all,
 * and a custom adapter publishes whatever its author decided — and every one of
 * them has to end up as the same thing, because the compiler, the generator and
 * the verifier were built to know nothing about where a system came from.
 *
 * This file is that shape. It is deliberately small: four members, because that
 * is all the daemon was ever using. Anything larger would be a second engine
 * with extra steps.
 *
 * The names still say "tool" and "server". Renaming them across the product is
 * a separate change from making a second connector possible, and doing both at
 * once is how a migration ends up wrong.
 */
import type { ActionParam } from '@rigorrun/environment';
import type { UnsupportedParam } from './jsonSchema.ts';
import type { RiskAssessment, ServerHints } from './risk.ts';

/** One operation as RigorRun understands it, with the provenance of every opinion. */
export interface DiscoveredTool {
  name: string;
  /** The system's own description. Shown to people; never parsed for meaning. */
  description: string;
  params: ActionParam[];
  /** Arguments RigorRun could not express, with a reason for each. */
  unsupported: UnsupportedParam[];
  /** True when the input schema was too large or deep to read completely. */
  schemaTruncated: boolean;
  /**
   * The input schema exactly as the server published it.
   *
   * `params` is RigorRun's reading of it, which is lossy on purpose — the
   * connector vocabulary has no way to express an array of objects, so those
   * arrive in `unsupported`. Anything that needs to build a real argument for
   * such a tool has to see the original, so it is kept rather than discarded.
   * It is untrusted data and is never executed, only walked.
   */
  inputSchema?: unknown;
  /** Present when the system publishes one. The best evidence for record shape. */
  outputSchema?: unknown;
  hints: ServerHints;
  risk: RiskAssessment;
}

export interface DiscoveryResult {
  serverName: string;
  serverVersion: string;
  /** What both ends agreed on. Empty where the idea does not apply. */
  protocolVersion: string;
  tools: DiscoveredTool[];
  /** Round-trip time of the opening exchange, in milliseconds. */
  latencyMs: number;
}

/**
 * What came back from one call.
 *
 * `content` and `structured` are kept apart on purpose. Only `structured` is
 * ever read for state, because RigorRun compares records and never prose —
 * a system that answers in sentences can be watched and cannot be verified.
 */
export interface CallResult {
  ok: boolean;
  content?: unknown;
  structured?: unknown;
  error?: { code: string; message: string };
  durationMs: number;
}

/**
 * A live connection to somebody's system.
 *
 * Structural rather than a base class: `McpConnection` already satisfies this
 * without knowing the interface exists, which is what makes adopting it a
 * change with no behaviour in it.
 */
export interface SystemConnection {
  readonly discovery: DiscoveryResult;
  /** The child process this connection spawned, where it spawned one. */
  readonly childPid: number | null;
  call(name: string, args: Record<string, unknown>): Promise<CallResult>;
  close(): Promise<void>;
  /**
   * Whether reading this system back is possible at all.
   *
   * `undefined` means yes, which is right for every connector that answers with
   * records. A browser says `false` unless it has been given a verifier,
   * because a page saying "Refund issued" is a claim by the same system that
   * would have to be wrong for the refund not to exist. Reading it back and
   * calling that verification is the exact mistake this product exists to stop
   * people making about an agent's own report, and it does not become
   * acceptable because the claim is rendered in a div.
   *
   * Everything downstream already degrades correctly on `stateRead: 'none'` —
   * the verdict says OBSERVATIONAL and the limits say why. This is the flag
   * that makes it say so.
   */
  readonly canReadState?: boolean;

  /**
   * Ends setup, if this connector distinguishes it.
   *
   * There are two kinds of call RigorRun makes to somebody's system, and the
   * difference is who asked. While a project is being set up, the calls are
   * RigorRun's own: probing the nominated reads, sampling them to work out what
   * a record looks like. Nothing there is worth a write nobody requested, and a
   * connector that can tell reads from writes should refuse one.
   *
   * A demonstration and a run are the other kind. A person doing the job, or an
   * agent being graded on it, is *meant* to change things — that is the entire
   * measurement. So the moment either begins, the guard comes off.
   *
   * Optional because MCP cannot tell the difference: which of its tools write
   * is a person's decision, made before any of this, and the operator has
   * already ticked the ones RigorRun may call freely.
   */
  allowWrites?(): void;
}
