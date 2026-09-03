/**
 * Workflow contract — the executable description of "the job", compiled from a
 * human's real execution trace.
 *
 * The honesty rule this schema exists to enforce: watching a person do a task
 * once does not reveal a company's policy. Every rule therefore carries where
 * it came from and how confident RigorRun is, and anything generalised beyond
 * what was literally observed is flagged for human confirmation before it is
 * allowed to fail an agent.
 *
 * Note on the shape: rules are stored once, in the list they belong to, and
 * carry `source`. There is no separate `inferredRules` array to drift out of
 * sync — use the `inferredRules()` accessor for the "needs review" bucket.
 */
import { z } from 'zod';
import { CONTRACT_SCHEMA_VERSION } from './versions.ts';
import { AssertionSchema } from './assertion.ts';

export { CONTRACT_SCHEMA_VERSION } from './versions.ts';

export const RuleSourceSchema = z.enum(['observed', 'inferred', 'user_confirmed']);
export type RuleSource = z.infer<typeof RuleSourceSchema>;

export const ContractRuleSchema = z.object({
  id: z.string().min(1),
  /** The rule in plain language, e.g. "an open support ticket exists". */
  rule: z.string().min(1),
  source: RuleSourceSchema,
  confidence: z.number().min(0).max(1),
  /**
   * True when RigorRun generalised beyond the single observed run and a human
   * should confirm before this rule is used to fail an agent.
   */
  needsConfirmation: z.boolean().default(false),
  /** Trace event ids / observed fact ids this rule was derived from. */
  evidence: z.array(z.string()).default([]),
  /** Machine-checkable form, when one exists. */
  check: z.string().optional(),
});
export type ContractRule = z.infer<typeof ContractRuleSchema>;

export const ObservedFactSchema = z.object({
  id: z.string().min(1),
  /** e.g. `refund.amount`, `ticket.status`, `navigation.path`. */
  key: z.string().min(1),
  value: z.unknown(),
  /** Trace event ids that produced this fact. */
  evidence: z.array(z.string()).default([]),
});
export type ObservedFact = z.infer<typeof ObservedFactSchema>;

export const UncertaintyItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  /** Why RigorRun cannot answer this from one trace. */
  reason: z.string().min(1),
  relatedRuleIds: z.array(z.string()).default([]),
  /** Set once the human answers during contract review. */
  answer: z.string().optional(),
});
export type UncertaintyItem = z.infer<typeof UncertaintyItemSchema>;

export const WorkflowContractSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  goal: z.string().min(1),

  preconditions: z.array(ContractRuleSchema).default([]),
  requiredActions: z.array(ContractRuleSchema).default([]),
  forbiddenActions: z.array(ContractRuleSchema).default([]),
  invariants: z.array(ContractRuleSchema).default([]),

  successAssertions: z.array(AssertionSchema).default([]),
  policyAssertions: z.array(AssertionSchema).default([]),

  observedFacts: z.array(ObservedFactSchema).default([]),
  uncertainty: z.array(UncertaintyItemSchema).default([]),

  /** Identifier of the environment the contract is executable against. */
  environment: z.string().default('northstar'),
  sourceTraceId: z.string().optional(),
  createdAt: z.string(),
  approvedAt: z.string().optional(),
});
export type WorkflowContract = z.infer<typeof WorkflowContractSchema>;

/** Every normative rule in the contract, regardless of which list it lives in. */
export function allRules(contract: WorkflowContract): ContractRule[] {
  return [
    ...contract.preconditions,
    ...contract.requiredActions,
    ...contract.forbiddenActions,
    ...contract.invariants,
  ];
}

/** Rules taken straight from what the human actually did. */
export function observedRules(contract: WorkflowContract): ContractRule[] {
  return allRules(contract).filter((r) => r.source === 'observed');
}

/** Rules RigorRun generalised — the "review this" bucket. */
export function inferredRules(contract: WorkflowContract): ContractRule[] {
  return allRules(contract).filter((r) => r.source === 'inferred');
}

/** Rules a human explicitly approved. */
export function confirmedRules(contract: WorkflowContract): ContractRule[] {
  return allRules(contract).filter((r) => r.source === 'user_confirmed');
}

/** Rules still blocking approval. */
export function rulesNeedingConfirmation(contract: WorkflowContract): ContractRule[] {
  return allRules(contract).filter((r) => r.needsConfirmation && r.source !== 'user_confirmed');
}

export function parseContract(input: unknown): WorkflowContract {
  return WorkflowContractSchema.parse(input);
}
