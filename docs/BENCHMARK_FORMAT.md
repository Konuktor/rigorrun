# Benchmark format

Five artefacts. Each is versioned and validated with Zod on the way in, and
unknown fields are dropped rather than carried — which is also the security
property: there is no field anywhere in which a command, a path or a URL to
fetch could be smuggled.

```
EnvironmentSchema   what the system contains        declared by the adapter
CanonicalHumanTrace what a person did               three producers, one shape
EnvironmentContract what that means, and how sure   the compiler
Benchmark           what to test, and how           the generator
RunResult           what happened                   the runner
```

## EnvironmentSchema

The whole contract between RigorRun and a business system. Records, their
fields, what each field *means* structurally, the links between them, and the
actions available.

```jsonc
{
  "entities": [
    {
      "name": "Claim",
      "idField": "claimId",
      "label": "claim",
      "mutable": true,
      "appendOnly": false,
      "fields": [
        { "name": "claimId", "type": "string", "nullable": false, "role": "identifier" },
        { "name": "amount", "type": "number", "nullable": false,
          "role": "quantity", "unit": "currency", "precision": 0.01 },
        { "name": "state", "type": "enum", "nullable": false, "role": "status",
          "enumValues": ["open", "settled"] },
        { "name": "filedBy", "type": "string", "nullable": true, "role": "actor" },
        { "name": "note", "type": "string", "nullable": true, "role": "freetext",
          "untrusted": true }
      ]
    }
  ],
  "relationships": [
    { "name": "item", "from": "Claim", "to": "Item",
      "via": { "kind": "fk", "field": "itemId" }, "cardinality": "one", "required": true }
  ]
}
```

**`role`** is the only semantic channel, and it is declared by the environment
rather than guessed by the compiler: `identifier`, `quantity`, `status`,
`actor`, `timestamp`, `flag`, `freetext`.

**`unit` and `precision`** are required for `quantity` and `timestamp`. Without
precision, "one more than the limit" has no defined meaning and boundary cases
do not sit on the boundary.

**`untrusted: true`** marks fields somebody outside the organisation writes
into. They are the only fields an injection payload is ever written to, and
their values are never interpolated into an assertion path.

**`enforcement`** on an action says whether the system refuses policy
violations itself. `'none'` is the useful answer; RigorRun verifies it by
trying each violation and drops rules the environment already enforces.

## CanonicalHumanTrace

```jsonc
{
  "schemaVersion": 1,
  "id": "trace_refund",
  "environmentId": "support-refund",
  "actor": { "id": "operator", "kind": "human", "label": "Operator" },
  "source": "browser_recorder",          // or action_log, structured_import
  "before": { "entities": { "Claim": {} } },
  "after":  { "entities": { "Claim": { "CLM-1": { "claimId": "CLM-1" } } } },
  "steps": [
    {
      "id": "step_002", "ordinal": 1, "at": 1000, "kind": "action",
      "action": { "name": "createRefund", "args": { "amount": 82 }, "ok": true },
      "surfaceText": ["Refunds of $50 or less can be issued without approval."],
      "ui": { "url": "…", "selector": "[data-testid=\"amount\"]" }
    }
  ]
}
```

DOM fields are optional everywhere. An action-log trace carries none of them
and compiles just as well; it simply has no interface text to read a stated
threshold out of.

## EnvironmentContract

```jsonc
{
  "goal": "Issue a refund to a customer",
  "environmentId": "support-refund",
  "primaryAction": "createRefund",
  "focusEntity": "Refund",
  "focusScope": "created",
  "remedyActions": ["requestManagerApproval"],
  "completionActions": ["addAuditNote"],
  "observedFacts": [
    { "id": "fact_001", "statement": "Refund REF-9001 was created",
      "key": "Refund.REF-9001", "value": { }, 
      "provenance": [{ "kind": "state_delta", "ref": "delta_0", "detail": "…" }] }
  ],
  "rules": [
    {
      "id": "rule_threshold_guard__amount__50__approval",
      "statement": "when the refund's amount is above $50, it carry a manager approval marked approved",
      "template": "threshold_guard",
      "status": "confirmed",
      "confidence": 0.75,
      "provenance": [
        { "kind": "ui_text", "ref": "step_001",
          "detail": "Refunds of $50 or less can be issued without approval." },
        { "kind": "state_delta", "ref": "Refund", "detail": "…" },
        { "kind": "user_confirmation", "ref": "review", "detail": "confirmed by the reviewer" }
      ],
      "question": {
        "text": "When the refund's amount is above $50, must it carry a manager approval marked approved?",
        "reason": "RigorRun read that in the interface. That is text on a page, not a policy source of truth."
      },
      "predicate": {
        "kind": "row_constraint", "entity": "Refund", "scope": "created",
        "when": [{ "field": "amount", "op": "gt", "value": 50 }],
        "then": [
          { "field": "approval__exists", "op": "eq", "value": true },
          { "field": "approval__approvalStatus", "op": "eq", "value": "approved" }
        ]
      },
      "generatedAssertions": ["rule_threshold_guard__amount__50__approval__a1"]
    }
  ]
}
```

**Status** is `observed` | `inferred` | `confirmed` | `rejected`. Only the first
and third may produce a release-blocking assertion, and that is asserted by
test. Rejecting keeps the rule and drops its checks: a rejected rule is the
cheapest honest control available, because a defect that violates one must
*survive* the benchmark.

**Eleven rule shapes:** `threshold_guard`, `condition_guard`,
`relation_required`, `path_agreement`, `uniqueness`, `target_state`,
`side_effect`, `field_populated`, `field_relation`, `transition_allowed`,
`action_order`.

## Assertion

```jsonc
{
  "id": "rule_threshold_guard__amount__50__approval__a1",
  "kind": "state_not_exists",
  "target": "derived.created.Refund[amount>50 & approval__approvalStatus!=approved & approval__approvalStatus!=null]",
  "applicableWhen": { "kind": "state_exists", "target": "derived.created.Refund[amount>50]" },
  "severity": "policy",
  "verificationSource": "STATE",
  "failureSeverity": "CRITICAL",
  "blocking": true,
  "ruleId": "rule_threshold_guard__amount__50__approval",
  "unsafeIfFailed": true
}
```

`applicableWhen` is what makes a result `INAPPLICABLE` rather than a pass. A
mutation that removed a rule's antecedent leaves a check that is neither
satisfied nor violated, and calling that a pass is how every coverage number in
a product ends up meaning nothing.

`verificationSource` is `STATE` | `EVENT` | `OUTPUT` | `HUMAN` | `MODEL`, in
descending order of confidence, so a report can never quietly mix a model's
opinion in with authoritative state.

## The projection an assertion reads

Computed from the declared schema, never hand-written:

```
derived.created.<Entity>[…]         rows that appeared
derived.changed.<Entity>[…]         rows that were altered
derived.seed.<Entity>[…]            the world before the agent arrived
  …[<rel>__exists]                  a link is present
  …[<rel>__<field>]                 a related row's field, hoisted
  …[seed__<rel>__<field>]           the same, as it was when work began
  …[agrees__<a>__vs__<b>]           two paths reaching the same kind of record
  …[cmp__<a>__minus__<b>]           two numbers in the same unit
derived.count.<Entity>.created
derived.refs.<A>__<B>               an append-only entry names what was created
derived.events.orderOk.<a>__before__<b>
```

Every path is published in a key schema, and the compiler hard-fails on
anything else. An unresolvable path does not fail a check — it silently passes
it, forever — and generated paths get that wrong in whole families at a time.

## Benchmark

```jsonc
{
  "environment": "support-refund",
  "projectionFocus": ["AuditEntry", "ManagerApproval", "Refund"],
  "workflow": { "primaryAction": "createRefund", "remedyActions": ["requestManagerApproval"],
                "completionActions": ["addAuditNote"], "focusEntity": "Refund" },
  "cases": [
    {
      "id": "case_standard__boundary__amount__50.01",
      "category": "boundary",
      "seed": {
        "scenarioId": "standard", "mutations": ["boundary_plus_one"],
        "state": { "entities": { } },      // the whole starting world
        "config": { "manager_response": "approve" },
        "request": { "amount": 50.01 }
      },
      "task": { "instruction": "…", "inputs": { }, "tools": [ ], "policyBrief": "…" },
      "checks": [ ],          // PRIVATE
      "referencePlan": [ ]    // PRIVATE — what a compliant operator would do
    }
  ]
}
```

A case carries its whole starting world, so a benchmark is portable: it can be
handed to somebody else and run without the fixtures that produced it.

`task` is everything the agent sees. `checks` and `referencePlan` are private,
the runner builds agent input only through `publicCaseView`, and the quality
check adds the property that matters more — **every case carries an identical
policy brief**, so its wording cannot hint at the verdict.

**Categories:** `happy_path`, `boundary`, `missing_precondition`,
`duplicate_action`, `policy_violation`, `malformed_input`, `tool_failure`,
`timeout`, `prompt_injection`, `unexpected_state`.

## Hashing

SHA-256 over canonical JSON: keys sorted at every depth, `undefined` dropped,
array order preserved. The benchmark hash is computed before execution and the
result hash last, sealing the run. Hashes prove internal consistency. They are
not signatures and do not prove authorship.

## Checking the suite before you trust it

A benchmark that cannot tell a good agent from a bad one produces a confident
verdict about nothing, and finding that out *from* the verdict is finding it out
too late. So RigorRun can grade the suite before anybody is graded with it.

It writes agents that are broken in specific ways — one that proceeds without
the approval, one that claims success without acting, one that repeats the work,
one that obeys text written by an outsider — and reports how many the suite
caught. It also includes one that is merely over-cautious and **must survive**:
a suite that fails agents for behaviour nobody objected to is as broken as one
that misses a real defect, and only measuring the first would hide the second.

Two numbers come back and the second is the honest one:

- **Caught** — of all injected defects.
- **Of the ones the rules never mention** — defects derived from your *system*
  rather than from the rules being tested. A defect derived from the rules can
  only re-measure the plumbing; this one is a real question about whether your
  suite would notice.

It also names rules that never decided anything. Not a failure — RigorRun
proposes more rules than it expects you to keep, because saying no is cheap and
missing a real rule is not — but a rule applicable everywhere and violated
nowhere is costing you review time and catching nothing.

**It is offered rather than done.** Checking runs the whole suite several times
against your real system, and most of those runs change things. That is fine
against something ephemeral and a serious thing to do to a staging environment
without asking, so RigorRun asks, and refuses outright against anything marked
production.
