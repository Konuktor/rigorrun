/**
 * What a tool might do, and how much that opinion is worth.
 *
 * MCP servers may annotate a tool with `readOnlyHint`, `destructiveHint`,
 * `idempotentHint` and `openWorldHint`. The specification is unusually blunt
 * about their standing, and the SDK repeats it verbatim:
 *
 *   "NOTE: all properties in ToolAnnotations are **hints**. They are not
 *    guaranteed to provide a faithful description of tool behavior... Clients
 *    should never make tool use decisions based on ToolAnnotations received
 *    from untrusted servers."
 *
 * So this module does not return a boolean. It returns a claim plus who made
 * it, and the type makes the provenance impossible to drop on the way to a
 * decision. A server saying `readOnlyHint: true` moves a tool to
 * `level: 'read', source: 'server-hint'` — never to a `readOnly` flag that some
 * later caller will read as fact.
 *
 * The fail-safe direction is deliberate: absent any evidence a tool is
 * `'unknown'`, and `'unknown'` is treated as *mutating* everywhere it matters.
 * A server that forgets to annotate gets caution, not permission.
 */

/** The four hints, exactly as the server sent them. Never widened, never merged. */
export interface ServerHints {
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
}

export type RiskLevel = 'read' | 'write' | 'destructive' | 'unknown';

export type RiskSource =
  /** The server said so. A hint. Worth showing, never worth trusting. */
  | 'server-hint'
  /** RigorRun watched the tool run and compared state before and after. */
  | 'observed'
  /** A person configuring this connector said so. */
  | 'operator'
  /** Nothing is known, so the cautious answer stands. */
  | 'default';

export interface RiskAssessment {
  level: RiskLevel;
  source: RiskSource;
  /** One sentence, shown next to the tool wherever the level is shown. */
  rationale: string;
}

/** Reads the four hints off a tool's `annotations`, tolerating any shape. */
export function readServerHints(annotations: unknown): ServerHints {
  if (typeof annotations !== 'object' || annotations === null) return {};
  const raw = annotations as Record<string, unknown>;
  const bool = (key: string): boolean | undefined =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : undefined;
  const hints: ServerHints = {};
  const readOnly = bool('readOnlyHint');
  const destructive = bool('destructiveHint');
  const idempotent = bool('idempotentHint');
  const openWorld = bool('openWorldHint');
  if (readOnly !== undefined) hints.readOnly = readOnly;
  if (destructive !== undefined) hints.destructive = destructive;
  if (idempotent !== undefined) hints.idempotent = idempotent;
  if (openWorld !== undefined) hints.openWorld = openWorld;
  return hints;
}

/** The starting assessment for a freshly discovered tool. */
export function assessFromHints(hints: ServerHints): RiskAssessment {
  if (hints.destructive === true) {
    return {
      level: 'destructive',
      source: 'server-hint',
      rationale: 'The server marked this tool destructive.',
    };
  }
  if (hints.readOnly === true) {
    return {
      level: 'read',
      source: 'server-hint',
      rationale: 'The server says this tool only reads. Unverified.',
    };
  }
  if (hints.readOnly === false) {
    return {
      level: 'write',
      source: 'server-hint',
      rationale: 'The server says this tool writes.',
    };
  }
  return {
    level: 'unknown',
    source: 'default',
    rationale: 'The server published no hint. Treated as writing until shown otherwise.',
  };
}

/**
 * Whether RigorRun may treat a tool as safe to call freely.
 *
 * The one place the fail-safe direction is spent. Only a person's own decision
 * or RigorRun's own observation earns a yes; a server's word never does, which
 * is what stops a hostile server marking `delete_everything` read-only and
 * being believed.
 */
export function isConfirmedReadOnly(assessment: RiskAssessment): boolean {
  return (
    assessment.level === 'read' &&
    (assessment.source === 'operator' || assessment.source === 'observed')
  );
}

/** A tool RigorRun must assume can change the world. */
export function mayMutate(assessment: RiskAssessment): boolean {
  return !isConfirmedReadOnly(assessment);
}

/**
 * A server hint contradicted by what actually happened.
 *
 * Worth surfacing on its own: a server that claims a tool is read-only and
 * then changes state is either wrong about its own implementation or lying,
 * and either is something the person evaluating an agent against it wants to
 * know before they trust a verdict.
 */
export interface AnnotationMismatch {
  tool: string;
  claimed: string;
  observed: string;
}

/** Compares what the server promised against what a call was seen to do. */
export function detectMismatch(
  tool: string,
  hints: ServerHints,
  changedState: boolean,
): AnnotationMismatch | undefined {
  if (hints.readOnly === true && changedState) {
    return {
      tool,
      claimed: 'readOnlyHint: true',
      observed: 'the call changed state RigorRun can read',
    };
  }
  if (hints.readOnly === false && !changedState) {
    // Not a security problem, but it makes generated cases wrong: a "write"
    // that writes nothing produces cases with no observable outcome.
    return {
      tool,
      claimed: 'readOnlyHint: false',
      observed: 'the call changed nothing RigorRun can read',
    };
  }
  return undefined;
}
