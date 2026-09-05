/**
 * What an environment can actually do, declared rather than assumed.
 *
 * The rest of this package was written against an in-memory object, and it
 * shows: `seed()` hands the environment a whole world, `getState()` asks for
 * every row it has, `snapshot()` and `restore()` expect time travel. A real
 * system offers none of those. It has some tools, some of which read; it may
 * have a way to put things back; and it very often has no way at all to tell
 * you everything it knows.
 *
 * The tempting fix is to make the missing pieces optional and let each caller
 * cope. That is how a product ends up quietly scoring an agent against a world
 * it could not actually see, and reporting a confident PASS. So instead an
 * adapter says up front what it can do, and everything downstream is obliged to
 * degrade *visibly*: fewer cases, a weaker verdict, and a sentence saying which
 * and why.
 *
 * The rule this file exists to enforce: RigorRun may be less capable against a
 * real system than against a fake one, but it may never be less honest.
 */

/** Where the record and field vocabulary comes from. */
export type DiscoveryCapability =
  /** The adapter publishes a full typed schema, roles and all. */
  | 'declared-schema'
  /** Only a list of operations. Record shape has to be induced and confirmed. */
  | 'tools-only';

/** How much of the world RigorRun can read back after an agent has finished. */
export type StateReadCapability =
  /** Every row of every record type. Only in-process environments manage this. */
  | 'full'
  /** Whatever a nominated set of read operations returns. Partial by nature. */
  | 'designated-reads'
  /** Nothing. The only evidence is what the agent was seen to do. */
  | 'none';

/** Whether RigorRun can put the world into a chosen starting position. */
export type SeedCapability =
  /** Any state can be installed, so a case can require an exact world. */
  | 'arbitrary'
  /** Nothing can be installed. Cases must find a world that already fits. */
  | 'none';

/** How the world is returned to a known position between cases. */
export type ResetCapability =
  | 'snapshot'
  /** A tool the environment publishes, nominated by the operator. */
  | 'tool'
  /** An HTTP endpoint the operator configured. */
  | 'endpoint'
  /** A command the operator configured, run locally. */
  | 'command'
  | 'none';

/** Where the record of what happened comes from. */
export type EventsCapability =
  /** The environment itself logs actions and RigorRun can read that log. */
  | 'authoritative'
  /** RigorRun saw the calls go past because they went through its proxy. */
  | 'proxy-log'
  | 'none';

/**
 * What kind of system this is, and therefore what may be done to it.
 *
 * There is no safe default here, which is why there is no default. Somebody has
 * to say, and saying `production` has consequences.
 */
export type SafetyMode = 'production' | 'staging' | 'local' | 'ephemeral';

export interface EnvironmentCapabilities {
  discovery: DiscoveryCapability;
  stateRead: StateReadCapability;
  seed: SeedCapability;
  reset: ResetCapability;
  events: EventsCapability;
  safety: SafetyMode;
}

/**
 * What an in-process environment can do, which is everything.
 *
 * Kept as a named constant rather than a default parameter: a real adapter that
 * wants to claim all of this has to reach for this name, and reaching for a
 * constant called FULL is a thing a reviewer can see.
 */
export const FULL_CAPABILITIES: EnvironmentCapabilities = {
  discovery: 'declared-schema',
  stateRead: 'full',
  seed: 'arbitrary',
  reset: 'snapshot',
  events: 'authoritative',
  safety: 'ephemeral',
};

// ------------------------------------------------------------------ verdicts

/**
 * How much a verdict from this environment is worth.
 *
 * Not a score. A label, which travels with the result and is rendered
 * differently, for the same reason `DETERMINISTIC` and `MODEL-JUDGED` are
 * rendered differently: a reader must never have to work out for themselves
 * whether the machine actually checked.
 */
export type VerificationStrength =
  /** The system of record was read back. A verdict means what it says. */
  | 'AUTHORITATIVE'
  /** Some of the system was read back. Checks outside that are inapplicable. */
  | 'PARTIAL'
  /** Nothing was read back. Only the agent's actions were observed. */
  | 'OBSERVATIONAL';

export function verificationStrength(caps: EnvironmentCapabilities): VerificationStrength {
  if (caps.stateRead === 'full') return 'AUTHORITATIVE';
  if (caps.stateRead === 'designated-reads') return 'PARTIAL';
  return 'OBSERVATIONAL';
}

/** Whether each case genuinely started from the same place as the last one. */
export type IsolationLevel =
  /** The world was restored between cases. Results are independent. */
  | 'RESET'
  /** No reset. Every case inherited whatever the previous one left behind. */
  | 'NONE';

export function isolationLevel(caps: EnvironmentCapabilities): IsolationLevel {
  return caps.reset === 'none' ? 'NONE' : 'RESET';
}

/**
 * Whether a case that changes the world may be run more than once.
 *
 * The dangerous combination is not "no reset" on its own — running a mutation
 * once against a scratch system is fine. It is repetition without reset, where
 * the second attempt starts from the wreckage of the first and the numbers mean
 * nothing, and it is mutation against production, which is somebody's real day.
 */
export function mayRepeatMutatingCases(caps: EnvironmentCapabilities): boolean {
  return caps.reset !== 'none';
}

export function mayMutateAtAll(caps: EnvironmentCapabilities): boolean {
  return caps.safety !== 'production';
}

// --------------------------------------------------------------- explanation

/** A limit, and what a person could do about it. */
export interface CapabilityLimit {
  /** Stable id, so the UI can attach an action to it. */
  id: string;
  /** What RigorRun cannot do, in one sentence. */
  limit: string;
  /** What would lift it. Empty when nothing would. */
  remedy: string;
}

/**
 * Every way this environment constrains what RigorRun can claim.
 *
 * Written to be shown, not logged. Each entry is what a person reads when they
 * ask why a suite is smaller than they expected or why a verdict is hedged, and
 * "you have not configured a reset" is a far better answer than a silently
 * shorter list of cases.
 */
export function capabilityLimits(caps: EnvironmentCapabilities): CapabilityLimit[] {
  const limits: CapabilityLimit[] = [];

  if (caps.stateRead === 'none') {
    limits.push({
      id: 'no_state_read',
      limit:
        'RigorRun can see what the agent did, but cannot read the system afterwards to check ' +
        'whether it worked.',
      remedy: 'Nominate one or more read operations as verifier reads.',
    });
  } else if (caps.stateRead === 'designated-reads') {
    limits.push({
      id: 'partial_state_read',
      limit:
        'RigorRun reads back only what the nominated read operations return. Anything outside ' +
        'them cannot be checked.',
      remedy: 'Nominate more read operations to widen what can be verified.',
    });
  }

  if (caps.reset === 'none') {
    limits.push({
      id: 'no_reset',
      limit:
        'There is no way to put this system back, so cases cannot be isolated from each other ' +
        'and repeated mutation tests are switched off.',
      remedy: 'Configure a reset: a tool, an endpoint, or a local command.',
    });
  }

  if (caps.seed === 'none') {
    limits.push({
      id: 'no_seed',
      limit:
        'RigorRun cannot install a starting world, so it can only build cases out of situations ' +
        'that already exist here.',
      remedy: '',
    });
  }

  if (caps.discovery === 'tools-only') {
    limits.push({
      id: 'induced_schema',
      limit:
        'This system publishes operations but not a record schema, so the record shapes were ' +
        'worked out from what came back and need confirming.',
      remedy: 'Review the inferred records and correct anything wrong.',
    });
  }

  if (caps.safety === 'production') {
    limits.push({
      id: 'production',
      limit: 'This is marked production, so RigorRun will not run anything that writes.',
      remedy: 'Point at a staging or scratch system, or enable individual write actions.',
    });
  }

  if (caps.events === 'none') {
    limits.push({
      id: 'no_events',
      limit: 'There is no action log, so the evidence timeline will be empty.',
      remedy: 'Route the agent through the RigorRun proxy so its calls are recorded.',
    });
  }

  return limits;
}
