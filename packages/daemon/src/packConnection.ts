/**
 * A pack's session, as the rest of the daemon sees a connection.
 *
 * The workspace hands every caller a `SystemConnection` and never says what is
 * behind it — that is what stops a second connector becoming a second engine.
 * A pack is a different shape underneath (a session that makes records per
 * case, rather than tools a person demonstrates with), so this is the small
 * translation that lets it sit in the same slot: its operations become the
 * discovered tools, and calling one goes through the session.
 *
 * What it adds is the project's safety. A pack decides its own safety from
 * what it opened — a twin, a test account — and a person decides the project's
 * when they connect it. The stricter of the two is what every adapter built
 * from this connection reports, so a project somebody marked production is
 * refused everywhere a write or a case's records could happen, whatever the
 * pack believed about itself.
 */
import type {
  CallResult,
  DiscoveredTool,
  DiscoveryResult,
  RiskAssessment,
  SystemConnection,
} from '@rigorrun/connector';
import {
  PackEnvironment,
  type ActionDefinition,
  type PackDefinition,
  type PackSession,
  type SafetyMode,
} from '@rigorrun/environment';

/** Most cautious first. A project is held to whichever of two is earlier here. */
const SAFETY_ORDER: readonly SafetyMode[] = ['production', 'staging', 'local', 'ephemeral'];

export function stricterSafety(a: SafetyMode, b: SafetyMode): SafetyMode {
  return SAFETY_ORDER.indexOf(a) <= SAFETY_ORDER.indexOf(b) ? a : b;
}

export class PackConnection implements SystemConnection {
  readonly discovery: DiscoveryResult;
  /** Nothing is spawned: the pack's client runs in this process. */
  readonly childPid = null;
  /** A pack reads the case's records with RigorRun's own client and credential. */
  readonly canReadState = true;
  /** The session every adapter is built over, held to the project's safety. */
  readonly session: PackSession;

  constructor(
    readonly pack: PackDefinition,
    private readonly opened: PackSession,
    projectSafety: SafetyMode,
    latencyMs: number,
  ) {
    this.session = heldTo(opened, projectSafety);
    this.discovery = {
      serverName: opened.system,
      serverVersion: '',
      protocolVersion: '',
      tools: opened.actions().map(toolOf),
      latencyMs,
    };
  }

  /**
   * A fresh adapter for one case, over the session every case shares.
   *
   * Fresh because the runner builds one per case and the adapter is where a
   * case's scope and bindings live; the session is shared because opening it
   * checks the credential against the system, once per run is enough.
   */
  environment(): PackEnvironment {
    return new PackEnvironment(this.pack, this.session);
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallResult> {
    const started = Date.now();
    const result = await this.session.execute(name, args);
    return {
      ok: result.ok,
      ...(result.data === undefined ? {} : { structured: result.data }),
      ...(result.error ? { error: result.error } : {}),
      durationMs: Date.now() - started,
    };
  }

  /** Whoever opened the session closes it; here, that is the workspace. */
  close(): Promise<void> {
    return this.opened.close();
  }
}

/**
 * The session, reporting the stricter of its own safety and the project's.
 *
 * A wrapper rather than a mutation, because the session is the pack's object.
 * On production it also refuses every operation the pack does not declare
 * read-only: an agent RigorRun drives calls through here, and a refusal at the
 * channel is the same promise every other connector keeps.
 */
function heldTo(session: PackSession, projectSafety: SafetyMode): PackSession {
  const safety = stricterSafety(session.safety, projectSafety);
  if (safety === session.safety) return session;
  const readOnly = new Set(
    session
      .actions()
      .filter((action) => action.readOnly)
      .map((action) => action.name),
  );
  const held: PackSession = {
    system: session.system,
    safety,
    simulated: session.simulated,
    ...(session.isolation ? { isolation: session.isolation } : {}),
    ...(session.completeRead === undefined ? {} : { completeRead: session.completeRead }),
    materialize: (recipe, ctx) => session.materialize(recipe, ctx),
    read: (scope) => session.read(scope),
    actions: () => session.actions(),
    execute: async (name, args) => {
      if (safety === 'production' && !readOnly.has(name)) {
        return {
          ok: false,
          error: {
            code: 'WRITE_REFUSED',
            message: `${name} may write, and this project is marked production, so RigorRun will not call it.`,
          },
        };
      }
      return session.execute(name, args);
    },
    close: () => session.close(),
  };
  const reality = session.reality?.bind(session);
  if (reality) held.reality = reality;
  return held;
}

/**
 * One of the pack's operations, as a discovered tool.
 *
 * The pack's own declaration is all there is to go on, and RigorRun has not
 * watched the operation run, so it is a hint like any server's: shown, never
 * enough on its own to call something read-only.
 */
function toolOf(action: ActionDefinition): DiscoveredTool {
  const risk: RiskAssessment = action.readOnly
    ? {
        level: 'read',
        source: 'server-hint',
        rationale: 'The pack declares this operation only reads. Unverified.',
      }
    : {
        level: 'write',
        source: 'server-hint',
        rationale: 'The pack declares this operation writes.',
      };
  return {
    name: action.name,
    description: action.description,
    params: action.params,
    unsupported: [],
    schemaTruncated: false,
    hints: { readOnly: action.readOnly },
    risk,
  };
}
