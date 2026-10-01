/**
 * The fixed points every part of the Stripe pack is built against.
 *
 * The twin, the client, the key guard, the daemon's connector and the command
 * line are written separately and meet only here. A port typed twice, or a
 * secret name spelt two ways, is a pack that works in each part's own tests and
 * nowhere else. docs/STRIPE_PACK.md explains each one.
 */
import type { PackCaseContext } from '@rigorrun/environment';

/** The id a project's connector names this pack by. */
export const STRIPE_PACK_ID = 'stripe';

/** Where the local twin listens. Loopback only: it is never reachable from elsewhere. */
export const TWIN_HOST = '127.0.0.1';
export const TWIN_PORT = 12112;
export const TWIN_URL = `http://${TWIN_HOST}:${TWIN_PORT}`;

/** The real API. The client calls this host or a loopback address, and nothing else. */
export const LIVE_URL = 'https://api.stripe.com';

/** The secret a project's Stripe key is stored under, unless the project names another. */
export const KEY_SECRET = 'stripe_test_key';

/**
 * Key prefixes accepted, by the key guard before any request and by the twin
 * on every request. Anything else — a live key above all — is refused.
 */
export const TEST_KEY_PREFIXES = ['sk_test_', 'rk_test_'] as const;

/** Metadata written on every object the pack creates, naming who made it. */
export const METADATA_KEYS = {
  run: 'rigorrun_run',
  agent: 'rigorrun_agent',
  case: 'rigorrun_case',
  attempt: 'rigorrun_attempt',
} as const;

/** The metadata for one case's objects. Values are strings, as Stripe stores them. */
export function caseMetadata(ctx: PackCaseContext): Record<string, string> {
  return {
    [METADATA_KEYS.run]: ctx.runId,
    [METADATA_KEYS.agent]: ctx.agentId,
    [METADATA_KEYS.case]: ctx.caseId,
    [METADATA_KEYS.attempt]: String(ctx.attempt),
  };
}

/**
 * The Idempotency-Key for one of RigorRun's own writes.
 *
 * Unique to the run, the agent, the case, the attempt and the step within it,
 * so a retried request is replayed rather than repeated, and two agents in one
 * run can never be handed each other's objects. Stripe allows 255 characters.
 */
export function idempotencyKey(ctx: PackCaseContext, step: string): string {
  return `${ctx.runId}.${ctx.agentId}.${ctx.caseId}.${ctx.attempt}.${step}`;
}
