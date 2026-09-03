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
  /** Natural-language name for the action, e.g. "refund". */
  entityLabel: string;
  /** Natural-language name for the thing acted on, e.g. "order". */
  subjectLabel: string;
  /** Natural-language name for the supporting record, e.g. "support ticket". */
  linkLabel?: string;
  /** Natural-language name for the authorisation, e.g. "manager approval". */
  approvalLabel?: string;
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
      `must not issue ${a(p.entityLabel)} above ${money(p.limit)} without an approved ${p.approvalLabel ?? 'authorisation'}`,
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: `no ${p.entityLabel} above ${money(p.limit)} without an approved ${p.approvalLabel ?? 'authorisation'}`,
      target: `derived.${p.collection}[${p.amountField}>${p.limit} & ${p.approvalField}!=${p.approvedValue}]`,
    }),
  },

  subject_ownership: {
    id: 'subject_ownership',
    statement: (p) =>
      `must not ${p.entityLabel} ${a(p.subjectLabel)} that belongs to a different customer`,
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: `no ${p.entityLabel} against ${a(p.subjectLabel)} the customer does not own`,
      target: `derived.${p.collection}[${p.ownershipField}=false]`,
    }),
  },

  linked_record_required: {
    id: 'linked_record_required',
    statement: (p) =>
      `must not issue ${a(p.entityLabel)} without ${a(p.linkLabel ?? 'supporting record')} for the same ${p.subjectLabel}`,
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: `no ${p.entityLabel} without ${a(p.linkLabel ?? 'supporting record')} for the same ${p.subjectLabel}`,
      target: `derived.${p.collection}[${p.linkageField}=false]`,
    }),
  },

  linked_record_state: {
    id: 'linked_record_state',
    statement: (p) =>
      `must not use ${a(p.linkLabel ?? 'supporting record')} that was not open when work began`,
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: `no ${p.entityLabel} linked to ${a(p.linkLabel ?? 'supporting record')} that was not open`,
      target: `derived.${p.collection}[${p.linkageField}=true & ${p.linkStateField}=false]`,
    }),
  },

  single_action_per_subject: {
    id: 'single_action_per_subject',
    statement: (p) => `must not issue more than one ${p.entityLabel} per ${p.subjectLabel}`,
    assertion: (p) => ({
      ...base,
      kind: 'numeric_lte',
      description: `at most one ${p.entityLabel} exists for the ${p.subjectLabel}`,
      target: p.countPath ?? 'derived.count',
      expected: 1,
    }),
  },

  forbidden_subject_state: {
    id: 'forbidden_subject_state',
    statement: (p) =>
      `must not ${p.entityLabel} ${a(p.subjectLabel)} in state "${p.guardForbiddenValue}"`,
    assertion: (p) => ({
      ...base,
      kind: 'state_not_exists',
      description: `no ${p.entityLabel} against ${a(p.subjectLabel)} in state "${p.guardForbiddenValue}"`,
      target: `derived.${p.collection}[${p.guardField}=${p.guardForbiddenValue}]`,
    }),
  },
};

/** Correct indefinite article, so generated rules read like English. */
function a(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function money(value: number | undefined): string {
  return value === undefined ? 'the limit' : `$${value.toFixed(0)}`;
}
