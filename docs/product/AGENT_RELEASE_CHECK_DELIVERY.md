# Agent Release Check — local MVP delivery

Delivered on 2026-10-10 (Asia/Bishkek). The scoped local Helpdesk workflow is
implemented and freshly verified: explicit rule review → your HTTP endpoint →
suite readiness → observed task/policy evidence → report/history → release gate.
All eleven requested acceptance items below pass within their stated scope.
Scripted controls are model-free test equipment, not live LLM validation.

## Exact checkout and artifact

- Checkout: `/home/erbol/.codex/worktrees/104e/RigorRun`.
- Branch: `feat/agent-release-check-5h`.
- Source base: `d307735004e47aa1064779b6b8c2c262071025ab`.
- Tested implementation SHA: `b5acacb435eb5f4c8a63f9a2b5b2cb2ff0b20e03`.
  The subsequent delivery/plan commit changes documentation only; use
  `git rev-parse HEAD` for the checkout's final documentation commit.
- Local tarball: `dist/rigorrun-0.6.0.tgz`, 649 kB packed.
- Tarball SHA256:
  `9a7a9bc7986188c49dd6b647b0204ea496700bfb31b8673fc0cfc271e7ace541`.
- Tested installed executable:
  `/tmp/rigorrun-local-install-MXg8KF/node_modules/.bin/rigorrun`.
- Fresh reserved example home: `/tmp/rigorrun-release-home-DBsaCM`.
- [Quickstart](AGENT_RELEASE_CHECK_QUICKSTART.md) contains the complete build,
  install, twin, own endpoint, browser/CLI review, gate, report and repeat commands.

The version still prints `0.6.0`; this artifact is not the historical npm release.
Nothing was published, deployed, pushed, tagged or remotely merged. No production
system was contacted for candidate actions. Existing qualification does not
qualify this changed build.

## Fresh verification

All commands ran in the checkout above. Logs are retained under
`/tmp/rigorrun-final-validation-17stmA`.

| Command                                                                                                                                           | Fresh result                                                                                                                                      | Log/artifact                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                  | Exit 0                                                                                                                                            | `install.log`                                                                    |
| `pnpm verify`                                                                                                                                     | Exit 0: lint, typecheck, domain, claims, 167 test files, 1980 tests passed, 13 example tests, all local builds                                    | `verify.log`                                                                     |
| `pnpm verify:package`                                                                                                                             | Exit 0: clean install/runtime, package bounds, credential/build-path scan, SBOM, dependency checks and existing installed generic browser journey | `verify-package.log`                                                             |
| `pnpm build:app` / `pnpm build:cli`                                                                                                               | Both exit 0, repeated explicitly for quickstart                                                                                                   | `build-app.log`, `build-cli.log`                                                 |
| `npm pack ./packages/cli/package --pack-destination ./dist`                                                                                       | Exit 0                                                                                                                                            | `pack.log`                                                                       |
| `npm install --prefix /tmp/rigorrun-local-install-MXg8KF --no-audit --no-fund /home/erbol/.codex/worktrees/104e/RigorRun/dist/rigorrun-0.6.0.tgz` | Exit 0; installed `--version` returns `0.6.0`                                                                                                     | `install-artifact.log`                                                           |
| Targeted command below                                                                                                                            | Exit 0: 9 files / 159 tests on the final implementation                                                                                           | `targeted-final.log`                                                             |
| Source Helpdesk/Stripe command below                                                                                                              | Exit 0: 2 files / 6 tests; source regression, not installed acceptance                                                                            | `helpdesk-stripe.log`; `/tmp/rigorrun-helpdesk-e2e-9l4foe`                       |
| Installed native acceptance command below                                                                                                         | Exit 0: all 16 checks                                                                                                                             | `installed-acceptance.log`; `/tmp/rigorrun-release-check-CbaNgw/acceptance.json` |
| Installed Helpdesk browser command below                                                                                                          | Exit 0: all 12 tests, no retries                                                                                                                  | `installed-browser.log`; happy path `/tmp/rigorrun-helpdesk-browser-d8RZum`      |
| Installed `report` command below                                                                                                                  | Exit 0; same UI run's JSON/HTML PASS and expandable evidence agree                                                                                | `same-run-report.log`; `/tmp/rigorrun-helpdesk-browser-d8RZum/browser-run.html`  |

The single unit skip is the unchanged conditional alternate golden-file test in
`packages/env-stripe/test/twin.conformance.test.ts`. No tests were newly skipped
or thresholds weakened. The package verifier's printed “READY TO PUBLISH” is
only a local check result; its suggested publication command was not executed.
Its dependency check reported zero critical/high/moderate advisories at test time.

```sh
pnpm exec vitest run packages/cli/test/setup.test.ts packages/cli/test/generateReview.test.ts packages/cli/test/gateQuality.test.ts packages/daemon/test/packSuiteRoutes.test.ts packages/daemon/test/suiteIntegrity.test.ts packages/runner/test/outcomes.test.ts packages/report/test/report.test.ts packages/report/test/explain.test.ts packages/report/test/materialized.test.ts --reporter=dot

RIGORRUN_HELPDESK_E2E_KEEP=1 pnpm exec vitest run packages/cli/test/helpdesk.e2e.test.ts packages/cli/test/stripe.e2e.test.ts --reporter=dot

rr_bin=/tmp/rigorrun-local-install-MXg8KF/node_modules/.bin/rigorrun
node scripts/agent-release-check-acceptance.mjs --binary "$rr_bin"
env -u NO_COLOR RIGORRUN_BIN="$rr_bin" pnpm exec playwright test --config e2e/playwright.helpdesk.config.ts --workers=1 --retries=0

"$rr_bin" report /tmp/rigorrun-helpdesk-browser-d8RZum/store/projects/p_c045967dc50a/runs/run_7e14eafaa303.json --out /tmp/rigorrun-helpdesk-browser-d8RZum/browser-run.html
```

The acceptance ledger records exact installed CLI commands, exit codes, run IDs
and candidate-call counts. It includes valid CLI `helpdesk init --yes`, `agent
add`, first/repeat `gate --report --json`, `projects --json` and `compare-runs`.
Daemon writes stop before CLI writes; concurrent test groups use separate fresh
homes/twins. Controls consume public task inputs and live MCP responses, never
hidden assertions, case IDs or expected verdicts. Their inaccurate textual claim
cannot override the observed system state.

## Requested acceptance 1–11

`A` below means `/tmp/rigorrun-release-check-CbaNgw`; `V` means
`/tmp/rigorrun-final-validation-17stmA`. Source tests in this table were freshly
run on the integrated implementation; they are distinguished from packaged E2E.

| #   | Status | What was established / evidence                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | PASS   | Installed scoped control actually refunds the remaining 4500 cents and sends to the requested customer; gate exit 0. `A/scoped.json`, `A/scoped.html`, ledger and stored run.                                                                                                                                                                                                                                                        |
| 2   | PASS   | Overbroad control's observed foreign access/refund/outbox violates policy; gate exit 1. `A/overbroad.json`, `A/overbroad.html`.                                                                                                                                                                                                                                                                                                      |
| 3   | PASS   | Refusal/no-op does not perform the allowed refund; task success fails and gate exits 1. `A/refusal.json`, `A/refusal.html`.                                                                                                                                                                                                                                                                                                          |
| 4   | PASS   | Separate installed reads, writes, leak, wrong-recipient and deletion controls fail on the corresponding access log, foreign state or outbox. `A/reads.*`, `A/writes.*`, `A/leak.*`, `A/wrong-recipient.*`, `A/deletes.*`.                                                                                                                                                                                                            |
| 5   | PASS   | Installed invalid agent/unsuitable synthetic environment exit 2; missing/stale/pending suites exit 3 before candidate tasks. Paired readiness GET is byte-read-only, with no candidate calls or repair. Refused generated quality and absent/stale provenance are additionally verified by real CLI/Runner source regressions (`gateQuality`, `generateReview`, `packSuiteRoutes`); `A/acceptance.json`, `V/targeted-final.log`.     |
| 6   | PASS   | Actual CLI setup retains unmatched inferred rules and stops before generation/assessment/registration; explicit confirm/reject and regex conflicts are covered. Real paired pack-suite HTTP rejects malformed/unknown/duplicate/overlapping decisions; rejected rules remain rejected and diagnostic checks nonblocking. `setup.test.ts`, `packSuiteRoutes.test.ts`, installed browser rejected-rule reload, `V/targeted-final.log`. |
| 7   | PASS   | Missing starting/final/all state readback produces ABSTAIN/unknown, not PASS. Changes to contract/suite/configuration refuse stale completion/provenance; old runs remain historical, not current evidence. Fresh `outcomes`, `suiteIntegrity`, `gateQuality` tests plus installed stale-suite/browser cases. `V/targeted-final.log`, `V/installed-browser.log`.                                                                     |
| 8   | PASS   | Installed browser covers reload/repeat, project/URL switching, delayed readiness/probe/run responses and failed probe without false success or foreign evidence. All 12 tests pass; `V/installed-browser.log`.                                                                                                                                                                                                                       |
| 9   | PASS   | Installed daemon restart restores the reviewed project; reset/repeat creates a fresh run with the same scoped outcome, history/compare works. Held write/run tests prevent a second writer within the same app session, including navigation. `A/repeat.*`, `A/comparison.json`, `V/installed-browser.log`. Cross-client mutex is not claimed.                                                                                       |
| 10  | PASS   | Installed PASS/FAIL HTML retains real assertions/evidence; report tests cover adversarial escaping, published private-evidence removal and opaque credential-key redaction. Stored scores and CLI result agree for all controls; failed assertion IDs appear in HTML. UI YES, JSON PASS and HTML PASS agree for `run_7e14eafaa303`. `V/targeted-final.log`, `V/same-run-report.log`, `A/*.html`.                                     |
| 11  | PASS   | New locally built/packed/installed CLI executes the complete workflow; existing installed generic journey and history/compare pass. Unchanged action's actual bash steps locally map/preserve 0/1/2/3; synthetic exit stub is distinct from real installed gates. `V/verify-package.log`, `V/action.log`, `/tmp/rigorrun-action-selfcheck-gWoUKU`, `A/cli-comparison.json`. No hosted GitHub job was run.                            |

Desktop/mobile first/evidence screenshots from the installed happy path were
opened for visual inspection. The browser asserts meaningful rendering, no error
overlay, no console warnings/errors/page errors, no horizontal overflow and no
unexpected off-origin requests. Other test stores/screenshots are listed in
`V/installed-browser.log`.

## Independent review and integration

Review archive: `.superpowers/sdd/2026-10-10-agent-release-check/` in this checkout.
Root checked complete owner diffs, name-status/stat/check, reports and independent
reviews before cherry-picking. Final whole-branch review is `final-review.md`.
It is Approved with no remaining Critical, Important or Minor findings and
includes inspection of the fresh installed acceptance artifacts.

| Owner    | Accepted source → integration commits                                                           | Review                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Backend  | `f7b9ed6a` → `96dd065a`                                                                         | `task-1-review.md`: Approved                                                                        |
| Evidence | `be9c0119`, `8b0f06db` → `735a0d40`, `13f564f9`                                                 | `task-3-fix-1-review.md`: Approved after opaque-key redaction correction                            |
| UI       | `385335b1`, `b36dfa8d`, `d64d8f30`, `e50d1fe6` → `270cab00`, `9cceeb06`, `0e1d9d76`, `b5acacb4` | `task-2-fix-2-review.md`: Approved after delayed-write/run and first-connect navigation corrections |

The approved plan review is `plan-review.md`. Worker reports preserve genuine
behavioral RED → minimal GREEN evidence; setup/fixture errors are not counted as
behavioral RED. Independent review found and resolved the credential rendering
and UI concurrency defects. TDD, isolated ownership and fresh-verification skills
directly influenced those corrections and the installed-artifact checks.

## Files and preservation

Created: Helpdesk flow and project lock; dedicated onboarding spec/config; daemon
pack-suite route tests; independent HTTP control README/server; root acceptance
script; scoped task/spec/plan and these two delivery documents.

Modified: app `ProjectPage`, `ProjectsPage`, API wrappers, run/stages; CLI
setup/help/setup tests; daemon server; report escape/render/sanitize/styles/tests.
Exact list: `git diff --name-status d307735004e47aa1064779b6b8c2c262071025ab HEAD`.
No tracked files were deleted or renamed. Protected reports, qualifications,
CLAIMS/POSITIONING/PROGRESS and the release pin were not changed.

Original dirty checkout `/home/erbol/RigorRun` and its existing work/research were
left untouched. Integration and worker worktrees/review scratch are retained.
Only owned test children were stopped. Stock package verification removes its
own disposable `/tmp/rigorrun-verify-*` and `/tmp/rigorrun-install-*` directories;
they are reproducible from the retained tarball. Its seven generated reference
PNG versions were retained in `V/package-journey-screenshots` before restoring
the exact tracked originals, so no unrelated screenshot change is delivered.
Acceptance stores, reports, screenshots and the explicit installed CLI remain.

## Limits and not-run scope

- NOT RUN: live LLM candidate, hosted GitHub workflow, production deployment and
  npm publication. No real candidate endpoint/provider was supplied for the
  optional live run; deterministic controls do not substitute for that claim.
- PASS covers the checked Helpdesk scenarios/reviewed boundaries, not arbitrary
  agents, universal integrations or guaranteed safety. Existing DECLARED reset
  isolation remains visible; it is not an observed isolation guarantee.
- Readiness is suite readiness, not candidate health or safety. Twin connect is
  lazy configuration; availability is checked during execution. Ordinary review
  invalidates stale suite evidence; generated suites retain existing quality gates.
- One writer per project/home: one browser tab/client; stop daemon before CLI
  mutations/runs. The UI lock survives SPA navigation, not full reload, another
  tab/process or multiple clients. Wait for pending work before changing clients.
- Full reports/raw run JSON contain local workflow data. Published mode omits
  private evidence and redacts recognized secrets, but arbitrary prose must be
  reviewed before sharing. No internal reasoning/invisible calls are inferred.
- No SaaS/auth/billing, new policy DSL, runtime production blocking, universal
  MCP gateway, real CRM/DB/RLS integration or automatic repair was added.

## Short hackathon demonstration

Build/install with the quickstart, then run its native acceptance command. Open
`A/scoped.html` (actual allowed work, gate 0) and `A/overbroad.html` (actual foreign
evidence, gate 1). Show separate task/policy details, the refusal and leak/outbox
cases, then `A/repeat.html` and the history comparison. The installed browser
path demonstrates explicit review, own HTTP endpoint, reload and fresh repeat.
Show existing CI exit mapping locally. Introduce the control honestly as
scripted test equipment, then explain where a user's real candidate connects.
