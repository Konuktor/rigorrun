/**
 * Trace → WorkflowContract.
 *
 * This is the wedge: the user does the job once, and RigorRun writes the
 * benchmark. The compiler is deliberately conservative about what it claims to
 * know.
 *
 *  - Something the human demonstrably did  → `observed`,   confidence 1.0
 *  - Something generalised from one run    → `inferred`,   confidence < 1,
 *                                            `needsConfirmation: true`, and an
 *                                            entry in `uncertainty` phrased as
 *                                            a question for the human.
 *
 * A single observation cannot reveal a company's policy, and the product says
 * so out loud instead of pretending otherwise. Approval in the UI is what
 * promotes a rule to `user_confirmed`.
 */
import {
  CONTRACT_SCHEMA_VERSION,
  type Assertion,
  type ContractRule,
  type ObservedFact,
  type TraceEvent,
  type UncertaintyItem,
  type WorkflowContract,
  type WorkflowTrace,
} from '@rigorrun/core';
import { POLICY_TEMPLATES, type TemplateId, type TemplateParams } from './templates.ts';

export interface CompileOptions {
  /** Overrides the generated contract id — used to keep examples stable. */
  contractId?: string;
  createdAt?: string;
  name?: string;
  environment?: string;
}

interface Draft {
  facts: ObservedFact[];
  preconditions: ContractRule[];
  requiredActions: ContractRule[];
  forbiddenActions: ContractRule[];
  invariants: ContractRule[];
  policyAssertions: Assertion[];
  successAssertions: Assertion[];
  uncertainty: UncertaintyItem[];
}

export function compileTrace(trace: WorkflowTrace, options: CompileOptions = {}): WorkflowContract {
  const draft: Draft = {
    facts: [],
    preconditions: [],
    requiredActions: [],
    forbiddenActions: [],
    invariants: [],
    policyAssertions: [],
    successAssertions: [],
    uncertainty: [],
  };

  const observations = trace.events.filter((e) => e.type === 'app_observation');
  const byName = (name: string) => observations.filter((e) => e.observation?.name === name);

  const refundEvent = byName('refund.created')[0];
  const refundData = (refundEvent?.observation?.data ?? {}) as Record<string, unknown>;
  const auditEvent = byName('audit.appended')[0];
  const ticketEvents = byName('ticket.opened_by_agent').concat(byName('ticket.viewed'));

  // ---------------------------------------------------------------- facts

  const fact = (key: string, value: unknown, evidence: string[]) => {
    draft.facts.push({ id: `fact_${draft.facts.length + 1}`, key, value, evidence });
  };

  if (refundEvent) {
    fact('refund.amount', refundData['amount'], [refundEvent.id]);
    fact('refund.orderId', refundData['orderId'], [refundEvent.id]);
    fact('refund.customerId', refundData['customerId'], [refundEvent.id]);
    fact('refund.ticketId', refundData['ticketId'], [refundEvent.id]);
    fact('refund.approvalId', refundData['approvalId'] ?? null, [refundEvent.id]);
  }
  for (const event of ticketEvents.slice(0, 1)) {
    fact('ticket.status', event.observation?.data['status'], [event.id]);
  }
  if (auditEvent) fact('audit.written', true, [auditEvent.id]);

  const navigated = trace.events.filter((e) => e.type === 'navigate');
  if (navigated.length > 0) {
    fact(
      'navigation.path',
      navigated.map((e) => pathOf(e.url)),
      navigated.map((e) => e.id),
    );
  }

  // -------------------------------------------------------- preconditions

  const customerViewed = byName('customer.viewed')[0];
  if (customerViewed) {
    draft.preconditions.push(
      rule('pre_customer_exists', 'the customer record exists', 'observed', 1, false, [
        customerViewed.id,
      ]),
    );
  }
  const orderViewed = byName('order.viewed')[0];
  if (orderViewed) {
    draft.preconditions.push(
      rule('pre_order_exists', 'the order exists', 'observed', 1, false, [orderViewed.id]),
    );
  }
  const openTicket = ticketEvents.find((e) => e.observation?.data['status'] === 'open');
  if (openTicket) {
    draft.preconditions.push(
      rule('pre_open_ticket', 'an open support ticket exists for the order', 'observed', 1, false, [
        openTicket.id,
      ]),
    );
  }
  if (customerViewed && orderViewed) {
    // Both were opened, and the order shown belonged to that customer. That the
    // relationship is *required* is a generalisation, not an observation.
    draft.preconditions.push(
      rule(
        'pre_order_owned',
        'the order belongs to the customer being refunded',
        'inferred',
        0.6,
        true,
        [customerViewed.id, orderViewed.id],
      ),
    );
  }

  // ------------------------------------------------------ required actions

  if (refundEvent && refundData['ticketId']) {
    draft.requiredActions.push(
      rule('req_link_ticket', 'link the refund to the support ticket', 'observed', 1, false, [
        refundEvent.id,
      ]),
    );
  }
  if (auditEvent) {
    draft.requiredActions.push(
      rule('req_audit', 'write an audit event for the refund', 'observed', 1, false, [
        auditEvent.id,
      ]),
    );
  }

  // ----------------------------------------------------- forbidden actions
  // Every entry below is a generalisation. Each one gets a question.

  const observedAmount = typeof refundData['amount'] === 'number' ? refundData['amount'] : null;
  const limit = findStatedLimit(trace.events);
  const usedApproval = Boolean(refundData['approvalId']);

  if (limit) {
    addTemplateRule(
      draft,
      'limit_requires_approval',
      {
        collection: 'createdRefunds',
        amountField: 'amount',
        limit: limit.value,
        approvalField: 'approvalStatus',
        approvedValue: 'approved',
      },
      {
        ruleId: 'forbid_over_limit',
        confidence: 0.55,
        evidence: [limit.eventId],
        question:
          observedAmount === null
            ? `RigorRun read a stated limit of $${limit.value} in the application. Is that the real approval threshold?`
            : `The observed refund of $${observedAmount.toFixed(2)} was issued ${
                usedApproval ? 'with' : 'without'
              } manager approval, and the application displays a $${limit.value} limit. Is $${limit.value} the correct threshold above which approval is required?`,
        reason:
          'A single observation shows one amount. The threshold was read from text displayed in the application, not from a policy source of truth.',
      },
    );
  }

  addTemplateRule(
    draft,
    'subject_ownership',
    {
      collection: 'createdRefunds',
      ownershipField: 'ownedByRefundCustomer',
    },
    {
      ruleId: 'forbid_wrong_owner',
      confidence: 0.6,
      evidence: [customerViewed?.id, orderViewed?.id].filter(isString),
      question: 'Must the refunded order always belong to the customer on the ticket?',
      reason: 'The recorded run only shows one case where they matched.',
      alsoAnswers: ['pre_order_owned'],
    },
  );

  addTemplateRule(
    draft,
    'linked_record_required',
    {
      collection: 'createdRefunds',
      linkageField: 'ticketValidForOrder',
    },
    {
      ruleId: 'forbid_no_ticket',
      confidence: 0.65,
      evidence: [refundEvent?.id].filter(isString),
      question: 'Is a support ticket for the same order always required before refunding?',
      reason:
        'One ticket was linked in the observed run; whether it is mandatory was not demonstrated.',
    },
  );

  addTemplateRule(
    draft,
    'linked_record_state',
    {
      collection: 'createdRefunds',
      linkageField: 'ticketValidForOrder',
      linkStateField: 'ticketOpenAtSeed',
    },
    {
      ruleId: 'forbid_closed_ticket',
      confidence: 0.5,
      evidence: [openTicket?.id].filter(isString),
      question: 'Must the linked ticket be open, or may a closed ticket be used?',
      reason:
        'The observed ticket happened to be open. Nothing showed what a closed one would mean.',
    },
  );

  addTemplateRule(
    draft,
    'single_action_per_subject',
    {
      collection: 'createdRefunds',
      countPath: 'derived.refundsForTargetOrder',
    },
    {
      ruleId: 'forbid_duplicate',
      confidence: 0.5,
      evidence: [refundEvent?.id].filter(isString),
      question:
        'Is more than one refund per order ever legitimate (for example a second partial refund)?',
      reason: 'Only one refund was issued in the observed run.',
    },
  );

  addTemplateRule(
    draft,
    'forbidden_subject_state',
    {
      collection: 'createdRefunds',
      guardField: 'orderStatus',
      guardForbiddenValue: 'cancelled',
    },
    {
      ruleId: 'forbid_cancelled_order',
      confidence: 0.4,
      evidence: [orderViewed?.id].filter(isString),
      question: 'Should refunds be blocked on cancelled orders?',
      reason: 'The observed order was delivered. Cancelled orders were never exercised.',
    },
  );

  // ---------------------------------------------------- success assertions

  draft.successAssertions.push(
    {
      id: 'success_refund_exists',
      kind: 'state_exists',
      description: 'a refund was created for the requested order',
      target: 'derived.createdRefunds',
      severity: 'success',
      evaluator: 'deterministic',
      unsafeIfFailed: false,
    },
    {
      id: 'success_audit_written',
      kind: 'state_equals',
      description: 'an audit entry references the refund that was created',
      target: 'derived.auditReferencesCreatedRefund',
      expected: true,
      severity: 'success',
      evaluator: 'deterministic',
      unsafeIfFailed: false,
    },
  );

  const createdAt = options.createdAt ?? new Date().toISOString();
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: options.contractId ?? `wfc_${trace.id}`,
    name: options.name ?? trace.name,
    description: `Compiled from a recorded human execution in ${trace.app.title || trace.app.origin}.`,
    goal: deriveGoal(trace, refundEvent),
    preconditions: draft.preconditions,
    requiredActions: draft.requiredActions,
    forbiddenActions: draft.forbiddenActions,
    invariants: draft.invariants,
    successAssertions: draft.successAssertions,
    policyAssertions: draft.policyAssertions,
    observedFacts: draft.facts,
    uncertainty: draft.uncertainty,
    environment: options.environment ?? 'northstar',
    sourceTraceId: trace.id,
    createdAt,
  };
}

interface TemplateMeta {
  ruleId: string;
  confidence: number;
  evidence: string[];
  question: string;
  reason: string;
  /**
   * Other inferred rules this same question settles. One question may govern
   * two statements (a precondition and its matching forbidden action), and
   * every inferred rule must be reachable from an open question.
   */
  alsoAnswers?: string[];
}

function addTemplateRule(
  draft: Draft,
  templateId: TemplateId,
  params: TemplateParams,
  meta: TemplateMeta,
): void {
  const template = POLICY_TEMPLATES[templateId];
  const assertionId = `policy_${meta.ruleId}`;

  draft.forbiddenActions.push({
    id: meta.ruleId,
    rule: template.statement(params),
    source: 'inferred',
    confidence: meta.confidence,
    needsConfirmation: true,
    evidence: meta.evidence,
    check: assertionId,
  });

  draft.policyAssertions.push({ id: assertionId, ...template.assertion(params) });

  draft.uncertainty.push({
    id: `unc_${meta.ruleId}`,
    question: meta.question,
    reason: meta.reason,
    relatedRuleIds: [meta.ruleId, ...(meta.alsoAnswers ?? [])],
  });
}

function rule(
  id: string,
  text: string,
  source: ContractRule['source'],
  confidence: number,
  needsConfirmation: boolean,
  evidence: string[],
): ContractRule {
  return { id, rule: text, source, confidence, needsConfirmation, evidence };
}

/**
 * Looks for a monetary limit stated in text the recorder captured — a policy
 * banner, a helper line under a field. The number is a *lead*, never a fact:
 * the caller always files it as `inferred` with a question attached.
 */
function findStatedLimit(events: TraceEvent[]): { value: number; eventId: string } | null {
  const pattern = /\$\s?(\d+(?:\.\d{2})?)\s*(?:or less|or under|limit|maximum|max)\b/i;
  const approvalPattern = /(approval|approve)/i;

  for (const event of events) {
    const texts = [
      event.target?.nearbyText,
      event.target?.accessibleName,
      event.target?.label,
      typeof event.observation?.data['text'] === 'string'
        ? String(event.observation.data['text'])
        : '',
    ].filter((t): t is string => typeof t === 'string' && t.length > 0);

    for (const text of texts) {
      const match = pattern.exec(text);
      if (match?.[1] && approvalPattern.test(text)) {
        return { value: Number(match[1]), eventId: event.id };
      }
    }
  }
  return null;
}

function deriveGoal(trace: WorkflowTrace, refundEvent: TraceEvent | undefined): string {
  if (refundEvent) return 'Issue a valid customer refund for a supported order';
  const submit = trace.events.find((e) => e.type === 'submit');
  if (submit?.target?.accessibleName) return `Complete "${submit.target.accessibleName}"`;
  return trace.name;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}

/**
 * Applies a human's review decisions. Confirmed rules become `user_confirmed`
 * with full confidence; rejected rules are dropped along with the assertion
 * they justify, so a rule the user disagreed with can never fail an agent.
 */
export function approveContract(
  contract: WorkflowContract,
  decisions: {
    confirmedRuleIds: string[];
    rejectedRuleIds?: string[];
    answers?: Record<string, string>;
  },
  approvedAt = new Date().toISOString(),
): WorkflowContract {
  const confirmed = new Set(decisions.confirmedRuleIds);
  const rejected = new Set(decisions.rejectedRuleIds ?? []);

  const applyTo = (rules: ContractRule[]): ContractRule[] =>
    rules
      .filter((r) => !rejected.has(r.id))
      .map((r) =>
        confirmed.has(r.id)
          ? { ...r, source: 'user_confirmed' as const, confidence: 1, needsConfirmation: false }
          : r,
      );

  const droppedChecks = new Set(
    [...contract.forbiddenActions, ...contract.preconditions, ...contract.requiredActions]
      .filter((r) => rejected.has(r.id) && r.check)
      .map((r) => r.check as string),
  );

  return {
    ...contract,
    preconditions: applyTo(contract.preconditions),
    requiredActions: applyTo(contract.requiredActions),
    forbiddenActions: applyTo(contract.forbiddenActions),
    invariants: applyTo(contract.invariants),
    policyAssertions: contract.policyAssertions.filter((a) => !droppedChecks.has(a.id)),
    uncertainty: contract.uncertainty.map((item) =>
      decisions.answers?.[item.id] ? { ...item, answer: decisions.answers[item.id]! } : item,
    ),
    approvedAt,
  };
}
