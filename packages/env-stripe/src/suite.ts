/**
 * The Stripe pack's suite: its contract and its benchmark, from a policy and
 * the owner's answers about the rules.
 *
 * This is what `PackDefinition.suite` hands the daemon in place of a compiled
 * one. It is deterministic — the same policy, answers and date give the same
 * bytes — so a suite written into a project can be rebuilt and compared, and
 * the benchmark carries the hash of the very contract it was built with.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  BENCHMARK_SCHEMA_VERSION,
  canonicalJson,
  parseBenchmark,
  parseEnvironmentContract,
  type EnvironmentContract,
} from '@rigorrun/core';
import type { PackSuite } from '@rigorrun/environment';
import { STRIPE_PACK_ID } from './conventions.ts';
import {
  parseStripePolicy,
  StripePolicySchema,
  type StripePolicy,
  type StripePolicyInput,
} from './policy.ts';
import {
  confirmRules,
  STRIPE_FOCUS_ENTITY,
  STRIPE_PROJECTION_FOCUS,
  STRIPE_REFUND_ACTION,
  stripeContract,
} from './rules.ts';
import { stripeCases } from './scenarios.ts';

export const STRIPE_SUITE_ID = 'bm_stripe_refunds';

/**
 * The day this suite was written, and the default date on what it builds, so
 * that the same answers give the same suite. A project setting up passes its
 * own date.
 */
export const STRIPE_SUITE_WRITTEN = '2026-10-01T00:00:00.000Z';

export interface StripeSuiteOptions {
  /** Rules the owner said yes to. The rest stay `inferred`, and their checks do not block. */
  confirmedRuleIds?: readonly string[];
  /** When the suite was made, and when the rules were confirmed. */
  createdAt?: string;
  /** Add the $1.00 canary case after every other one. Not a qualification case. */
  canary?: boolean;
}

export function stripeSuite(
  policy: StripePolicyInput | StripePolicy = {},
  options: StripeSuiteOptions = {},
): PackSuite {
  const parsed = parseStripePolicy(policy);
  const createdAt = options.createdAt ?? STRIPE_SUITE_WRITTEN;
  const reviewed = confirmRules(
    stripeContract(parsed, createdAt),
    options.confirmedRuleIds ?? [],
    createdAt,
  );
  const cases = stripeCases(parsed, reviewed, { canary: options.canary === true });

  // Each rule names the checks and the cases it produced, so a failure can be
  // traced from the verdict back to the sentence of the policy it broke.
  const contract = parseEnvironmentContract({
    ...reviewed,
    rules: reviewed.rules.map((rule) => {
      const mine = cases.flatMap((testCase) =>
        testCase.checks
          .filter((check) => check.ruleId === rule.id)
          .map((check) => ({ caseId: testCase.id, checkId: check.id })),
      );
      return {
        ...rule,
        generatedAssertions: mine.map((entry) => entry.checkId),
        generatedCases: [...new Set(mine.map((entry) => entry.caseId))],
      };
    }),
  });

  const benchmark = parseBenchmark({
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    id: STRIPE_SUITE_ID,
    name: 'Stripe refund desk',
    description:
      'The Stripe pack’s own suite: the tickets of its pre-registration ' +
      '(reports/stripe-pack-2026-10/PREREGISTRATION.md), each against payments made fresh for ' +
      'it' +
      (parsed.escalateAbove === undefined ? '.' : ', and one above the approval threshold.'),
    environment: STRIPE_PACK_ID,
    contractId: contract.id,
    contractHash: contractHash(contract),
    generator: 'deterministic',
    createdAt,
    cases,
    notTestable: [],
    projectionFocus: [...STRIPE_PROJECTION_FOCUS],
    workflow: {
      primaryAction: STRIPE_REFUND_ACTION,
      remedyActions: [],
      completionActions: [],
      focusEntity: STRIPE_FOCUS_ENTITY,
    },
  });

  return { contract, benchmark };
}

/** What `PackDefinition.suite` receives, as the daemon stores it. */
export const StripeSuiteParamsSchema = z
  .object({
    policy: StripePolicySchema.optional(),
    confirmedRuleIds: z.array(z.string().min(1)).default([]),
    createdAt: z.string().min(1).optional(),
    canary: z.boolean().default(false),
  })
  .strict();
export type StripeSuiteParams = z.input<typeof StripeSuiteParamsSchema>;

/** `stripeSuite` from parameters nothing has checked yet. */
export function stripeSuiteFromParams(params: unknown = {}): PackSuite {
  const parsed = StripeSuiteParamsSchema.parse(params ?? {});
  return stripeSuite(parsed.policy ?? {}, {
    confirmedRuleIds: parsed.confirmedRuleIds,
    canary: parsed.canary,
    ...(parsed.createdAt === undefined ? {} : { createdAt: parsed.createdAt }),
  });
}

/**
 * The same `sha256:` hash `hashValue` gives, computed synchronously because
 * `PackDefinition.suite` is. A test holds the two equal.
 */
function contractHash(contract: EnvironmentContract): string {
  return `sha256:${createHash('sha256').update(canonicalJson(contract)).digest('hex')}`;
}
