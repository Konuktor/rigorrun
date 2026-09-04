# Generalization audit

Every place a "generic" package knows something about refunds, with `file:line`
and a verdict. This is the burn-down list for the demonstration-to-eval build;
`scripts/check-domain-leak.mjs` is written from it and keeps it at zero.

Classification:

| Class                 | Meaning                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `compiler-logic`      | Domain knowledge that decides what rules exist. Must be removed.     |
| `derived-projection`  | Hand-written domain joins the verifier depends on. Must be computed. |
| `scenario-data`       | Hand-authored cases standing in for generated ones. Must be derived. |
| `agent-logic`         | Demo agents that only work on one domain. Must become policy-driven. |
| `incidental-name`     | A comment, doc string, example or default. Cosmetic.                 |
| `fixture`             | Legitimately domain-specific. Belongs in an adapter or example.      |

---

## 1. `packages/compiler` — the worst offender

The compiler does not compile workflows. It compiles refunds.

| Location | What | Class |
| --- | --- | --- |
| `src/compile.ts:36-42` | `REFUND_LABELS` constant: `collection: 'createdRefunds'`, `entityLabel: 'refund'`, `subjectLabel: 'order'`, `linkLabel: 'support ticket'`, `approvalLabel: 'manager approval'` | `compiler-logic` |
| `src/compile.ts:80` | `byName('refund.created')` — the whole fact extraction keys off a literal observation name | `compiler-logic` |
| `src/compile.ts:82` | `byName('audit.appended')` | `compiler-logic` |
| `src/compile.ts:83` | `byName('ticket.opened_by_agent')`, `byName('ticket.viewed')` | `compiler-logic` |
| `src/compile.ts:90-94` | Facts hardcoded to `refund.amount`, `refund.orderId`, `refund.customerId`, `refund.ticketId`, `refund.approvalId` | `compiler-logic` |
| `src/compile.ts:108,114` | `byName('customer.viewed')`, `byName('order.viewed')` | `compiler-logic` |
| `src/compile.ts:120` | Ticket status literal `'open'` | `compiler-logic` |
| `src/compile.ts:187` | `ownershipField: 'ownedByRefundCustomer'` | `derived-projection` |
| `src/compile.ts:201,215` | `linkageField: 'ticketValidForOrder'`, `linkStateField: 'ticketOpenAtSeed'` | `derived-projection` |
| `src/compile.ts:229` | `countPath: 'derived.refundsForTargetOrder'` | `derived-projection` |
| `src/compile.ts:241-242` | `guardField: 'orderStatus'`, `guardForbiddenValue: 'cancelled'` | `compiler-logic` |
| `src/compile.ts:255-272` | `successAssertions` hardcoded to `derived.createdRefunds` and `derived.auditReferencesCreatedRefund` | `derived-projection` |
| `src/compile.ts:186-247` | Six rule questions written as English sentences about refunds, orders, tickets and managers | `compiler-logic` |
| `src/compile.ts:335` | `findStatedLimit` regex — generic enough, but the weakest provenance in the system | keep, reclassify |
| `src/compile.ts:355` | `deriveGoal` returns the literal `'Issue a valid customer refund for a supported order'` | `compiler-logic` |
| `src/templates.ts:20-26` | `TemplateParams` doc comments name refund/order/ticket, but the fields are parameterised | `incidental-name` |
| `src/templates.ts:79,83` | Template statements hardcode the word `customer` in ownership rules | `compiler-logic` |

**Verdict:** `compile.ts` is a full rewrite. `templates.ts` survives as a
parameterised library and is extended from 6 templates to 10.

## 2. `packages/northstar/src/observe.ts` — the hidden dependency

Every "generic" assertion in the product resolves against a projection a human
hand-wrote for one domain. This is the real reason the verifier looks generic
and is not.

| Location | What | Class |
| --- | --- | --- |
| `src/observe.ts:21-38` | `DerivedRefund` — `overSelfServeLimit`, `ownedByRefundCustomer`, `ticketValidForOrder`, `ticketOpenAtSeed`, `orderStatus` | `derived-projection` |
| `src/observe.ts:40-56` | `NorthstarDerived` — 15 hand-written rollups including `refundsForTargetOrder`, `auditReferencesCreatedRefund`, `approvedApprovalExists` | `derived-projection` |
| `src/observe.ts:76-100` | `decorate()` — the joins themselves | `derived-projection` |
| `src/observe.ts:117-120` | `auditReferencesCreatedRefund` uses `JSON.stringify(details).includes(id)` — **a live bug**: `REF-1` matches inside `REF-10` | `derived-projection` + defect |
| `src/observe.ts:139-160` | `summariseState` hardcodes refunds / approvals / tickets / audit | `derived-projection` |

**Verdict:** deleted and replaced by a schema-driven projection computed in
`@rigorrun/environment`. The substring-reference bug is fixed by comparing whole
values while generalising.

## 3. `packages/generator` — authored cases, not generated ones

| Location | What | Class |
| --- | --- | --- |
| `src/generate.ts:20` | `import { SCENARIOS, TOOL_NAMES } from '@rigorrun/northstar'` — a generic package depends on a domain package | `scenario-data` |
| `src/generate.ts:23-41` | `CATEGORIES` — 17 literal scenario ids mapped to categories by hand | `scenario-data` |
| `src/generate.ts:44` | `MUTATIONS = { 'tool-failure': ['fail_once:createRefund'] }` | `scenario-data` |
| `src/generate.ts:112-126` | `task.instruction` is a paragraph of refund prose | `compiler-logic` |
| `src/generate.ts:120-123` | `inputs` hardcoded to `customerId` / `orderId` / `requestedAmount` / `reason` | `scenario-data` |
| `src/generate.ts:139-199` | `successChecks()` — every check targets `derived.createdRefunds[...]` | `derived-projection` |
| `src/policy.ts:11-18` | `RefundPolicy` with six named refund booleans | `compiler-logic` |
| `src/policy.ts:23-35` | `readPolicy()` recovers policy by matching literal assertion ids (`policy_forbid_no_ticket`, …) | `compiler-logic` |
| `src/expected.ts:11-88` | `expectedOutcome()` — a hand-written refusal chain over refund concepts | `compiler-logic` |
| `src/expected.ts:59` | **Live bug:** `if (policy.requireLinkedTicket \|\| policy.requireOpenTicket)` then checks only for an *open* ticket, so `requireLinkedTicket` alone still demands an open ticket. Two distinct policies collapsed into one predicate. | defect |
| `src/llm.ts:17` | Prompt mentions Northstar | `incidental-name` |

**Verdict:** `generate.ts`, `policy.ts` and `expected.ts` are rewritten. The
`expected.ts:59` conflation is the exact failure mode the generic evaluator must
avoid: confirmed rules are evaluated **independently**, never merged.

## 4. `packages/runner` — no environment abstraction at all

| Location | What | Class |
| --- | --- | --- |
| `src/run.ts:28-29` | `import { NorthstarEngine, buildObservation, summariseState } from '@rigorrun/northstar'` | `compiler-logic` |
| `src/run.ts:137` | `NorthstarEngine.fromScenario(testCase.seed.scenarioId, …)` — the environment is chosen by `import`, not by id | `compiler-logic` |
| `src/run.ts:218` | `buildObservation(engine, …)` | `derived-projection` |
| `src/demo.ts:10` | `import { EXAMPLE_REFUND_TRACE } from '@rigorrun/northstar'` | `fixture` |
| `src/demo.ts:33-58` | Hardcoded ids `wfc_refund_v1`, `bm_refund_v1` and refund display names | `incidental-name` |

**Verdict:** the direct import becomes an `EnvironmentRegistry` lookup. The
runner keeps its structure — reset → seed → execute → observe → verify → score
is already right.

## 5. `packages/agents` — domain-bound demo agents

| Location | What | Class |
| --- | --- | --- |
| `src/types.ts:9` | `import type { ToolResult } from '@rigorrun/northstar'` — the agent boundary type is defined by a domain package | `compiler-logic` |
| `src/types.ts:47` | `limitFromBrief()` regex reads `above $N` out of the policy brief | `agent-logic` |
| `src/types.ts:54` | `strictAmount()` — money-specific parsing in a generic helper | `agent-logic` |
| `src/tools.ts:12-…` | `NORTHSTAR_TOOL_SCHEMAS` — 12 refund tools by name | `fixture` |
| `src/demoRobust.ts:16` | imports `Note`, `Order`, `Refund`, `Ticket` from northstar | `agent-logic` |
| `src/demoRobust.ts:30-200` | Calls `getCustomer`, `getOrder`, `listTickets`, `createRefund`, `addAuditNote` by name | `agent-logic` |
| `src/demoWeak.ts:*` | Same, with four deliberate flaws | `agent-logic` |
| `src/http.ts` | Clean. No domain knowledge. | keep |

**Verdict:** both demo agents are rewritten as policy-driven generic agents that
read `allowedTools`, action parameter schemas and the public structured policy.
`http.ts` and `providers/**` are untouched.

## 6. `packages/core` — mostly clean

| Location | What | Class |
| --- | --- | --- |
| `src/contract.ts:82` | `environment: z.string().default('northstar')` | `incidental-name` |
| `src/benchmark.ts:72` | Same default | `incidental-name` |
| `src/contract.ts:26,44,114` / `src/assertion.ts:48,66` | Doc-comment examples using refunds and tickets | `incidental-name` |
| `src/redaction.ts:10` / `src/hash.ts:9` / `src/selector.ts:106` | The words "customer" and "order" in prose | `incidental-name` |

**Verdict:** core is structurally fine. It gains the canonical trace, the rule
lifecycle, typed provenance, `verificationSource` and `failureSeverity`. The
`'northstar'` defaults are removed — an environment id must be explicit.

## 7. `packages/verifier` — clean, but fails open

No domain logic. Every hit is a doc-comment example
(`src/path.ts:6-10`, `src/path.ts:155`, `src/evaluate.ts:28`).

Two real defects, both found by design review rather than by grep:

- `resolvePath` returns not-found for an unknown path and the assertion simply
  does not match. With hand-written paths that is a caught typo; with
  machine-generated paths it is **systematic silent-pass**. Needs compile-time
  validation against a published projection key schema.
- Results are boolean. A mutated case where a rule's antecedent no longer
  resolves is neither pass nor fail; it is **inapplicable**. Needs a tri-state.

**Verdict:** `path.ts` is kept as-is. `evaluate.ts` / `verify.ts` gain the
tri-state and path validation.

## 8. `packages/report` — presentation-level coupling

| Location | What | Class |
| --- | --- | --- |
| `src/render.ts:52` | Footer names Northstar, customers, orders, refunds | `incidental-name` |
| `src/render.ts:282-284` | `if (type === 'refund.created')` — a special-cased event formatter | `compiler-logic` |
| `src/sanitize.ts:15-22` | `RECORD_ID` / `MONEY` masking regexes — generic patterns, refund-flavoured comments | keep |
| `src/sanitize.ts:38,40,73` | Comments about customer data | `incidental-name` |

**Verdict:** the one `if (type === 'refund.created')` branch is replaced by
schema-driven event formatting. Everything else is copy.

## 9. `packages/scoring`, `packages/providers` — zero hits

Clean. Scoring gains `failureSeverity` rollups; providers are untouched.

## 10. `packages/cli`

`src/commands.ts:425-431`, `src/help.ts:54,66`, `src/record.ts:108` are demo
copy naming the refund example. `incidental-name` — updated when the CLI grows
`inspect-environment`, `privacy`, `quality`, `mutate` and `proof`.

---

## Summary

| Package     | Verdict                                                          |
| ----------- | ---------------------------------------------------------------- |
| `compiler`  | **rewrite** `compile.ts`; extend `templates.ts` 6 → 10           |
| `generator` | **rewrite** all three of `generate.ts`, `policy.ts`, `expected.ts` |
| `northstar` | `observe.ts` **deleted**; the rest becomes an environment adapter |
| `runner`    | registry lookup replaces the direct import; structure kept       |
| `agents`    | **rewrite** both demo agents; `http.ts` kept                      |
| `core`      | extended, not rewritten                                          |
| `verifier`  | tri-state + path validation; `path.ts` untouched                 |
| `report`    | one `if` removed; copy updated                                   |
| `scoring`   | extended with severity rollups                                   |
| `providers` | untouched                                                        |

Three live defects were found while auditing and are fixed on the way through:

1. `observe.ts:117` — substring id matching (`REF-1` matches `REF-10`).
2. `expected.ts:59` — two distinct policies collapsed into one predicate.
3. `verifier` — unknown paths fail open, which is safe for hand-written
   assertions and unsafe for generated ones.
