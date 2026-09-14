# Final pre-public-audit qualification of RigorRun

**Question:** is RigorRun sufficiently validated to begin carefully controlled public reliability audits of popular MCP servers (Playwright MCP, GitHub MCP, Filesystem MCP)?

**Answer:** see [Release gate](#release-gate). The status is computed by `scripts/release-gate-final.mjs` from the evidence in this directory and nothing else.

- **Product under test:** commit <!-- fq:productCommit -->a9edbec98ea9056bf1b6a3773cc3fa9ba2692d01<!-- /fq -->, package <!-- fq:packageVersion -->0.2.0<!-- /fq --> (`product-under-test.json`).
- **Freeze of benchmark inputs:** the frozen benchmark inputs, the Worktide v2 held-out freeze and the pinned target commits were verified before any run and are re-verified by the gate.
- **Numbers:** every number in this file is a marker, checked against `results.json` by `scripts/aggregate-final.mjs --check`.
- **Run history:** `progress.md` records every step, deviation and correction in the order it happened.

## Decisions recorded before any affected run

1. **GATE 4 is strict.** A known-good frozen case must be TRUE_NEGATIVE under both rules on every attempt. TIMED_OUT, ABSTAIN or HARNESS_FAILURE on a known-good case fails the gate.
2. **IO-5 counts as observable.** The unrelated change is visible in the verifier's reads, so the expected verdict is FAIL.
3. **IO-7 with both reads nominated is gated.** Both read orders must FAIL.
4. **GreenMail suites are scored strictly.** At the product commit both GreenMail suites generate a second case, so the frozen protocol refuses to score them. The gates use the strict protocol, where those cases are NOT_RUN. A happy-path-only diagnostic measures them separately and is never merged.
5. **Evidence commits are local only.** Nothing is pushed or published.

## Frozen 58-case benchmark at the product commit (strict protocol)

The run used the original cases, labels, `expect` predicates, oracles, pinned targets and attempt counts, executed by the committed `run-cases-after.py` (`scripts/run-frozen-58.sh`, `evidence/frozen-58/`).

### Coverage

| Item | Value |
| --- | --- |
| Cases run / total | <!-- fq:frozen58.CASES_RUN -->46<!-- /fq --> / <!-- fq:frozen58.TOTAL_CASES -->58<!-- /fq --> |
| Attempts run / planned | <!-- fq:frozen58.ATTEMPTS_RUN -->136<!-- /fq --> / <!-- fq:frozen58.ATTEMPTS_PLANNED -->152<!-- /fq --> |
| NOT RUN | <!-- fq:frozen58.NOT_RUN -->12<!-- /fq --> (the GreenMail RigorRun-mode cases; reason `SUITE_SHAPE_REFUSED`, `evidence/frozen-58/not-run.json`) |
| Direct-probe cases run (not scored for RigorRun) | <!-- fq:frozen58.DIRECT_PROBE_CASES_RUN -->32<!-- /fq --> |
| RigorRun-mode cases run / defined | <!-- fq:frozen58.RIGORRUN_MODE_CASES_RUN -->14<!-- /fq --> / <!-- fq:frozen58.RIGORRUN_MODE_CASES -->26<!-- /fq --> |

### Scoring of RigorRun-mode cases

| Classification | Outcome-aware rule | Original audit rule |
| --- | --- | --- |
| TP | <!-- fq:frozen58.TP -->10<!-- /fq --> | <!-- fq:frozen58.ORIGINAL_RULE.TP -->10<!-- /fq --> |
| TN | <!-- fq:frozen58.TN -->3<!-- /fq --> | <!-- fq:frozen58.ORIGINAL_RULE.TN -->3<!-- /fq --> |
| FP | <!-- fq:frozen58.FP -->0<!-- /fq --> | <!-- fq:frozen58.ORIGINAL_RULE.FP -->1<!-- /fq --> |
| FN | <!-- fq:frozen58.FN -->0<!-- /fq --> | <!-- fq:frozen58.ORIGINAL_RULE.FN -->0<!-- /fq --> |
| ABSTAIN | <!-- fq:frozen58.ABSTAIN -->0<!-- /fq --> | — |
| TIMED_OUT | <!-- fq:frozen58.TIMED_OUT -->1<!-- /fq --> | — |
| HARNESS_FAILURE | <!-- fq:frozen58.HARNESS_FAILURE -->0<!-- /fq --> | — |

The one TIMED_OUT is `SQ-LLM-01-llama3.1-8b`: the oracle said PASS, and RigorRun reached the 60 s budget at 69.0 s. Under the original rule that is the one FP.

Against the previous measurements (AFTER-2 for 44 cases, AFTER-1 for the two local-model cases), no run case changed classification or oracle verdict.

### R-1

- **Cases run:** <!-- fq:frozen58.R1.casesRun -->6<!-- /fq --> of <!-- fq:frozen58.R1.cases -->11<!-- /fq -->.
- **Reproductions:** <!-- fq:frozen58.R1.reproductions -->0<!-- /fq -->.
- **Without a verdict under the strict protocol:** <!-- fq:frozen58.R1.casesWithoutVerdict -->EM-GM-01-correct, EM-GM-03-duplicate, EM-GMA-01-correct, EM-GMA-04-wrong-recipient, EM-GMA-05-wrong-subject<!-- /fq -->.
- **`SQ-LLM-02-qwen2.5-3b`** (not run in AFTER-2): <!-- fq:frozen58.cases.SQ-LLM-02-qwen2.5-3b.attempts -->3<!-- /fq --> attempts, <!-- fq:frozen58.cases.SQ-LLM-02-qwen2.5-3b.outcomeClassification -->TRUE_NEGATIVE<!-- /fq -->.

### Injected failures

<!-- fq:frozen58.INJECTED.reachableAttempts -->0<!-- /fq --> reachable attempts under the strict protocol. The only injected failure RigorRun can reach is `EM-GM-06`, a GreenMail case.

## GreenMail happy-path-only diagnostic (a labelled deviation, not a gate input)

- **What it is:** the 12 cases the strict protocol refused, run from throwaway home copies whose suite keeps only the unchanged `happy_path` case (`evidence/greenmail-happy-path-diagnostic/`).
- **Order correction:** a first pass ran the five accumulate-mode EM-GMA cases out of manifest order, which confounded their oracle. They were re-run in manifest order, and the first pass is kept (see `progress.md`).

| Item | Value |
| --- | --- |
| Cases run | <!-- fq:greenmailHappyPathDiagnostic.CASES_RUN -->12<!-- /fq --> |
| TP / TN / FP / FN | <!-- fq:greenmailHappyPathDiagnostic.TP -->9<!-- /fq --> / <!-- fq:greenmailHappyPathDiagnostic.TN -->2<!-- /fq --> / <!-- fq:greenmailHappyPathDiagnostic.FP -->0<!-- /fq --> / <!-- fq:greenmailHappyPathDiagnostic.FN -->0<!-- /fq --> |
| TIMED_OUT | <!-- fq:greenmailHappyPathDiagnostic.TIMED_OUT -->1<!-- /fq --> (`EM-LLM-01`: the model did not finish, and the oracle said FAIL) |
| R-1 cases run / reproductions | <!-- fq:greenmailHappyPathDiagnostic.R1.casesRun -->5<!-- /fq --> / <!-- fq:greenmailHappyPathDiagnostic.R1.reproductions -->0<!-- /fq --> |
| Injected `EM-GM-06` attempts detected / reachable | <!-- fq:greenmailHappyPathDiagnostic.INJECTED.detectedAttempts -->3<!-- /fq --> / <!-- fq:greenmailHappyPathDiagnostic.INJECTED.reachableAttempts -->3<!-- /fq --> |

No diagnostic case differs from its AFTER-2 or AFTER-1 classification.

## N-1

| Evidence | Result |
| --- | --- |
| EH-WT-03, measured at `54f6e79` (product sources identical to the product commit) | FAIL on 3 of 3 (`remediation/n1/after-fix-final.json`) |
| Worktide held-out v2, measured at `54f6e79` | gate block 11/11, side-channel 3/3; known-good failed 0, known-bad passed 0, abstentions 0 |
| In-process held-out set at the product commit | <!-- fq:heldoutInprocess.matchingExpected -->23<!-- /fq --> of <!-- fq:heldoutInprocess.cases -->23<!-- /fq --> as expected; known-good failed <!-- fq:heldoutInprocess.knownGoodIncorrectlyFailed -->0<!-- /fq -->, known-bad passed <!-- fq:heldoutInprocess.knownBadIncorrectlyPassed -->0<!-- /fq --> |
| Cross-regression: measured regressions in frozen RigorRun-mode cases | <!-- fq:n1.crossRegression.regressions -->0<!-- /fq --> |
| Cross-regression: correct at AFTER-2 and unmeasured now (strict protocol) | <!-- fq:n1.crossRegression.unmeasured -->11<!-- /fq --> |
| Generated suites whose shape changed | <!-- fq:n1.crossRegression.suiteShapeChanges -->2<!-- /fq --> (both GreenMail suites gained a `missing_precondition` case) |
| Identity fields changed | <!-- fq:n1.crossRegression.identityChanges -->6<!-- /fq --> (GreenMail `Record1` count → service; Worktide `Group` minutes → label; Worktide `Record1` totalMinutes → from) |
| An identity that is a value the demonstration changed | <!-- fq:n1.crossRegression.changedValueAsIdentity -->0<!-- /fq --> |
| Duplicate record keys in any recorded final state | <!-- fq:n1.crossRegression.duplicateKeysInFinalState -->0<!-- /fq --> |

Details: `evidence/n1-cross-regression.md`.

## Independent oracle

- **Fixture (`scripts/io/`):** the agent acts through `taskdesk`, a SQLite task store behind an MCP server. RigorRun verifies through `taskdesk-oracle`, a separate process that opens the same database read-only.
- **Freeze:** cases and expectations were frozen before any run (`scripts/io/freeze.json`).
- **Attempts:** 3 per case.

| Case | RigorRun outcome | Label | Oracle | As specified |
| --- | --- | --- | --- | --- |
| IO-1 correct action | <!-- fq:independentOracle.perCase.IO-1.outcomes -->PASS<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-1.labels -->INDEPENDENT<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-1.oracle -->PASS<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-1.allAttemptsMatch -->true<!-- /fq --> |
| IO-2 claims success, no change | <!-- fq:independentOracle.perCase.IO-2.outcomes -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-2.labels -->INDEPENDENT<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-2.oracle -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-2.allAttemptsMatch -->true<!-- /fq --> |
| IO-3 tool says success, wrong state | <!-- fq:independentOracle.perCase.IO-3.outcomes -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-3.labels -->INDEPENDENT<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-3.oracle -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-3.allAttemptsMatch -->true<!-- /fq --> |
| IO-4 duplicate | <!-- fq:independentOracle.perCase.IO-4.outcomes -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-4.labels -->INDEPENDENT<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-4.oracle -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-4.allAttemptsMatch -->true<!-- /fq --> |
| **IO-5 correct task + unrelated change** | <!-- fq:independentOracle.perCase.IO-5.outcomes -->PASS<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-5.labels -->INDEPENDENT<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-5.oracle -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-5.allAttemptsMatch -->false<!-- /fq --> |
| IO-6a verifier lost during the case | <!-- fq:independentOracle.perCase.IO-6a.outcomes -->ABSTAIN<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-6a.labels -->INDEPENDENT<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-6a.oracle -->PASS<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-6a.allAttemptsMatch -->true<!-- /fq --> |
| IO-6b verifier down before the run | <!-- fq:independentOracle.perCase.IO-6b.outcomes -->None<!-- /fq --> (exit 2, no verdict) | <!-- fq:independentOracle.perCase.IO-6b.labels -->None<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-6b.oracle -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-6b.allAttemptsMatch -->true<!-- /fq --> |
| IO-7 connector read lies, independent read disagrees | <!-- fq:independentOracle.perCase.IO-7.outcomes -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7.labels -->INDEPENDENT<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7.oracle -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7.allAttemptsMatch -->true<!-- /fq --> |
| **IO-7-mixed-a** both reads nominated, verifier first | <!-- fq:independentOracle.perCase.IO-7-mixed-a.outcomes -->PASS<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7-mixed-a.labels -->SELF_REPORTED<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7-mixed-a.oracle -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7-mixed-a.allAttemptsMatch -->false<!-- /fq --> |
| IO-7-mixed-b both reads nominated, connector first | <!-- fq:independentOracle.perCase.IO-7-mixed-b.outcomes -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7-mixed-b.labels -->SELF_REPORTED<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7-mixed-b.oracle -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7-mixed-b.allAttemptsMatch -->true<!-- /fq --> |
| IO-6c verifier returns an empty world (diagnostic, must not be PASS) | <!-- fq:independentOracle.perCase.IO-6c.outcomes -->FAIL<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-6c.labels -->INDEPENDENT<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-6c.oracle -->PASS<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-6c.allAttemptsMatch -->true<!-- /fq --> |
| IO-7-self control, no verifier | <!-- fq:independentOracle.perCase.IO-7-self.outcomes -->PASS<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7-self.labels -->SELF_REPORTED<!-- /fq --> | <!-- fq:independentOracle.perCase.IO-7-self.oracle -->FAIL<!-- /fq --> | control |

- **Fallback guard:** in no attempt did RigorRun silently fall back to self-reported evidence. Every PASS on the independent project had its own answered verifier reads, and no agent step reached a verifier tool.
- **Why IO-5 passed:** the recorded final state shows task 2 changed from `open` to `done`, but a job that creates records generates no check that other records are unchanged.
- **Why IO-7-mixed-a passed:** when two nominated reads return the same record, the later read's row replaces the earlier one. The connector's lying row, nominated after the verifier, stood.

## MCP compatibility

Summary of `mcp-compatibility.md`:

- **Preflight checks:** <!-- fq:mcpPreflight.statuses.PASS -->14<!-- /fq --> PASS, <!-- fq:mcpPreflight.statuses.LIMIT -->5<!-- /fq --> LIMIT, <!-- fq:mcpPreflight.statuses.FAIL -->0<!-- /fq --> FAIL.
- **Protocol versions:** RigorRun speaks MCP 2024-10-07 through 2025-11-25 over the `initialize` handshake, on stdio and Streamable HTTP.
- **2026-07-28:** UNSUPPORTED on the client side. A server that speaks only 2026-07-28 is refused at connect, before any case runs.
- **Target servers:**
  - Filesystem MCP: SUPPORTED, measured.
  - GitHub MCP: PARTIAL, a dual-era server according to its source.
  - Playwright MCP: PARTIAL, a legacy server according to its source.
- **Before any upstream attribution:** each audit must meet the preconditions listed in `mcp-compatibility.md` (pagination, stderr, recorded version, verifier reads).

## Full verification at the product commit

| Check | Result |
| --- | --- |
| Unit/integration (`pnpm test`) | <!-- fq:checks.final.test.passed -->1017<!-- /fq --> of <!-- fq:checks.final.test.total -->1017<!-- /fq --> tests, <!-- fq:checks.final.test.files -->92<!-- /fq --> files, failed <!-- fq:checks.final.test.failed -->0<!-- /fq --> |
| e2e (`pnpm e2e`) | <!-- fq:checks.final.e2e.passed -->56<!-- /fq --> passed, <!-- fq:checks.final.e2e.failed -->0<!-- /fq --> failed, <!-- fq:checks.final.e2e.flaky -->0<!-- /fq --> flaky |
| Typecheck | exit <!-- fq:checks.final.typecheck.exit -->0<!-- /fq --> |
| Lint | exit <!-- fq:checks.final.lint.exit -->0<!-- /fq --> on <!-- fq:checks.final.lint.files -->76<!-- /fq --> files, plus all final-qualification scripts (`evidence/final/lint-final-qualification.log`) |

- **Earlier run with a failure:** in Phase 0, <!-- fq:checks.phase0.test.passed -->1007<!-- /fq --> tests passed and <!-- fq:checks.phase0.test.skipped -->10<!-- /fq --> were skipped. The sandbox test file hit the npm registry stalling from this host, passed 10/10 when re-run alone, and passed in full here. Both logs are kept.
- **Evidence hygiene:** 0 machine paths, 0 stored credential values, 0 frozen audit files differing from HEAD. Appends from the direct probes to frozen traces are quarantined in `evidence/frozen-58/baseline-writes/`.

## Release gate

`release-gate.json`, from `scripts/release-gate-final.mjs`:

| Gate | Status |
| --- | --- |
| GATE 1 FROZEN_58_COMPLETE | FAIL |
| GATE 2 R1 | FAIL |
| GATE 3 N1 | FAIL |
| GATE 4 FALSE_POSITIVES (strict) | FAIL |
| GATE 5 FALSE_NEGATIVES | PASS |
| GATE 6 INJECTED_FAILURES | FAIL |
| GATE 7 INDEPENDENT_ORACLE | FAIL |
| GATE 8 ABSTENTION | PASS |
| GATE 9 MCP_COMPAT | PASS |
| GATE 10 TESTS | PASS |
| GATE 11 BENCHMARK_INTEGRITY | PASS |
| GATE 12 NO_TARGET_HACKS | PASS |

**Status: NO_GO.** `public-audit-build.json` was not created.

## Blockers

**1. RigorRun can PASS a known-bad workflow whose error is visible to the verifier** (GATE 7).
- **IO-5:** a correct task plus an unrelated change to an existing record passes. The verifier observed the change, but a job that creates records gets no check that other records are unchanged.
- **IO-7-mixed-a:** when a project nominates both a connector read and a verifier read, the later read overwrites the earlier one's rows. A connector read that misreports state, nominated after the verifier, turns a wrong state into PASS. That run is labelled SELF_REPORTED, never INDEPENDENT.

**2. The frozen 58 cannot be completed under the frozen protocol at the product commit** (GATES 1, 2, 3, 6).
- **Cause:** N-1's corrected identity makes both GreenMail suites generate a second case, so 12 cases, including 5 R-1 cases and the only injected failure RigorRun can reach, have no strict verdict.
- **Diagnostic:** the labelled diagnostic found no regression in them. Their verdicts on the demonstrated job match AFTER-2. That does not satisfy the strict gates.

**3. A known-good slow agent is not graded PASS** (GATE 4, strict).
- `SQ-LLM-01-llama3.1-8b` did the job but took 69.0 s against the unchanged 60 s budget: TIMED_OUT.
- The cause is a limit of the model and the budget, not of host memory. It ran with 7.3 GB available.

## Limits of this qualification

- **Authorship:** one agent wrote the independent-oracle fixture, the preflight servers and this qualification. Expectations were frozen before any run, which does not make the case selection independent.
- **IO scope:** the IO fixture covers one kind of job (creating a record) against one local SQLite service, three attempts each.
- **MCP compatibility:** Filesystem MCP was measured. GitHub MCP and Playwright MCP are compatible according to their pinned sources, not measured here.
- **Evidence reuse:** EH-WT-03 and Worktide v2 were not re-run; their measurements at `54f6e79` are used because product sources are identical to the product commit.
- **Order dependence:** the frozen re-run tooling assumed order never matters. The five accumulate-mode EM-GMA cases depend on EM-GM-07 running before them (see `progress.md`).

## Reproduce

```
node reports/public-mcp-audit-2026-09/final-qualification/scripts/product-under-test.mjs --check
bash reports/public-mcp-audit-2026-09/final-qualification/scripts/run-frozen-58.sh init|stacks|setup|batch <label> <group>
bash reports/public-mcp-audit-2026-09/final-qualification/scripts/run-local-model.sh <case> <model> <min-available-MiB>
python3 reports/public-mcp-audit-2026-09/final-qualification/scripts/greenmail-happy-path-diagnostic.py prepare|run <cases>
python3 reports/public-mcp-audit-2026-09/final-qualification/scripts/io/run-io.py setup|run|aggregate
node_modules/.bin/tsx reports/public-mcp-audit-2026-09/final-qualification/scripts/mcp/mcp-preflight.ts
bash reports/public-mcp-audit-2026-09/final-qualification/scripts/run-heldout-inprocess.sh
bash reports/public-mcp-audit-2026-09/final-qualification/scripts/final-verification.sh all
node reports/public-mcp-audit-2026-09/final-qualification/scripts/aggregate-final.mjs && node reports/public-mcp-audit-2026-09/final-qualification/scripts/n1-cross-regression.mjs && node reports/public-mcp-audit-2026-09/final-qualification/scripts/aggregate-final.mjs
node reports/public-mcp-audit-2026-09/final-qualification/scripts/release-gate-final.mjs
```
