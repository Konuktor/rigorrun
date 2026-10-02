# Larch Helpdesk pack re-qualification at the 0.6.0 tree: pre-registration

Written 2026-10-02, before `freeze-T.json` in this directory and before any run here. Nothing below
may change after this file is committed; a change means `PREREGISTRATION-v2.md`, saying what changed
and why. A stage is never re-run to obtain a different outcome.

## Why

The pack was qualified at product tree `f6ed4d3` (`../helpdesk-pack-2026-10`, Stage T `GO_TWIN`,
144 cells, TP 42 / TN 102, no false pass, no false fail). The product changed under `packages/`
after that freeze, so the 0.6.0 release tree — version strings already 0.6.0 — is qualified again
before the pack is released.

## What changed in the product since `f6ed4d3`

`git diff --stat f6ed4d3 HEAD -- packages` (as trees) at the commit that adds this file. In
substance:

- **env-helpdesk:** `rigorrun helpdesk try --agent` uses a twin already running on its port instead
  of failing to bind it; its usage text. `try` is not on the qualified path (the harness runs
  `helpdesk twin`, `helpdesk init` and `rigorrun run`), and the pack, suite, checks, twin, session
  and reads are unchanged.
- **cli:** help text, npm README and description, `bin` path, the permissions-demo recorder script,
  version 0.6.0. **core:** `RIGORRUN_VERSION` 0.6.0.

Expectation, stated before running: no helpdesk verdict changes. Not a gate.

## Inherited unchanged

Copied byte for byte from `../helpdesk-pack-2026-10`:

| File                   | sha256 (first 16)                                       |
| ---------------------- | ------------------------------------------------------- |
| `run_qualification.py` | `a768c9e2cfba7e3f`                                      |
| `oracle_helpdesk.py`   | `8070bc816e8ff564`                                      |
| `cases.json`           | `d9c8784f14786f4b`                                      |
| `tests/`               | copied with the harness; 8 tests pass before the freeze |

And, by reference, without change: the claim, the world, the 6 cases, the policy brief, the oracle
label, the 8 scripted agents (`fixtures/external/helpdesk-scripted-agent/agent.mjs` as it is at the
frozen commit) and their expected verdicts (48 cells per attempt, 14 expected FAIL), scoring, the
one permitted re-run of a HARNESS_FAILURE cell (disclosed), and **gates 1–6** — exactly as in
`../helpdesk-pack-2026-10/PREREGISTRATION.md`.

## Stage

| Stage | Where                                                                      | Counts toward                                               |
| ----- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **T** | the Larch Helpdesk twin, started by the harness (`rigorrun helpdesk twin`) | "re-qualified on the Larch Helpdesk twin at the 0.6.0 tree" |

Three attempts: 144 cells. `freeze-T.json` is written immediately before the stage; any change under
`packages/` after it invalidates the stage.

## Outcome

`release-gate.json` with `GO_TWIN` or `NO_GO`. A `NO_GO` is fixed test-first and re-qualified under
a new pre-registration; the pack is not released on a `NO_GO`.
