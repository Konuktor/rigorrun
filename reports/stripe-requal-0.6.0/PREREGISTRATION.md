# Stripe pack re-qualification at the 0.6.0 tree: pre-registration

Written 2026-10-02, before `freeze-T.json`, before any run against the 0.6.0 tree, and before any
development run in this directory. Nothing below may change after this file is committed; a change
means `PREREGISTRATION-v2.md`, saying what changed and why. A stage is never re-run to obtain a
different outcome.

## Why

`rigorrun` 0.5.0 was re-qualified at product tree `27d40a8` (`../stripe-requal-0.5.0`, Stage T
`GO_TWIN` and Stage L `GO_LIVE`, 168 cells each, no false pass, no false fail). Any change under
`packages/` changes the product the qualification ran on, so the 0.6.0 release tree is qualified
again before release. **The version strings were changed to 0.6.0 before this file was written**,
so the tree frozen here is the tree released (lesson of `../stripe-requal-0.5.0/RELEASE-TREE.md`).

## What changed in the product since the 0.5.0 release

`git diff --stat v0.5.0 HEAD -- packages` at the commit that adds this file: 48 files, most of them
the new `packages/env-helpdesk` pack. Outside it:

- **environment / daemon:** a pack session may declare that it replaces the whole world before each
  case (`isolation: 'replaced-world'`) and that its read is complete (`completeRead`); the daemon
  forwards both. Both are optional; a session that declares neither — the Stripe pack's — gets
  exactly the capabilities it got before.
- **cli:** the helpdesk pack registered beside Stripe; help text, npm README and description;
  `bin` path normalised; the permissions-demo recorder script; version 0.6.0. **core:**
  `RIGORRUN_VERSION` 0.6.0.
- **env-stripe:** no change.

Expectation, stated before running: none of these changes a Stripe verdict. That expectation is not
a gate; the gates below are.

## Inherited unchanged

Copied byte for byte from `../stripe-requal-0.5.0` (themselves copies of `../stripe-pack-2026-10`):

| File                             | sha256 (first 16)                                        |
| -------------------------------- | -------------------------------------------------------- |
| `run_qualification.py`           | `925e8dd57167d70a`                                       |
| `oracle_stripe.py`               | `2a831a0f49c0d552`                                       |
| `cases.json`                     | `ec90a86e45903ded`                                       |
| `tests/test_agent_and_oracle.py` | copied with the harness; 70 tests pass before the freeze |

And, by reference, without change: the claim, the 7 cases, the policy brief, the 8 scripted agents
and their expected verdicts, the oracle and its label with both amendments, scoring, the one
permitted re-run of a HARNESS_FAILURE cell (disclosed), and **gates 1–6** — exactly as in
`../stripe-requal-0.5.0/PREREGISTRATION.md`.

## Stages

| Stage | Where                                                                                       | Counts toward                                        |
| ----- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **T** | the local twin, started by the harness                                                      | "re-qualified on the twin at the 0.6.0 tree"         |
| **L** | Stripe test mode, the same dedicated test account as before, used by nothing else meanwhile | "re-qualified on Stripe test mode at the 0.6.0 tree" |

Three attempts per cell: 56 cells per attempt, 168 per stage. `freeze-<stage>.json` is written
immediately before a counted stage starts; any change under `packages/` after it invalidates that
stage. If no test key is available for L, only T is reported.

## Diagnostic (not a gate)

The boundary-tag diagnostic of `../stripe-requal-0.5.0`, unchanged.

## Outcome

- Stage T: `GO_TWIN` or `NO_GO`. Stage L: `GO_LIVE` or `NO_GO`.
- A `NO_GO` is fixed test-first and re-qualified under a new pre-registration; 0.6.0 is not released
  on a `NO_GO`.
