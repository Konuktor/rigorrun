# Local MVP runbook

This is a local development checkpoint for the general-agent MVP, checked on
2026-10-09 against base `e10ce750a6d14f89363226bc5fd5445f98b66f91` plus the
Task 6 QA files. It is not a published release or an integrated Core/UI acceptance
record. The Helpdesk and Stripe paths below use bundled suites and local twins.
Changes under `packages/`, including this regression test, change the tree to which
the historical qualification applies; those reports do not qualify this new build.

## Install and choose the local interface

From the repository root, use Node 22 and pnpm 11.7.0:

```sh
pnpm install --frozen-lockfile
pnpm start
```

`pnpm start` builds the app and starts the local daemon with the paired Projects
interface. Open the pairing URL printed in the terminal. Projects and CLI commands
use a local store; use an explicit `--home` for disposable CLI projects. Stop the
daemon with Ctrl+C.

```sh
pnpm dev
```

`pnpm dev` starts the browser demonstration and the synthetic CRM/operations apps.
It does not start the Projects daemon. Browser examples illustrate architecture;
they are not customer integrations or release qualification. The invoice example
misses some defect controls and the access example has a dead rule in the design
audit. Keep those quality limitations visible when showing them.

Use one writer/operator per project. Checkpoints are not transactions or
cross-process locks. Do not edit, regenerate, reconfigure or run the same project
concurrently from another CLI or browser.

## Repeatable model-free black-box demo

```sh
RIGORRUN_HELPDESK_E2E_KEEP=1 pnpm exec vitest run packages/cli/test/helpdesk.e2e.test.ts
```

This command needs no model provider or private key. It starts the public
`helpdesk twin --port 0` command in a subprocess, allocates a fresh temporary store,
runs `helpdesk init --yes --twin <printed MCP URL> --json`, adds two agents with
`agent add --black-box <HTTP URL> --claim-path message`, and gates each with
`gate --project <id> --agent <name> --report <path> --json`. All project commands
receive `--home <fresh temporary store>`. No threshold overrides are passed.

The controls are explicitly scripted qualification controls, not general-purpose
LLM agents. They use the same task-driven logic over HTTP and MCP. The scoped
control uses the twin's synthetic `tok_alder_support`; the defective control uses
the synthetic `tok_service`. They receive tasks and policy context, but no private
assertions, expected verdict or reference plan. The fixture deliberately returns
an inaccurate "no records were changed" claim to show claim-versus-system separation.

Expected results verified at this checkpoint:

| Public command                              | Result                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| Default project gate, scoped control        | Exit 0; permitted refund and customer email persisted                          |
| Default project gate, service-token control | Exit 1; another organisation's order refunded, customer notes read and emailed |
| Gate naming a missing agent                 | Exit 2; neither candidate contacted                                            |

The test prints a fresh `/tmp/rigorrun-helpdesk-e2e-...` artifact directory.
Open `service.html` there: it contains the twin's access log evidence, refund and
outbox lines, another organisation's marker, permission matrix and the separate
agent claim. `scoped.html` contains the PASS summary and matrix. Current HTML only
renders detailed evidence cards for failures; inspect
`store/projects/<id>/runs/*.json` for the passing case's refund/outbox records and
claim. The twin is simulated, verification is `AUTHORITATIVE` within that twin,
isolation is `DECLARED`, and agent tool calls were not observed by RigorRun.

Without `RIGORRUN_HELPDESK_E2E_KEEP=1`, the test cleans up its temporary directory.
With it, the fake-data artifacts remain for inspection; subprocesses and servers
still stop. Each subsequent run creates another fresh directory.

An inspected repeat at this checkpoint retained its evidence at
`/tmp/rigorrun-helpdesk-e2e-4RQr12`; this machine-local path is an example, not a
portable fixture. Run the command again to get your own fresh output path.

For a quick paired demonstration, also use a fresh report path:

```sh
rr_demo_dir=$(mktemp -d /tmp/rigorrun-helpdesk-demo-XXXXXX)
pnpm cli helpdesk try --report "$rr_demo_dir/pair.html"
```

`helpdesk try` intentionally exits 0 when its built-in pair demonstration completes,
even when the service-token control fails cases. Its process exit is not a passing
candidate release gate. Use the project gate above for the candidate result.

## Connect an existing candidate

Start `pnpm cli helpdesk twin --port 0` in a separate terminal. Configure the
candidate's own MCP connection with the URL printed there and the synthetic scoped
token. It must answer the public `rigorrun/task/1` HTTP protocol; a probe returns
`{"ok":true}`, and a task response exposes the claim at `message`.

```sh
rr_project_dir=$(mktemp -d /tmp/rigorrun-helpdesk-project-XXXXXX)
pnpm cli helpdesk init --twin '<printed MCP URL>' --yes --json --home "$rr_project_dir/store"
# Substitute the projectId printed by init and the candidate's actual HTTP URL.
pnpm cli agent add --project '<projectId>' --name my-agent --black-box '<candidate HTTP URL>' --claim-path message --home "$rr_project_dir/store"
pnpm cli gate --project '<projectId>' --agent my-agent --report "$rr_project_dir/candidate.html" --home "$rr_project_dir/store"
```

`--yes` intentionally confirms all bundled Helpdesk rules. Read them before using
that flag; interactive initialization lets you decide individually. A pass applies
to this suite and observed twin state, not arbitrary systems or production actions.

## Verification at this QA checkpoint

Runtime observed: Node `v22.22.2`, pnpm `11.7.0`, Python `3.14.7`.

```sh
pnpm exec vitest run packages/cli/test/helpdesk.e2e.test.ts packages/cli/test/stripe.e2e.test.ts packages/env-helpdesk/test/cli.test.ts
pnpm exec vitest run packages/cli/test/helpdesk.e2e.test.ts
pnpm test
pnpm lint
pnpm typecheck
pnpm claims
```

The targeted three-file run passed all 10 tests without skips; the Helpdesk repeat
checks fresh state again. The full baseline-plus-QA run passed 162 files, 1869 tests,
with one skipped alternate Stripe golden-file diagnostic (the golden comparison
itself runs). Python-backed Stripe and daemon tests ran, with no Python skips.
Lint, typecheck and claims passed after adding the final scoped test and runbook.
The full run preceded the final extra persisted-record assertions; those assertions
passed in the Helpdesk repeat and final targeted run. Integrated acceptance remains
the coordinator's next check.

Initial test development exposed fixture parsing and a mistaken expectation of
PASS evidence cards, both corrected. The new path is a regression proof of existing
bundled functionality, not a manufactured RED/GREEN engine fix.

## Safety and unfinished work

Quality assessment is an explicit operation that executes repeated writes against
the configured environment. Use a disposable test/staging environment with reset
and readback; do not run it on production. Gate must not silently invoke assessment.
Generated-suite review, freshness checkpoints and strict quality refusals are
upcoming Core safeguards at this QA checkpoint; their integrated verification is
pending. Missing/stale/inadequate evidence is intended to exit 3 before candidate
contact and is covered by the Core task's acceptance, not this bundled-path test.
Treat generic project and raw-file runs as diagnostics until that acceptance passes.

This QA checkpoint did not run the integrated UI/browser acceptance, app/site builds,
`pnpm verify`, package-install/release qualification or deployment. Runtime blocking,
hosted organisations, shared team histories, approvals and subscription billing are
not built in this slice. Custom workflows need an adapter with observable state,
safe reset and agreed rules; the synthetic examples do not establish that coverage.

For a three-minute demo: run the model-free test, show the scoped exit 0 and its
saved permitted records, then open `service.html` to compare the identical control's
claim with the other-organisation read/refund/email and exit 1. End with the twin and
HTML limitations above, then ask for one real workflow and observable test system.
