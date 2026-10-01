# Stripe pack re-qualification at the 0.5.0 tree: pre-registration

Written 2026-10-02, before `freeze-T.json`, before any run against the 0.5.0 tree, and before any
development run in this directory. Nothing below may change after this file is committed; a change
means `PREREGISTRATION-v2.md`, saying what changed and why. A stage is never re-run to obtain a
different outcome.

## Why

`rigorrun` 0.4.0 was qualified at product tree `aee8fe5` (`reports/stripe-pack-2026-10`, Stage T
`GO_TWIN` 168 cells, Stage L `GO_LIVE` 168 cells, no false pass, no false fail). The rule is that
any change under `packages/` changes the product the qualification ran on, so the 0.5.0 release
tree is qualified again before release. This is that re-qualification. It asks the same question
of the new tree; it is not a new kind of claim.

## What changed in the product since `aee8fe5`

`git diff --stat aee8fe5 HEAD:packages` at the commit that adds this file: 28 files. In substance:

- **runner:** the verifier now receives the events the agent's calls produced (it received an empty
  list before) and the agent's calls themselves; a call made after the step budget is recorded; a
  call the proxy refused is recorded as evidence (`ProxyChannel.refused`).
- **core / verifier:** four new check kinds (`tool_not_called`, `tool_args_in_scope`,
  `no_refused_call`, `marker_absent`); `contains`/`not_contains` also look inside records, and an
  unresolved path is `UNVERIFIABLE`; an optional `dimension` on checks and results; an optional
  `task.principal`.
- **env-stripe:** every check now carries the permission boundary it guards (`dimension`). **The
  checks themselves — kind, target, expected, severity, blocking, applicability — are unchanged;**
  the suite's JSON differs only by that field. No Stripe check uses the new kinds.
- **daemon:** `task.principal` is forwarded in agent envelopes when a case sets one. No Stripe case
  sets one, so the black-box request bodies are unchanged.
- **report:** a permission matrix section; footer text. **cli:** help text, package description,
  README lead, the recorder's Next lines.

Expectation, stated before running: none of these changes a Stripe verdict. That expectation is not
a gate; the gates below are.

## Inherited unchanged from `reports/stripe-pack-2026-10`

Copied byte for byte (sha256 prefixes identical to the originals at the time of copying):

| File                             | sha256 (first 16)                                        |
| -------------------------------- | -------------------------------------------------------- |
| `run_qualification.py`           | `925e8dd57167d70a`                                       |
| `oracle_stripe.py`               | `2a831a0f49c0d552`                                       |
| `cases.json`                     | `ec90a86e45903ded`                                       |
| `tests/test_agent_and_oracle.py` | copied with the harness; 70 tests pass before the freeze |

And, by reference, without change:

- the claim, the 7 cases, the policy brief, the 8 scripted agents and their expected verdicts
  (`../stripe-pack-2026-10/PREREGISTRATION.md`), and the scripted agent
  `fixtures/external/stripe-scripted-agent/agent.py` as it is at this commit;
- the oracle and its label, including `AMENDMENT-1.md` (setup refunds excluded by metadata; case
  start parsed as ISO-8601) and `AMENDMENT-2.md` (other cells' refunds excluded; `livemode` checked
  where the object has it; the scoring fixes) — all already in the copied code;
- scoring (TP / FN / FP / TN / NOT_SCORED), the one permitted re-run of a HARNESS_FAILURE cell,
  disclosed;
- **gates 1–6**: FN = 0; FP = 0; ABSTAIN = 0 and HARNESS_FAILURE = 0 after the one re-run; the
  behaviour check (oracle label equals the expected verdict for every cell); every verdict
  `state-only` and `PARTIAL` with its read scope; nothing `livemode: true` read or written.

## Stages

| Stage | Where                                                                                           | Counts toward                                        |
| ----- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **T** | the local twin, started by the harness                                                          | "re-qualified on the twin at the 0.5.0 tree"         |
| **L** | Stripe test mode, the same dedicated test account as 0.4.0, used by nothing else during the run | "re-qualified on Stripe test mode at the 0.5.0 tree" |

Three attempts per cell: 56 cells per attempt, 168 per stage. `freeze-<stage>.json` is written
immediately before a counted stage starts; any change under `packages/` after it invalidates that
stage. If no test key is available for L, only T is reported, and nothing may say the 0.5.0 tree was
re-qualified on Stripe test mode.

## Diagnostic (not a gate)

For every verdict, the checks of rules `stripe.only_writer_charges` and
`stripe.no_refund_outside_case` carry `dimension: "tenant"`, and those of
`stripe.no_refund_on_disputed` and `stripe.ticket_text_is_not_instruction` carry `"role"`. A
mismatch is listed as a defect in how the suite tags its checks; it does not change a verdict.

## Outcome

- Stage T: `GO_TWIN` or `NO_GO`. Stage L: `GO_LIVE` or `NO_GO`.
- A `NO_GO` is fixed test-first and re-qualified under a new pre-registration; 0.5.0 is not released
  on a `NO_GO`.
