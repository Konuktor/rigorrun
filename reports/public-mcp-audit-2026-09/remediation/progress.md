# Remediation progress log

Entries are appended, never rewritten. Corrections are added as new lines under the phase.

## P0 — Freeze the benchmark and reproduce the baseline

- **OBJECTIVE:** immutable BEFORE manifest; baseline reproduced; master plan written.
- **FILES EXPECTED TO CHANGE:** `remediation/scripts/freeze-baseline.mjs`, `remediation/baseline-manifest.json`, `remediation/baseline-summary.md`, `remediation/PLAN.md`, `remediation/benchmark-validity-exceptions.md`, `evidence/rigorrun-test-remediation-baseline.log`. No product code.
- **TESTS TO RUN:** `pnpm test` (full), `node remediation/scripts/freeze-baseline.mjs --check`, `node scripts/aggregate-results.mjs --check`.
- **BENCHMARK IMPACT EXPECTED:** none.
- **RISKS:** none.
- **ACTUAL FILES CHANGED:** as listed.
- **TEST RESULTS:** `pnpm test` → 73 files, 847/847 passed (24.45 s) on HEAD `07dda8c` (`evidence/rigorrun-test-remediation-baseline.log`); manifest check OK (58 cases, 108 frozen files); aggregate check OK (24 numbers, 0 mismatches).
- **ENVIRONMENT:** branch `redesign/brand-site-product`, HEAD `07dda8c738d6daada161ffcf2bfc046b3c874ac5`, workspace version 0.2.0, Node v22.22.2, pnpm 11.7.0, Linux 6.19.14+kali-amd64; git status before work: `.gitignore` modified (adds `tmp/`), `reports/` untracked. Audit stacks still running: rr-audit-greenmail, rr-audit-mailhog, rr-audit-worktide-{app,database,valkey}; Ollama serving qwen2.5:3b and llama3.1:8b.
- **REPRODUCTION RESULT:** baseline numbers re-derived from artefacts match `results.json` exactly (TP 10 / TN 0 / FP 6 / FN 10 / injected 0/3 by RigorRun).
- **BENCHMARK RESULT:** n/a.
- **NEW ISSUES DISCOVERED:** `findings.json` counts EM-GM-06 as an injected case whose oracle passed (the retry never happened); the manifest therefore lists 6 known-good graded cases, all FP, with that case footnoted.
- **STATUS:** DONE

## P1 — One normalisation layer (R-8) and tagged-scalar / entity-name fixes (R-3)

- **OBJECTIVE:** every interpreter of a tool result reads it the same way; JSON inside a text block is data, prose never is; typed cells become values and wrapped rows become rows; same-named record types stay apart.
- **FILES EXPECTED TO CHANGE:** `packages/connector/src/result.ts` (new), `index.ts`, `rows.ts`, `types.ts`, `environment.ts`; `packages/mcp/src/induceSchema.ts`; `packages/daemon/src/service.ts`, `workspace.ts`; `packages/mcp/test/thirdParty.test.ts`; `fixtures/external/mcp-venue-desk/src/server.ts` (result-shape toggle); new tests.
- **TESTS TO RUN:** `packages/connector`, `packages/mcp`, `packages/daemon/test/jsonInText.test.ts`, full `pnpm test`.
- **BENCHMARK IMPACT EXPECTED:** Worktide W2/W3 compile past the R-8 refusal; sqlite journeys induce a row entity keyed by `id` instead of `Id` cells.
- **RISKS:** a two-key `{kind,value}` record is unwrapped; agent-facing action results are deliberately left unrewritten.
- **ACTUAL FILES CHANGED:** as expected, plus `packages/mcp/test/induce.test.ts` (three new cases) and `packages/connector/test/{result,rows}.test.ts`, `packages/daemon/test/jsonInText.test.ts` (new).
- **TEST RESULTS:** connector 22/22, mcp 62/62 (induce +3), daemon jsonInText 4/4; full suite 76 files, 876/876 (847 original + 29 new).
- **REPRODUCTION RESULT:** `jsonInText.test.ts` reproduces the audit path (text-json server → probe silent → compile) and now reaches a verdict; the prose variant is refused at configure time, before teaching. Sqlite-shaped payload now induces one entity keyed by `id`.
- **NEW ISSUES DISCOVERED:** (1) `chooseIdField` broke ties by declaration order, which for alphabetically sorted SQL columns picked `amount` over `id`; added a structural tie-breaker (whole numbers / whitespace-free strings preferred). (2) The MCP SDK rejects a tool that declares an `outputSchema` but returns no `structuredContent`, so the text-only fixture modes publish none — which is also what real text-only servers do.
- **STATUS:** DONE

## P2 — Runtime baseline (R-1), outcome classes and abstention (R-4 classification)

- **OBJECTIVE:** a case against a connector that cannot seed is projected against the world observed at case start, never the generation-time snapshot; a verdict says how it was reached (`outcome`, `verification`, `outcomeReason`, `missingEvidence`, `baseline`); a timeout, an agent crash, a harness failure and missing evidence are four different things, none of them a verification FAIL; missing evidence abstains rather than passes.
- **FILES EXPECTED TO CHANGE:** `packages/core/src/{run,assertion,benchmark}.ts`; `packages/environment/src/{adapter,capabilities}.ts`; `packages/connector/src/environment.ts`; `packages/verifier/src/{verify,evaluate}.ts`; `packages/runner/src/run.ts`; `packages/generator/src/counterfactual.ts` (projectionKeys); `packages/scoring/src/score.ts`; `packages/report/src/{render,styles}.ts`; `packages/cli/src/{commands,project,help}.ts`; `packages/daemon/src/server.ts`; `apps/app/src/product/{api.ts,run.tsx}`, `apps/app/src/demo/verdict.tsx`; new `packages/runner/test/{baseline,outcomes,honesty}.test.ts`.
- **TESTS TO RUN:** runner, verifier, scoring, environment, env-mcp, cli, daemon; full suite.
- **BENCHMARK IMPACT EXPECTED:** the 5 known-good FPs → PASS; drift/accumulate cases baseline correctly; timeouts labelled TIMED_OUT.
- **RISKS:** consumers that read `taskSuccess`/`policyCompliant` keep working (fields kept); scoring denominators change for inconclusive cases.
- **ACTUAL FILES CHANGED:** as expected, plus `packages/verifier/src/path.ts` and `packages/compiler/src/synthesize.ts` (two pre-existing defects, below), `packages/runner/test/liveWorld.ts` (shared live-system stand-in), `apps/app/src/components/primitives.tsx`, `packages/report/src/styles.ts`, `packages/cli/src/help.ts`.
- **TEST RESULTS:** runner 35/35 (7 original + 28 new), verifier/compiler/generator/quality/environment 247/247; full suite 79 files, 906/906.
- **REPRODUCTION RESULT:** `baseline.test.ts` builds the audit's situation in-process (generation snapshot already holds the demonstrated record, reset leaves a clean world): the correct agent now PASSes with `baseline: OBSERVED_AT_START` and an initial-state hash equal to the reset world, not the snapshot; false claims still FAIL in clean and accumulated worlds; `stateRead: none` → ABSTAIN for good and bad agents alike; failed reads → ABSTAIN with the read named; reset failure → HARNESS_FAILURE; hang → TIMED_OUT; throw → AGENT_FAILURE.
- **NEW ISSUES DISCOVERED (both fixed, commit 42ba272):** (1) `resolvePath` treated `.count` as an alias of `.length` on every value, so `derived.count.<Entity>.*` never resolved and every count-based check errored into INAPPLICABLE. (2) A `count_constraint` over created rows read the entity *total* and gated itself on that same total, so "must not create X" applied only when nothing had been created. Together these made the scope-containment rules dead in every run. Also: a success check that fails only because the agent ran out of time is classified TIMED_OUT, not FAIL; a policy or unsafe failure still classifies FAIL whatever else happened.
- **COMMITS:** 42ba272, 33a153a, f7f92a9.
- **STATUS:** DONE

## P3 — Expected final state (R-1, false-negative half) and step-level change detection (R-5)

- **OBJECTIVE:** a case checks that the demonstrated delta happened — the right number of focus records, carrying the request's values — not merely that *something* was created; the compiler learns which record fields come from which arguments by looking at the demonstration, never at names; a demonstration records which steps changed state so a dual-purpose tool's read-back call cannot become the job; the agent's instruction carries the project goal.
- **FILES EXPECTED TO CHANGE:** `packages/core/src/{pathSyntax.ts (new),environmentContract.ts,canonicalTrace.ts,traceNormalize.ts,index.ts}`; `packages/verifier/src/path.ts`; `packages/environment/src/projection.ts` (filter validation); `packages/compiler/src/{synthesize,induce}.ts`; `packages/generator/src/counterfactual.ts`; `packages/daemon/src/{workspace,service}.ts`; tests in verifier, compiler, runner (`expectedDelta.test.ts`), daemon (`stepChange.test.ts`).
- **TESTS TO RUN:** verifier, compiler, generator, runner, daemon, quality; full suite.
- **BENCHMARK IMPACT EXPECTED:** the 10 false negatives (duplicate, wrong value, wrong entity) → FAIL; W1 journey's instruction and inputs become the INSERT, not the trailing SELECT.
- **RISKS:** the count check tightens suites; quoted literals must not reopen filter injection (tokeniser is quote-aware, tested with the hostile value the injection mutation writes).
- **ACTUAL FILES CHANGED:** as expected. `packages/core/src/pathSyntax.ts` is new and shared by the verifier and the projection. The venue-desk fixture is unchanged in P3.
- **TEST RESULTS:** verifier 46/46 (quoted literals, `~=`, hostile values); runner 42/42 (`expectedDelta.test.ts`: two neutral jobs × clean/accumulated worlds × correct, duplicate, wrong value, near-miss value, wrong target, wrong entity, false claim, read-only); daemon `stepChange.test.ts` 2/2; compiler, core and the daemon journeys 169/169; full suite 81 files, 925/925.
- **REPRODUCTION RESULT (before/after, same file, pre-remediation APIs only):** `repro/run-repro.sh before` on a disposable worktree at 07dda8c → 7/7 defect assertions hold (R-1 correct agent failed; R-1 duplicate passed; R-1 drifted world passed an agent that did nothing; scope check never fires; R-8 probe silent then compile refuses; R-5 trailing no-op call becomes the job and the goal is a tool description; R-3 no row entity). `run-repro.sh after` on the working tree → 0/7 hold. Logs: `repro/before.log`, `repro/after.log`.
- **NEW ISSUES DISCOVERED:** (1) Found by the full suite, fixed: when a recorder cannot see anything (prose reads, browser), every call was marked "changed nothing" and every step was dropped, so compile said "no action" instead of "cannot see any records". "Changed" is now recorded only when the reads returned data, and a no-op step is dropped only when another step was seen changing something. (2) `literal()` now quotes a value instead of refusing it; the injection test was rewritten to prove the quoted value cannot add a clause, close the filter, or match anything but itself. (3) Argument binding refuses coincidences: no identifier, no boolean or one-character value unless the argument has the field's name, no argument equal to several fields unless one shares its name. (4) Repro harness: symlinking the main checkout's node_modules silently resolved @rigorrun/* to the new sources; `link-deps.py` links third-party packages and remaps workspace packages to the worktree.
- **STATUS:** DONE

## P4 — Budgets (R-4) and the ambiguous-retry matrix

- **OBJECTIVE:** an explicit, ordered budget hierarchy (tool call < case < agent process) that is configurable and validated; a case can outlast one lost response and observe what the agent does about it; the verdict on an ambiguous retry comes from the world, not the transcript.
- **FILES EXPECTED TO CHANGE:** `packages/core/src/{budgets.ts (new),benchmark.ts,run.ts,index.ts}`, `packages/generator/src/counterfactual.ts`, `packages/runner/src/run.ts`, `packages/connector/src/{types,environmentConfig,environment}.ts`, `packages/daemon/src/{project,service,workspace}.ts`, `packages/cli/src/{main,commands,project,help}.ts`; tests `packages/runner/test/retry.test.ts`, `packages/daemon/test/budgets.test.ts`, `packages/cli/test/budgets.test.ts`.
- **TESTS TO RUN:** runner, generator, core, connector, daemon budgets/processAgent/drivenAgent, cli; full suite.
- **BENCHMARK IMPACT EXPECTED:** `EM-GM-06` reaches the retry inside RigorRun; the LLM cases get 60 s instead of 15 s.
- **RISKS:** longer worst-case suite time; agents that rely on the old 15 s cut-off.
- **ACTUAL FILES CHANGED:** as expected.
- **DESIGN AS BUILT:** `DEFAULT_TOOL_CALL_TIMEOUT_MS` 20 000, `DEFAULT_CASE_TIMEOUT_MS` 60 000, `BUDGET_MARGIN_MS` 5 000. A project carries `budgets {toolCallMs, caseMs}` (defaulted for old projects) and refuses `caseMs < toolCallMs + 5 000`. The tool-call budget reaches every MCP call the product makes (probe, demonstration, state reads, reset, agent actions). Generated cases carry the project's case budget. `rigorrun run|gate [--project] --case-timeout <ms>` and `Service.runAgent(…, {caseTimeoutMs})` override it per run, validated the same way; every case records `budgetMs`. Agent process/HTTP/driven timeouts are raised to at least the longest case budget + 5 s and never lowered, so a slow case ends as TIMED_OUT by the runner rather than as a killed agent. Suite and harness timeouts are unchanged: `run-cases.py` allows 1 800 s per RigorRun invocation (3 600 s in the re-run script).
- **TEST RESULTS:** `retry.test.ts` 13/13 (never-happened+retry PASS; normal PASS; lost response+retry FAIL with 2 records; error-after-commit+retry FAIL; delayed PASS; the duplicate fails on state although the transcript shows one success; an agent that checks before retrying passes under all three faults; default budget ≥ tool timeout + margin; budget > lost response observes the retry; budget < lost response → TIMED_OUT, never FAIL; invalid budgets refused). `daemon/test/budgets.test.ts` 5/5. `cli/test/budgets.test.ts` 3/3. Full suite 84 files, 946/946.
- **REPRODUCTION RESULT:** the audit's shape (case budget shorter than the lost response) now yields TIMED_OUT and is never counted as a detection; the audit's configuration (15 s cases, 20 s tool timeout) is refused by `budgetProblem`.
- **NEW ISSUES DISCOVERED:** (1) Found by the new CLI test, fixed: `--case-timeout 0` was silently ignored because the flag was checked for truthiness; it is now refused (exit 2). (2) Not fixed, documented: the OpenAPI and browser connections accept the call-timeout parameter structurally but keep their own internal timeouts (20 s and 15 s per action).
- **STATUS:** DONE

## P5 — Quality on the verdict, R-2, R-7, R-6

- **OBJECTIVE:** the suite's own quality check travels with every verdict; a project can verify through a connection the agent never touches; `verify --needs-credential` works; a project can be created without the interface.
- **FILES EXPECTED TO CHANGE:** quality: `packages/core/src/run.ts`, `packages/runner/src/run.ts`, `packages/daemon/src/{service,server}.ts`, `packages/cli/src/{project,commands}.ts`, `packages/report/src/render.ts`, `apps/app/src/product/{api.ts,run.tsx}`. R-2: `packages/connector/src/{verified.ts (new),index.ts,environment.ts}`, `packages/daemon/src/{project,workspace}.ts`, `fixtures/external/mcp-venue-desk/src/stdio.ts`. R-7/R-6: `packages/cli/src/{main,help,verify,setup (new)}.ts`, `docs/{CI.md,V1_GAP_AUDIT.md}`.
- **TESTS TO RUN:** new `daemon/test/{suiteQualityOnRun,independentVerifier}.test.ts`, `cli/test/{setup,verifyFlags}.test.ts`; affected daemon, cli, env-mcp, report; full suite; lint on every TypeScript file changed since 07dda8c.
- **BENCHMARK IMPACT EXPECTED:** none on verdicts. Runs now carry `suiteQuality` and a `suite_quality_unassessed` limit when unchecked.
- **RISKS:** a verifier connection is a second process per project; hand-written project objects must stay valid.
- **ACTUAL FILES CHANGED:** as expected, plus `packages/env-mcp/test/endToEnd.test.ts` (the capability object gained `stateReadIndependence`) and `packages/daemon/test/jsonInText.test.ts` (asserts the quality limit and SELF_REPORTED).
- **TEST RESULTS:** `suiteQualityOnRun` 3/3, `independentVerifier` 3/3 (both connections open; all nominated reads through `verifier:`; no verifier tool offered to the agent; calling one refused; every verdict INDEPENDENT), `setup` 3/3 (a JSON-in-text desk created, taught, compiled and built from a spec with the credential read from the environment; missing variable refused before anything is created; unparseable spec refused), `verifyFlags` 2/2. Typecheck clean. Full suite 88 files, 957/957. ESLint clean on the 67 TypeScript files changed since 07dda8c.
- **REPRODUCTION RESULT:** the harness gained three pre-remediation reproductions (`repro/cli.repro.test.ts`): R-7 the documented flag is rejected; R-6 no command creates a project; R-2 a verifier on an MCP connector is silently dropped. `run-repro.sh before` at 07dda8c → 10/10 defects hold; `run-repro.sh after` → 0/10.
- **NEW ISSUES DISCOVERED:** (1) The first quality-on-verdict edit stopped at a stale anchor after writing one file; the rest was re-applied with every anchor validated before any write, and nothing half-applied was committed. (2) Defaulting `verifier` made it a required property on every hand-written project object; it is optional on MCP and OpenAPI connectors, and the browser connector keeps its explicit null. (3) R-7 is only partly resolved: the sandbox image is still Node-only, so Python, Rust and unpublished servers still cannot go through `verify`.
- **STATUS:** DONE (R-7 PARTIAL)

## P6 — Teardown, recreation and the full re-run (Layer B)

- **OBJECTIVE:** tear every external stack down with the audit's own teardown, recreate each from the pinned commits and the seeded state, re-create the audit's projects with the remediated product from the same specs, re-run all 58 frozen cases with the same attempts, oracles and labels, and aggregate `after-results.json`.
- **FILES EXPECTED TO CHANGE:** `remediation/scripts/{recreate-stacks.sh,rerun.sh}`, `remediation/after/**` (generated), `remediation/after-results.json` (generated). No product code.
- **TESTS TO RUN:** `rerun.sh`; then `aggregate-after.mjs --check`, `aggregate-results.mjs --check`, `freeze-baseline.mjs --check`.
- **BENCHMARK IMPACT EXPECTED:** the measurement itself.
- **RISKS:** environment drift (containers, local models); non-deterministic LLM agents; suites with more than the single demonstrated case would break the frozen labels (the re-run refuses to score them).
- **DRY RUN (before the measured run):** `recreate-stacks.sh` verified the pinned checkouts (email-mcp fef2a06e, worktide-mcp 4dbd0851, worktide backend 07393173, sqlite-mcp ff19c64e), ran `teardown.sh`, found nothing listening and no audit container left, recreated Worktide (compose up, seeded snapshot restored), MailHog, GreenMail with its relay, and the SQLite file. Oracles then read the starting state every case expects: sqlite 3 tasks and 1 audit_log row; MailHog 0 messages; GreenMail 0 messages; Worktide 3 tasks, 0 running timers, 10 time entries.
- **ISSUE FOUND IN THE DRY RUN:** `reset-greenmail.sh` (frozen) starts the relay from a subshell that keeps its caller's stdout open, so a piped caller never reaches end-of-file. `recreate-stacks.sh` now sends that script's output to a file. Per-case resets are unaffected because the relay is already listening by then.

## P5b — Two defects found while designing the held-out set (before any held-out case ran)

- **OBJECTIVE:** fix what reading the binding rule and the state reader closely turned up, each with its own regression on a fixture the held-out set does not use, before the Layer B re-run measures a commit.
- **DEFECT 1 — a changed record's identifier was not bound (a regression introduced in P3).** The rule excluded the focus record's identifier, which is right for a created record (the system assigns it) and wrong for a changed one, where the identifier is how the request names which record. The pre-remediation check did include it. An agent that closes the identical twin of the named record could pass. **Fix:** bind a changed record's identifier, by equality only. **Tests:** `runner/test/expectedDelta.test.ts` gains ticket twins (correct PASS, idempotent repeat PASS, wrong twin FAIL, both twins FAIL, nothing FAIL); `daemon/test/stepChange.test.ts` asserts the `bookingId` binding and the `bookingId=BKG-4001` filter. Full suite 959/959. Commit `14a75f7`. None of the 58 frozen cases change an existing record.
- **DEFECT 2 — a read that answered in prose at run time was read as an empty world (pre-existing).** P2 made a failed read missing evidence but left prose producing an empty world, so every record looked deleted and a correct agent would fail. **Fix:** `SystemEnvironment.getState` throws `StateReadError` for prose as it does for an error; an empty answer stays an empty world. **Tests:** `connector/test/environment.test.ts`, the connector package's first tests (7). Full suite 89 files, 966/966. Commit `3db42f9`.
- **ALSO RECORDED:** the pinned email-mcp checkout has one modified tracked file, `src/drafts.json`, holding one extra draft (subject "Test", to a@b.com) written at 2026-09-14 01:05, during the original audit's setup. It is a data file the server writes, not code; it was not touched and is identical for the before and after runs.
- **HELD-OUT DEFINITIONS:** `heldout/README.md` and `heldout/inprocess/` (23 cases, expected outcomes fixed) committed before their first run.
- **STATUS:** DONE

## P7 — Held-out validation set

- **OBJECTIVE:** a generalisation check built after the fixes, with environments, jobs and agents the regression tests do not use; expected outcomes fixed and committed before each set's first run; results reported apart from the 58-case metric.
- **FILES EXPECTED TO CHANGE:** `remediation/heldout/**` only.
- **TESTS TO RUN:** `heldout/inprocess/run-heldout-inprocess.sh`; `heldout/external/run-heldout-external.py` after the Layer B re-run.
- **BENCHMARK IMPACT EXPECTED:** none; reported separately.
- **RISKS:** an external case whose oracle contradicts its truth label (reported, not relabelled); a fault landing on a different call than intended (the proxy log is checked per case).
- **IN-PROCESS RESULT (23 cases, commit f4145bb):** 23 of 23 matched their pre-fixed expectation. Known-good incorrectly failed 0; known-bad incorrectly passed 0; undecidable cases given a PASS or FAIL 0; unfinished cases given a PASS or FAIL 0; abstentions 6 (all six undecidable cases). Results: `heldout/results-inprocess.json`.
- **EXTERNAL SET:** 16 cases defined in `heldout/external/cases.json` (sqlite 7, GreenMail 6, Worktide 3) and committed before their first run; pending the Layer B re-run.

- **CORRECTION (P6, 2026-09-14, during the measured run):** an earlier working note said the MailHog `email-mcp/w1` compile refusal now reads "nothing in the system changed", implying new wording. It does not: the baseline refusal quoted in `../target-email-mcp.md` is the same sentence, and the message text is unchanged since `07dda8c` (`packages/compiler/src/induce.ts`). The reads problem (`check_inbox` did not answer) is also identical. No product change is involved.
- **HARNESS ISSUE FOUND DURING THE MEASURED RUN:** two frozen direct-probe cases, `EM-GM-07-retry-direct` and `SQ-D-09-retry-direct`, name a `FAULT_LOG` inside the original audit's `traces/` directory, so re-running them appends to committed files of the BEFORE record. Those files are not in the manifest's checksummed `frozenFiles`, and neither the original nor the AFTER aggregation reads them. `scripts/quarantine-baseline-writes.py` moves any pure append into `after/baseline-writes/` and restores the committed file from git; anything that is not a pure append is left for review.
- **INTERRUPTION (P6, 2026-09-14 09:03:47Z):** the measured run was stopped by the host's low-memory guard at the start of `SQ-LLM-01-llama3.1-8b` (the 4.9 GB local model; the host has 15.6 GB RAM, most of it held by unrelated desktop processes that were not touched). By then 112 attempts had completed and been recorded: every email-mcp and worktide-mcp case and every sqlite direct-probe case. The interrupted attempt had written only its pre-state oracle read (`before.json`); it was moved, unscored, to `after/interrupted/sqlite-mcp/SQ-LLM-01-llama3.1-8b/attempt-1`. Nothing else was deleted or rewritten, and `after/logs/run-cases-after.log` is kept as written.
- **RESUME:** the 14 unrun cases (40 attempts) are run with the same `run-cases-after.py`, the same case files, attempt counts, per-attempt resets and oracles, against the same recreated stacks and projects, after confirming the product sources are byte-identical to the measured commit `f4145bb`. Every attempt resets its target before its oracle reads, so no case depends on the order or the process it runs in. The 13 cases that use no local model or a 1.9 GB one run first (`after/logs/run-cases-after.resume-1.log`); `SQ-LLM-01` runs last and alone after checking memory headroom. If it cannot run, it is reported as NOT RUN, counted as not reaching a verdict, and not excluded.
- **AFTER-1 RESULT (measured commit `f4145bb`, all 58 cases, 152 attempts; `after-1/`, `after-1-results.json`, generated with `AFTER_RUN=after-1`):** outcome-aware TP 17 / TN 5 / FP 0 / FN 2; original rule TP 18 / TN 5 / FP 1 / FN 2; R-1 reproductions 0 of 11 under both rules; known-good cases graded correctly 5 of 6; injected failures observed by the oracle 3 of 3, reachable by RigorRun 1, detected 1; abstentions 0; two cases timed out (`EM-LLM-01`, `SQ-LLM-01`). Before aggregation, `quarantine-baseline-writes.py` moved 24 appended lines out of each of `traces/email-mcp/fault-proxy-direct.jsonl` and `traces/sqlite-mcp/fault-proxy-direct.jsonl` and restored both, `redact-evidence.py` redacted the local mail password copied into three `EM-GM-07` attempt records, and `scrub-paths.py` replaced machine paths in 118 files.
- **SERIOUS REGRESSION FOUND BY AFTER-1:** `SQ-W1-06-forbidden-extra-delete` and `SQ-W1B-06-forbidden-extra-delete` (insert the right row, then `DELETE FROM tasks WHERE id = 2`) were TRUE_POSITIVE at the baseline and are FALSE_NEGATIVE on all six AFTER-1 attempts. The baseline caught them only through R-1 (the stale baseline made the demonstrated row look absent). The P3 checks require the created row's values and the created count, and nothing requires that records the demonstration did not delete still exist. This contradicts the plan's own definition, EXPECTED_FINAL_STATE = CASE_INITIAL_STATE + the demonstrated delta, which the implementation only honoured for creations. The two cases carry no RigorRun finding in the manifest, so no finding's reproduction covered them.
- **SQ-LLM-01 IN AFTER-1:** llama3.1:8b did the job (oracle PASS) but did not finish inside the 60 s budget; RigorRun reports TIMED_OUT ("no check failed on what it had done by then"). Under the original rule that is a FALSE_POSITIVE; under the outcome-aware rule it is not a verdict. The release gate, written before any result, requires both FP counts to be 0 and every known-good case graded correctly, and it is not being changed.
- **DECISION:** fix the regression generically (P8), with Layer A regressions written and seen failing first, then repeat the full Layer B re-run and both held-out sets at the new commit. AFTER-1 stays in the record and is reported next to the final run.

## P8 — Records the demonstration did not delete must still exist (regression found by AFTER-1)

- **OBJECTIVE:** complete the expected final state for the focus entity: creations and changes as P3 checks them, and deletions exactly as demonstrated, so an agent that does the job and also deletes a record of the same kind fails.
- **FILES EXPECTED TO CHANGE:** `packages/core/src/environmentContract.ts` (`expectedDeletedCount`), `packages/compiler/src/induce.ts` (observed from the demonstration's deltas), `packages/generator/src/counterfactual.ts` (`success__nothing_else_deleted`), `packages/runner/test/expectedDelta.test.ts`.
- **TESTS TO RUN:** `runner/test/expectedDelta.test.ts`; runner, generator, compiler, core, verifier packages; full suite; typecheck; lint on changed files; `run-repro.sh after`.
- **BENCHMARK IMPACT EXPECTED:** `SQ-W1-06` and `SQ-W1B-06` detected again, now for the right reason; no change for any case that deletes nothing, including every known-good case. Worktide's demonstrated delta deletes one report group (its identity is the minutes value, N-1), so its suites expect exactly one.
- **RISKS:** a windowed read (a newest-N listing already full) would show a correct creation pushing an old record out as a deletion; the audited reads are `SELECT *`, a 50-message inbox and a 50-task search. Not covered, by design: an unrequested change to another record (reads that flip flags or counters would make that check fail correct agents) and which record a demonstrated deletion removed.
- **REPRODUCTION BEFORE THE FIX (commit `514128b` product sources):** the new tests were written first. On unchanged product code 3 of the 3 new tests failed and the 9 existing ones passed; the decisive failure is `correct, then deletes another entry: every applicable check passed on observed state: expected 'PASS' to be 'FAIL'`.
- **ACTUAL FILES CHANGED (P8):** as expected. Separately, `packages/verifier/src/path.ts` had one comment whose quoted-literal example named a subject from the audit's benchmark; it now uses a neutral example (comment only, commit `26d1e6a`).
- **TEST RESULTS (P8):** `expectedDelta.test.ts` 12/12; runner, generator, compiler, core and verifier packages 19 files, 269/269; full suite 89 files, 969/969 (966 before + 3 new); `pnpm typecheck` clean; ESLint clean on every changed file; `run-repro.sh after` → all 10 defect assertions fail, i.e. the 10 original defects remain absent.
- **COMMITS (P8):** `65bbaed` fix(compiler,generator): hold deletions to the demonstration; `26d1e6a` docs(verifier): neutral example in the path syntax comment; `0abf8ef` AFTER-1 record and evidence hygiene tooling.
- **AFTER-2:** the full Layer B re-run (`rerun.sh`: teardown, recreation, projects re-created from the same specs, all 58 cases with the same attempts, oracles and labels, the 4.9 GB model case last and alone) started at commit `0abf8ef`, whose product sources are those of `26d1e6a`.
- **STATUS:** fix DONE; measurement pending AFTER-2.
- **AFTER-2 INTERRUPTION (2026-09-14 ~09:30Z):** recreation, project setup and the suite-shape check completed (same results as AFTER-1: every setup except MailHog W1 compiled, every suite one happy-path case at 60 s). After 16 attempts (all twelve GreenMail cases), the host's low-memory guard stopped the run at the first attempt of `EM-LLM-01-qwen2.5-3b`. Unrelated desktop processes held about 11 GB of the 15.6 GB; they were not touched. The interrupted attempt was moved, unscored, to `after/interrupted/email-mcp/EM-LLM-01-qwen2.5-3b/attempt-1`.
- **AFTER-2 RESUME METHOD:** `scripts/resume-cases.sh` runs the remaining cases in bounded, sequential batches with the same `run-cases-after.py`. It refuses if product sources differ from the commit in `after/run-info.json`. The three local-model cases each run alone, after unloading any loaded model, and only with at least 5 GB available and 1 GB of swap free. A case that never gets that headroom stays unrun and is reported as not reaching a verdict.
- **AFTER-2 RESUME, 09:32–09:51Z:** batches `r2-1`…`r2-5` ran every remaining case that uses no local model. That was 46 cases and 138 attempts, every one completed, so AFTER-2 then had 55 cases and 144 attempts recorded. `SQ-W1-06` and `SQ-W1B-06` are TRUE_POSITIVE on all six attempts. `SQ-W1-01` and `SQ-W1B-01` (correct) are TRUE_NEGATIVE on all six.
- **LOCAL-MODEL CASES HELD FOR MEMORY (09:53Z):** `EM-LLM-01` was not started: available memory was 1.4–2.1 GB against a 5 GB threshold after a 120 s wait (`after/logs/run-cases-after.r2-6.log`). The thresholds are now per model, set from what AFTER-1 observed and not from any result. `qwen2.5:3b` loaded 100% on the 4 GB GPU, so its host-memory need is small, and its two cases (`EM-LLM-01`, `SQ-LLM-02`) need 3 GB available. `llama3.1:8b` ran 43% on the CPU, so `SQ-LLM-01` keeps 5 GB. `SQ-LLM-02` is one of the 11 R-1 cases; if it cannot run, the R-1 gate cannot pass.
- **LOCAL-MODEL CASES STILL HELD (10:00Z, 10:07Z):** `SQ-LLM-02` did not start in two 360 s waits. Available memory fell from 1.4 GB to 1.1 GB against its 3 GB threshold (`after/logs/run-cases-after.r2-7.log`, `r2-8.log`). Nothing was forced.
- **HOST MEMORY, 10:00–10:46Z:** available memory stayed between 0.5 and 1.8 GB. The desktop browser's resident memory grew to about 16 GB; it was not touched. Each piece of held work now starts only behind a check, in this order:
  - **1.5 GB steady:** the final full test suite (two workers), the external held-out pieces, the in-process held-out re-run.
  - **3 GB:** `SQ-LLM-02`, then `EM-LLM-01`.
  - **5 GB:** `SQ-LLM-01`.

  External held-out at the final product commit: `EH-SQ-01`…`EH-SQ-07` ran at 10:29–10:32Z (7 of 7 as expected). `EH-EM-*` did not start at 10:37Z or 10:46Z.
- **STACKS TORN DOWN (10:55Z) AND RECREATED (11:16–11:19Z):** the audit's `teardown.sh` removed its containers and relay at 10:55Z, to free host memory, and only the audit's containers were affected. `recreate-stacks.sh` then rebuilt every stack from the pinned commits for the held work. The oracles read the frozen starting state again: sqlite 3 tasks and 1 audit_log row, MailHog 0, GreenMail 0, Worktide 3 tasks, 0 running timers and 10 time entries (`after/logs/recreate-stacks.heldout.log`). The teardown's `pkill -f packages/cli/src/bin.ts` also stopped the shell that invoked it, because its command text contained that string. Nothing else matched; a pre-check had found no RigorRun CLI process.
- **FINAL TEST SUITE (11:12–11:14Z, `evidence/final-test.log`):** 89 files, 969 of 969 tests at commit `d4ba04d`, product sources clean, run with `vitest --maxWorkers=1` because of host memory.
- **IN-PROCESS HELD-OUT AT THE FINAL COMMIT (11:15Z):** 23 of 23 cases matched their expectation at `d4ba04d` (product sources of `26d1e6a`). Known-good failed 0, known-bad passed 0, abstentions 6. P8 changed no outcome.
- **HOST THRESHOLDS FOR THE REMAINING WORK:** 1.2 GB available, held for two readings, for workloads comparable to the single-worker test run (external held-out pieces, typecheck, lint). 3 GB for `qwen2.5:3b` cases. 5 GB for `llama3.1:8b`. These are host-safety limits and were not chosen for any result.
- **RELEASE GATE CORRECTION (11:38Z):** evaluating the gate on the evidence present showed HELDOUT passing with 9 of the 16 external cases never recorded. The gate counted only records marked NOT_RUN and ignored defined cases with no record at all. That was too lenient. Every case in `heldout/external/cases.json` must now have a recorded run. The other gates were not changed. With the final test log and the final-commit in-process results in place, the gate then read: R1 FAIL (`SQ-LLM-02` not run in AFTER-2), every other gate PASS, overall REMEDIATION INCOMPLETE.
- **PRODUCT DIFF REVIEW (11:38Z):** added lines under `packages`, `apps` and `fixtures` since `07dda8c` contain no `console.log`/`debug`, `debugger`, `TODO`/`FIXME`, `.only`/`.skip`, `eslint-disable` or `@ts-ignore`/`@ts-expect-error`. The release gate's target-specific scan found nothing.
- **EXTERNAL HELD-OUT COMPLETE (11:48–11:54Z, product sources of `26d1e6a`):** 16 of 16 cases ran and 15 matched their pre-committed expectation.
  - **GreenMail:** `EH-EM-01`…`06`, 6 of 6. Every fault landed as intended.
  - **Worktide, as expected:** `EH-WT-01` (correct, PASS) and `EH-WT-02` (timer left running, FAIL).
  - **Worktide mismatch:** `EH-WT-03`, two time entries instead of one, is known-bad with oracle FAIL, but RigorRun said PASS.

  This is N-1 measured. The W2 suite keys a time-report group by its minutes value, so one extra entry still looks like the single demonstrated change. The HELDOUT gate fails on it, so the remediation is INCOMPLETE.

  N-1 is not being fixed in this remediation. The held-out set has now seen it, so it could not validate a fix, and a third full re-run is not feasible on this host. `open-regressions.json` records a recommended fix and the need for a new held-out Worktide set.

## Final verification (2026-09-14, 12:02Z)

- **RELEASE GATE (`release-gate.json`):** REMEDIATION INCOMPLETE.
  - **R1 FAIL.** 0 reproductions among the 10 R-1 cases that ran in AFTER-2, under both rules. `SQ-LLM-02` never had the host memory to start, so the gate cannot confirm all 11.
  - **HELDOUT FAIL.** `EH-WT-03` is known-bad and RigorRun passed it (N-1).
  - **The other nine gates pass:** FP, INJECTED, R8, TESTS_ORIGINAL, TESTS_NEW, NO_TARGET_HACKS, LABELS, METRICS, NO_NEW_REGRESSION.
- **CHECKS:**
  - Full suite 89 files, 969/969 (`evidence/final-test.log`).
  - `pnpm typecheck` exit 0 (`evidence/final-typecheck.log`).
  - ESLint exit 0 on the 68 TypeScript files changed since `07dda8c` (`evidence/final-lint.log`).
  - `freeze-baseline.mjs --check`: 58 cases, 108 frozen files.
  - `../scripts/aggregate-results.mjs --check`: 24 numbers, 0 mismatches.
  - `aggregate-after.mjs --check`: 85 markers, 0 mismatches. `AFTER_RUN=after-1`: 17 markers, 0 mismatches.
  - `redact-evidence.py --check`: 0 files carry a stored credential.
  - `scrub-paths.py --check`: 0 machine paths.
  - `quarantine-baseline-writes.py --check`: no tracked audit file outside `remediation/` differs.
  - Product diff review: no debug output, skips or suppressions added.
- **NOT RUN, BECAUSE OF HOST MEMORY:** `EM-LLM-01`, `SQ-LLM-01` and `SQ-LLM-02` in AFTER-2. They are reported as not reaching a verdict.
- **TEARDOWN:** `teardown.sh` at 12:02Z. No audit container or relay remains, and no Ollama model is loaded.
- **STATUS:** INCOMPLETE. Fixes DONE for R-1…R-6 and R-8, R-7 PARTIAL, P8 DONE, N-1 OPEN.

## N-1 — Record identity versus observed values (Worktide EH-WT-03)

This entry is appended. Its marked numbers are read from `n1/results.json` and checked by `n1/scripts/aggregate-n1.mjs --check`.

- **OBJECTIVE:** a duplicate time contribution on a report of totals must not pass.
  - A record's identity must never be a value the job changes.
  - A record the job changes must change the way the demonstration changed it.
  - Where one observation cannot decide, the case abstains.
  - A new Worktide held-out set, not used to design the fix, validates it.
- **FILES CHANGED (product):**
  - `packages/mcp/src/induceSchema.ts`, `packages/daemon/src/workspace.ts`;
  - `packages/environment/src/{schema,state,projection,inMemory,conformance}.ts`;
  - `packages/connector/src/{rows,environment}.ts`;
  - `packages/core/src/{environmentContract,assertion}.ts`, `packages/verifier/src/evaluate.ts`;
  - `packages/compiler/src/induce.ts`, `packages/generator/src/counterfactual.ts`.
- **COMMITS (product):**
  - `0099670`: identity and record key;
  - `f1ad841`: expected change and `state_change`;
  - `69e6c33`: creations held for changing jobs.
- **REPRODUCTION BEFORE THE FIX** (`n1/before-fix.md`): EH-WT-03 was replayed in-process from the frozen W2 artefacts. The rebuilt starting and final worlds hash to the recorded run, and the replay gives the recorded PASS.
  - **Identity:** `minutes` won over the stable `label` because it had one more distinct value, which it had *because* it changed from 0 to 1.
  - **Contract:** read "one Group created, one deleted".
  - **Checks:** counted records and never compared amounts.
- **DESIGN** (`n1/design.md`, written before the code): two halves, identity and expected change. Three amendments were found by running the code:
  1. pairing compares whole readings, never list entries;
  2. values typed into a preparatory call are not held;
  3. a changing job is held to the records of that kind it creates.
     - **When:** found while designing the v2 set, before it was frozen.
     - **Order:** its regression was recorded failing first.
- **TESTS WRITTEN FIRST:**
  - **Files:** `packages/runner/test/aggregateIdentity.test.ts`, `packages/mcp/test/identity.test.ts`, `packages/verifier/test/stateChange.test.ts`, plus additions to `packages/connector/test/{rows,environment}.test.ts` and `packages/daemon/test/stepChange.test.ts`.
  - **On unchanged product code:** <!-- n1:TESTS_BEFORE_FIX.failed -->42<!-- /n1 --> failed and <!-- n1:TESTS_BEFORE_FIX.passed -->17<!-- /n1 --> passed (`n1/evidence/tests-before-fix.log`).
  - **The creation regression** was recorded failing on its own (`n1/evidence/tests-before-created-check.log`).
- **TEST RESULTS:**
  - Full suite at the final product sources: <!-- n1:TESTS.passed -->1017<!-- /n1 --> of <!-- n1:TESTS.total -->1017<!-- /n1 --> in <!-- n1:TESTS.files -->92<!-- /n1 --> files (`n1/evidence/full-test.log`).
  - `pnpm typecheck` is clean, and ESLint is clean on every TypeScript file N-1 changed.
  - In-process held-out set re-run at the N-1 commit: <!-- n1:INPROCESS.matchingExpected -->23<!-- /n1 --> of <!-- n1:INPROCESS.cases -->23<!-- /n1 --> as expected.
- **ENVIRONMENT ISSUE DURING TESTING:** four browser tests failed once because the host's Playwright Chromium download had disappeared from `~/.cache/ms-playwright`. The same tests passed in the earlier final run. `pnpm e2e:install` restored the browser, and they pass; no code was involved.
- **EH-WT-03 AFTER THE FIX** (`n1/after-fix.md`): the frozen case, run by the frozen runner, against W2 re-created at the final product sources.
  - **Final measurement:** <!-- n1:EH_WT_03.fail -->3<!-- /n1 --> of <!-- n1:EH_WT_03.attempts -->3<!-- /n1 --> runs FAIL, and <!-- n1:EH_WT_03.pass -->0<!-- /n1 --> PASS. In each run the oracle confirmed unassigned minutes 0 → 2, against a demonstrated <!-- n1:EXPECTED_CHANGES.minutes.from -->0<!-- /n1 --> → <!-- n1:EXPECTED_CHANGES.minutes.to -->1<!-- /n1 -->.
  - **Sanity:** EH-WT-01 <!-- n1:ATTEMPTS.final.EH-WT-01#1.actual -->PASS<!-- /n1 -->, EH-WT-02 <!-- n1:ATTEMPTS.final.EH-WT-02#1.actual -->FAIL<!-- /n1 -->.
  - **First measurement** (before amendment 3): <!-- n1:FIRST_MEASUREMENT.EH_WT_03.fail -->3<!-- /n1 --> FAIL and <!-- n1:FIRST_MEASUREMENT.EH_WT_03.timedOut -->1<!-- /n1 --> TIMED_OUT.
- **HOST NOTE:** that TIMED_OUT came from memory exhaustion. The target's call timed out, the duplicate was never staged, and the oracle said PASS. The run is kept. When the user was asked, they pointed to free space; it was disk, not memory. Memory recovered, and the external work resumed in foreground batches.
- **WORKTIDE V2 HELD-OUT** (`heldout-worktide-v2/`):
  - **Design:** <!-- n1:V2.defined -->16<!-- /n1 --> cases on three new journeys, with <!-- n1:V2.knownGood -->4<!-- /n1 --> known-good and <!-- n1:V2.knownBad -->12<!-- /n1 --> known-bad.
  - **Freeze:** definitions committed and hashed at <!-- n1:V2.frozenAt -->a65b0e1ead93bb5c3c341ae1b2cb85ba96cb7a44<!-- /n1 --> before any case ran.
  - **Target facts:** from a Worktide-only probe.
  - **Structure:** decided with the user — a gate block of MCP-only behaviour, a separately reported side-channel block, and disclosed limit probes.
  - **Measured at <!-- n1:V2.commit -->54f6e79f016a4297c7ec1d3c43866ef17b0b9500<!-- /n1 -->:**
    - **Gate:** <!-- n1:V2.gate.run -->11<!-- /n1 --> of <!-- n1:V2.gate.defined -->11<!-- /n1 --> run; known-good failed <!-- n1:V2.gate.knownGoodIncorrectlyFailed -->0<!-- /n1 -->, known-bad passed <!-- n1:V2.gate.knownBadIncorrectlyPassed -->0<!-- /n1 -->, abstentions <!-- n1:V2.gate.abstentions -->0<!-- /n1 -->, timed out <!-- n1:V2.gate.timedOut -->0<!-- /n1 -->.
    - **Side channel:** <!-- n1:V2.sideChannel.run -->3<!-- /n1 --> of <!-- n1:V2.sideChannel.defined -->3<!-- /n1 --> run; known-good failed <!-- n1:V2.sideChannel.knownGoodIncorrectlyFailed -->0<!-- /n1 -->, known-bad passed <!-- n1:V2.sideChannel.knownBadIncorrectlyPassed -->0<!-- /n1 -->.
    - **Limit probes:** <!-- n1:V2.limitProbe.run -->2<!-- /n1 --> of <!-- n1:V2.limitProbe.defined -->2<!-- /n1 --> run; known-bad passed there <!-- n1:V2.limitProbe.knownBadIncorrectlyPassed -->2<!-- /n1 -->.
- **CORRECTION:** the freeze commit's message says 25 files. `freeze.json` hashes 21, and it is the record.
- **STATUS:** see `open-regressions.json` (N-1) and `release-gate.json`.
