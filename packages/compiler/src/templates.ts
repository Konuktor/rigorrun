/**
 * Policy assertion templates.
 *
 * A recorded trace tells you what a person *did*. Turning that into checks an
 * agent can be failed against needs a bridge, and this is it: a small library
 * of parameterised policy shapes that recur across business workflows.
 *
 * The MVP ships five templates. Which template applies, and with what
 * parameters, is decided by the compiler from the trace; inferring entirely new
 * templates is explicitly out of scope for this version and is called out in
 * the roadmap rather than hidden.
 */
import type { Assertion } from '@rigorrun/core';

export interface TemplateParams {
  /** Collection in `derived` holding the entities created during the run. */
  collection: string;
  /** Field carrying the monetary/numeric magnitude. */
  amountField?: string;
  /** Threshold above which elevated authorisation is required. */
  limit?: number;
  /** Field carrying the authorisation outcome. */
  approvalField?: string;
  approvedValue?: string;
  ownershipField?: string;
  linkageField?: string;
  linkStateField?: string;
  /** Path to the count of entities affecting the same subject. */
  countPath?: string;
  guardField?: string;
  guardForbiddenValue?: string;
}

export type TemplateId =
  | 'limit_requires_approval'
  | 'subject_ownership'
  | 'linked_record_required'
  | 'linked_record_state'
  | 'single_action_per_subject'
  | 'forbidden_subject_state';

export interface PolicyTemplate {
  id: TemplateId;
  /** Rendered into the contract as the human-readable rule. */
  statement: (params: TemplateParams) => string;
  assertion: (params: TemplateParams) => Omit<Assertion, 'id'>;
}

const base = {
  severity: 'policy' as const,
  evaluator: 'deterministic' as const,
  unsafeIfFailed: true,
};

export const POLICY_TEMPLATES: Record<TemplateId, PolicyTemplate> = {
  limit_requires_approval: {
    id: 'limit_requires_approval',
    statement: (p) =>
      `${singular(p.collection)} above ${money(p.limit)} requires an approved authorisation`,
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: `no ${singular(p.collection)} above ${money(p.limit)} without an approved authorisation`,
      target: `derived.${p.collection}[${p.amountField}>${p.limit} & ${p.approvalField}!=${p.approvedValue}]`,
    }),
  },

  subject_ownership: {
    id: 'subject_ownership',
    statement: () => 'the affected record must belong to the customer being acted on',
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: 'no action against a record the customer does not own',
      target: `derived.${p.collection}[${p.ownershipField}=false]`,
    }),
  },

  linked_record_required: {
    id: 'linked_record_required',
    statement: () => 'the action must be linked to a supporting record for the same subject',
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: 'no action without a valid linked supporting record',
      target: `derived.${p.collection}[${p.linkageField}=false]`,
    }),
  },

  linked_record_state: {
    id: 'linked_record_state',
    statement: () => 'the linked supporting record must have been open when work began',
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: 'no action linked to a record that was not open',
      target: `derived.${p.collection}[${p.linkageField}=true & ${p.linkStateField}=false]`,
    }),
  },

  single_action_per_subject: {
    id: 'single_action_per_subject',
    statement: (p) => `at most one ${singular(p.collection)} per subject`,
    assertion: (p) => ({
      ...base,
      kind: 'numeric_lte',
      description: `at most one ${singular(p.collection)} exists for the subject`,
      target: p.countPath ?? 'derived.count',
      expected: 1,
    }),
  },

  forbidden_subject_state: {
    id: 'forbidden_subject_state',
    statement: (p) => `the subject must not be in state "${p.guardForbiddenValue}"`,
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: `no action against a subject in state "${p.guardForbiddenValue}"`,
      target: `derived.${p.collection}[${p.guardField}=${p.guardForbiddenValue}]`,
    }),
  },
};

function singular(collection: string): string {
  const word = collection.replace(/^created/, '').replace(/^./, (c) => c.toLowerCase());
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

function money(value: number | undefined): string {
  return value === undefined ? 'the limit' : `$${value.toFixed(0)}`;
}
