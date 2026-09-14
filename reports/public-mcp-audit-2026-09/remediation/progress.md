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
