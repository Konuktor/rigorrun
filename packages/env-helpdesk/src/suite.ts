/**
 * The Larch Helpdesk pack's own suite: its six cases, each against a world the
 * twin is given fresh, held to the rules the owner confirmed.
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
import { HELPDESK_PACK_ID } from './conventions.ts';
import {
  confirmHelpdeskRules,
  HELPDESK_FOCUS_ENTITY,
  HELPDESK_PROJECTION_FOCUS,
  HELPDESK_REFUND_ACTION,
  helpdeskContract,
} from './rules.ts';
import { helpdeskCases } from './scenarios.ts';

export const HELPDESK_SUITE_ID = 'bm_helpdesk_larch';
export const HELPDESK_SUITE_WRITTEN = '2026-10-02T00:00:00.000Z';

export interface HelpdeskSuiteOptions {
  /** Rules the owner said yes to. The rest cannot fail an agent. */
  confirmedRuleIds?: readonly string[];
  createdAt?: string;
}

export function helpdeskSuite(options: HelpdeskSuiteOptions = {}): PackSuite {
  const createdAt = options.createdAt ?? HELPDESK_SUITE_WRITTEN;
  const reviewed = confirmHelpdeskRules(
    helpdeskContract(createdAt),
    options.confirmedRuleIds ?? [],
    createdAt,
  );
  const cases = helpdeskCases(reviewed);

  // Each rule names the checks and cases it produced, so a failure traces back
  // to the sentence of the policy it broke.
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
    id: HELPDESK_SUITE_ID,
    name: 'Larch Helpdesk — Alder Outdoor support',
    description:
      'The Larch Helpdesk pack’s own suite: tickets for a support agent acting for one ' +
      'organisation, each against a twin world given fresh, checked against what the twin ' +
      'recorded — its tables, its access log and its outbox.',
    environment: HELPDESK_PACK_ID,
    contractId: contract.id,
    contractHash: contractHash(contract),
    generator: 'deterministic',
    createdAt,
    cases,
    notTestable: [],
    projectionFocus: [...HELPDESK_PROJECTION_FOCUS],
    workflow: {
      primaryAction: HELPDESK_REFUND_ACTION,
      remedyActions: [],
      completionActions: [],
      focusEntity: HELPDESK_FOCUS_ENTITY,
    },
  });

  return { contract, benchmark };
}

export const HelpdeskSuiteParamsSchema = z
  .object({
    confirmedRuleIds: z.array(z.string().min(1)).default([]),
    createdAt: z.string().min(1).optional(),
  })
  .strict();
export type HelpdeskSuiteParams = z.input<typeof HelpdeskSuiteParamsSchema>;

export function helpdeskSuiteFromParams(params: unknown = {}): PackSuite {
  const parsed = HelpdeskSuiteParamsSchema.parse(params ?? {});
  return helpdeskSuite({
    confirmedRuleIds: parsed.confirmedRuleIds,
    ...(parsed.createdAt === undefined ? {} : { createdAt: parsed.createdAt }),
  });
}

function contractHash(contract: EnvironmentContract): string {
  return `sha256:${createHash('sha256').update(canonicalJson(contract)).digest('hex')}`;
}
