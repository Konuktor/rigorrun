# Master remediation plan — RigorRun findings R-1 … R-8

Baseline: `baseline-manifest.json` / `baseline-summary.md` (frozen 2026-09-14, RigorRun 0.2.0 at `07dda8c`). Every root cause below was re-verified by reading the code, not taken from `findings.md`. Progress per phase is in `progress.md`.

## State semantics (the vocabulary every fix below uses)

| Name | Meaning | Where it lives after remediation |
| --- | --- | --- |
| DEMONSTRATION_STATE | the world before/after a person did the job once | `trace.before` / `trace.after`; compile only |
| CASE_INITIAL_STATE | the world a case starts from: installed by `seed()` when the adapter can seed, otherwise **observed freshly at case start** after `reset()` | `CaseResult.initialStateHash`, `CaseResult.baseline` |
| EXPECTED_FINAL_STATE | CASE_INITIAL_STATE + the demonstrated delta (N focus rows created/changed, request-bound field values) | contract `expectedDeltaCount` + `argumentBindings`; case `checks` |
| ACTUAL_FINAL_STATE | the world observed after the agent finished | `CaseResult.finalStateHash` |

A verdict compares EXPECTED with ACTUAL and carries `outcome`, `verification`, `outcomeReason`, `missingEvidence`. When the evidence cannot decide, the outcome is ABSTAIN, never PASS or FAIL.

## Dependency graph and execution order

```
P0 freeze benchmark
P1 R-8 normalisation layer ──┐  R-3 tagged scalars + entity dedupe (same layer)
P2 R-1 runtime baseline ─────┼─ R-4 outcome classification / abstention (needs P1 for state reads)
P3 R-1 expected-delta checks ┘  R-5 step-level change detection + goal (needs P2 types)
P4 R-4 budgets + retry matrix (needs P2 outcomes)
P5 quality-on-verdict, R-7, R-2 (needs P1 connection layer), R-6 (needs everything the CLI drives)
P6 audit tooling + full re-run (needs P1–P5)
P7 held-out set (built after P1–P5), final gate, docs
```

Numeric order is not dependency order: R-8 and R-3 come first because every later fix reads state through them; R-1 has a runtime half (P2) and a compile half (P3).

---

## R-1 — Stale generation-time baseline for connectors that cannot seed

- **SEVERITY:** HIGH (P0)
- **SYMPTOM:** a correct agent fails (`derived.created.<E> is absent`), a duplicate / wrong-value / wrong-entity / drifted world passes. 11 baseline cases (6 FP-side, 10 FN-side overlap).
- **ROOT CAUSE:** `packages/runner/src/run.ts:166-176` uses `testCase.seed.state` (captured by `Service.registerFor` at generation, after a reset, i.e. DEMONSTRATION-era state) as the projection baseline for `seed:'none'` adapters and never observes the world at case start. `generator/src/counterfactual.ts:189-205 projectionKeys` has the same assumption. Second half: `counterfactual.ts:268-324 successChecks` emits only `state_exists derived.created.<E>[...]`; `compiler/src/synthesize.ts:378 literal()` refuses any value with a space so the filter collapsed to the bare collection; nothing checks the *number* created or the *values*.
- **AFFECTED CODE:** runner `executeCase`; generator `projectionKeys`, `successChecks`; compiler `induceContract` (bindings), `literal`; verifier `path.ts`; core `environmentContract.ts`, `run.ts`.
- **AFFECTED PRODUCT BEHAVIOUR:** every verdict against a real MCP/OpenAPI system (all of them declare `seed:'none'`).
- **DEPENDENCIES:** P1 (state must be readable for JSON-in-text servers before a fresh read is meaningful); P2 types for `baseline`/`outcome`.
- **PROPOSED FIX:** (runtime) after `reset()`, when the adapter cannot seed, `initialState = await adapter.getState()`; project against it; record `baseline: 'OBSERVED_AT_START'` and `initialStateHash`. (compile) observe from the demonstration the created/changed count of the focus entity and the argument→field bindings (equality, field-contains-argument, argument-contains-field); generate `success__performed` with a value filter and `success__exactly_as_demonstrated` with the count; extend the path language with quoted literals and `~=`.
- **ALTERNATIVES CONSIDERED:** (a) refuse to grade `seed:'none'` projects without a reset — honest but removes the product's main use; (b) re-read the fixture state at run start and rewrite `seed.state` — same as the fix but hides the provenance; (c) timestamps to find "new" rows — not available generically.
- **WHY THIS FIX:** it is the only one that measures the case's own delta with the evidence the connector actually gives, and it records which baseline was used.
- **REGRESSION TESTS:** `packages/runner/test/baseline.test.ts`, `packages/runner/test/honesty.test.ts`, `packages/generator/test/expectedDelta.test.ts`, `packages/verifier/test/path.test.ts` additions, updates to `env-mcp/test/endToEnd.test.ts`.
- **BENCHMARK CASES EXPECTED TO CHANGE:** the 11 R-1 cases; the 5 known-good FPs → PASS, the 10 FNs → FAIL.
- **RISKS:** the count check tightens suites (a correct agent creating a different number of focus rows fails — that is the demonstrated semantics); bindings on short/common values could over-constrain (guarded: id field excluded, strings ≥ 3 chars, whole-token match).
- **ROLLBACK:** revert the runner commit and the compiler/generator commit independently; old benchmark files keep working because the new checks are only generated on rebuild.
- **DEFINITION OF DONE:** baseline tests fail on HEAD and pass after; re-run shows 0 R-1 reproductions on the 11 cases; FP = 0 on known-good cases.

## R-2 — No independent oracle

- **SEVERITY:** HIGH (product gap; P5)
- **SYMPTOM:** verdicts rest on reads through the same connection the agent used; a broken or lossy read (E-1, recipient absent from `check_inbox`) is invisible.
- **ROOT CAUSE:** `daemon/src/project.ts` only allows `verifier` on `BrowserConnectorSchema`; `workspace.openConnection` opens one connection per project; no verdict field says where the evidence came from.
- **AFFECTED CODE:** `daemon/src/project.ts`, `daemon/src/workspace.ts`, `connector/src/environment.ts`, core `run.ts`.
- **DEPENDENCIES:** P1 (normalised results on any connection).
- **PROPOSED FIX:** allow `verifier` (MCP/OpenAPI, nullable) on MCP and OpenAPI connectors; open both; expose the verifier's tools as `verifier:<tool>` on a composite `SystemConnection`; nominated reads may target them; label every case `evidenceIndependence: INDEPENDENT | SELF_REPORTED | NONE`.
- **ALTERNATIVES:** a full second engine per connector (rejected: the file header of `environment.ts` explains why one adapter exists); an external oracle script hook (rejected for now: reads should stay inside the connector model so the same verifier runs them).
- **WHY:** smallest change that lets a project verify through something the agent never touched, with the label the report needs.
- **TESTS:** `packages/daemon/test/independentVerifier.test.ts` (two venue-desk processes over one state file).
- **CASES EXPECTED TO CHANGE:** none in the frozen benchmark (the re-run keeps the original single-connector setup for apples-to-apples); a held-out variant uses it.
- **RISKS:** tool-name collisions (avoided by the `verifier:` prefix); secrets for two connectors (derived by `secretNamesOf`).
- **ROLLBACK:** revert the daemon commit; projects without `verifier` are unaffected.
- **DONE:** test passes; a project with a verifier reports INDEPENDENT.

## R-3 — Column-cell result shapes induce a value-keyed entity

- **SEVERITY:** MEDIUM (P1)
- **SYMPTOM:** sqlite rows `{rows:[{columns:{id:{kind,value},…}}]}` induce an `Id` entity keyed by `value`; no row entity; quality gate reports the suite cannot discriminate.
- **ROOT CAUSE:** `mcp/src/induceSchema.ts:116 isRecordLike` and `connector/src/rows.ts looksLike` treat a `{kind,value}` cell as a two-field record. Also `entityNameFrom` does not dedupe names (two reads with the same wrapper name collide into one entity).
- **AFFECTED CODE:** `connector/src/result.ts` (new `canonicalisePayload`), `connector/src/rows.ts`, `mcp/src/induceSchema.ts`.
- **DEPENDENCIES:** none (goes in with P1).
- **PROPOSED FIX:** a generic tagged-scalar unwrap (`{kind|type: string, value: scalar|null}` with exactly those keys) applied before induction and row extraction; a list entry that is a single-key wrapper around a record keeps the list's container name; dedupe entity names.
- **ALTERNATIVES:** teach the operator to answer the schema questions differently (impossible: the rows never became candidates); a sqlite-specific shape rule (rejected: target-specific).
- **WHY:** tagged scalars are a common serialisation (serde enums, typed cells); unwrapping only the exact two-key shape cannot swallow a real record.
- **TESTS:** `packages/connector/test/rows.test.ts`, `packages/mcp/test/induce.test.ts` additions.
- **CASES EXPECTED TO CHANGE:** every sqlite RigorRun-mode case (needed for R-1 fixes to bite there).
- **RISKS:** a genuine two-field record named `{kind,value}` would be unwrapped (accepted; it would have been a record with no identifier anyway).
- **ROLLBACK:** revert the P1 commit.
- **DONE:** sqlite-shaped payload induces one row entity keyed by `id`; W1/W1b journeys build a discriminating suite.

## R-4 — Fixed 15 s case budget below the 20 s tool timeout; timeouts indistinguishable from failures

- **SEVERITY:** MEDIUM (P1/P2; classification part is P0-adjacent)
- **SYMPTOM:** an injected lost response (20 s client timeout) cannot fit in a 15 s case; slow local models never finish; a timeout is recorded as `errored:true`, `taskSuccess:false`, `policyCompliant:true`.
- **ROOT CAUSE:** `counterfactual.ts:258`, `core/src/benchmark.ts:108` (15 000), `mcp/src/client.ts:41` (20 000), nothing configurable; `run.ts:350-365` plain `Error`; `run.ts:313-316` conflates timeout / agent crash / harness crash / verification failure.
- **AFFECTED CODE:** core `run.ts`, `benchmark.ts`, `versions`; runner; scoring; report; cli; daemon (`project.ts` budgets, `service.ts runAgent`, `processAgent`/`httpAgent` timeouts); connector config → connection call timeout.
- **DEPENDENCIES:** P2 outcome types.
- **PROPOSED FIX:** outcome classes `PASS | FAIL | ABSTAIN | TIMED_OUT | AGENT_FAILURE | HARNESS_FAILURE`; typed `AgentTimeoutError`; project `budgets {toolCallMs 20 000, caseMs 60 000}` validated `caseMs ≥ toolCallMs + 5 000`; `DEFAULT_CASE_TIMEOUT_MS = 60 000`; CLI `--case-timeout`; agent process timeout derived from the case budget so the runner's budget fires first.
- **ALTERNATIVES:** bump 15 → 60 only (rejected: the classification bug remains and nothing is configurable).
- **WHY:** the budget hierarchy becomes explicit and ordered (tool < case < agent process), and a timeout stops masquerading as a wrong answer.
- **TESTS:** `packages/runner/test/outcomes.test.ts`, `packages/runner/test/retry.test.ts`, cli flag tests, daemon budget validation test.
- **CASES EXPECTED TO CHANGE:** `EM-GM-06` (retry now completes → oracle FAIL, RigorRun FAIL expected), `SQ-LLM-01`, `EM-LLM-01` (may now finish).
- **RISKS:** longer worst-case suite duration (bounded by budget × cases).
- **ROLLBACK:** revert the budgets commit; defaults fall back to the schema.
- **DONE:** timeout reproduction (`retry.test.ts` budget invariant) passes; `EM-GM-06` reaches the retry in the re-run.

## R-5 — Instruction from the tool description; dual-purpose tool's last call becomes the primary action

- **SEVERITY:** LOW (P3)
- **SYMPTOM:** the agent is told "Marker type for the execute tool…"; W1's case inputs were the read-back SELECT.
- **ROOT CAUSE:** `compiler/src/induce.ts:292 goalStatement` never sees the project goal; `resolvePrimaryAction`/`demonstratedArgs`/`service.ts firstActionArgs` operate on action names, and the demonstration records no per-step "did this change anything".
- **AFFECTED CODE:** `daemon/src/workspace.ts demonstrate`, `daemon/src/service.ts compile/finishTeaching/firstActionArgs`, `core/src/canonicalTrace.ts`, `core/src/traceNormalize.ts`, `compiler/src/induce.ts`.
- **DEPENDENCIES:** P1 (reads normalised so the per-step comparison sees records).
- **PROPOSED FIX:** read the nominated reads before and after every demonstrated call to a tool not in `readOnlyTools`; record `changed` on the entry and `changedState` on the trace step; primary action and its arguments come from the last step that changed state; `induceContract` takes the project goal and falls back to the description only when none was given.
- **ALTERNATIVES:** ask the operator which call was "the job" (rejected: another question for something the evidence already shows).
- **WHY:** the compiler already trusts the delta over names; this extends that to steps.
- **TESTS:** `packages/daemon/test/stepChange.test.ts`, `packages/compiler/test/induce.test.ts` additions.
- **CASES EXPECTED TO CHANGE:** W1 journey inputs (affects `SQ-W1-*` instructions; LLM cases).
- **RISKS:** more reads during a demonstration (bounded by steps × nominated reads).
- **ROLLBACK:** revert the daemon/compiler commit; traces without `changedState` behave as before.
- **DONE:** dual-purpose test passes; W1 setup trace shows the INSERT as primary with its arguments.

## R-6 — No headless project setup

- **SEVERITY:** LOW (P5)
- **SYMPTOM:** CI can run and gate but cannot create the project it gates; the audit had to drive the HTTP API.
- **ROOT CAUSE:** documented gap (`docs/V1_GAP_AUDIT.md`).
- **AFFECTED CODE:** `packages/cli/src/project.ts`, `main.ts`, `help.ts`; daemon `Service` (no change expected).
- **DEPENDENCIES:** P1–P4 (so the command drives the fixed pipeline).
- **PROPOSED FIX:** `rigorrun project setup <spec.json> --home <dir>` driving `Service` in-process using the journey spec shape; prints the project id.
- **ALTERNATIVES:** a CLI wrapper around the HTTP API (rejected: needs a running runner and a pairing code).
- **WHY:** the Service is already the interface's backend; a spec file is what CI can commit.
- **TESTS:** `packages/daemon/test/headlessSetup.test.ts` or `packages/cli/test/setup.test.ts` against venue-desk.
- **CASES EXPECTED TO CHANGE:** none (re-run keeps `journey.mjs` for apples-to-apples).
- **RISKS:** a spec with secrets in it (the spec names env vars, never values — same as journey.mjs).
- **ROLLBACK:** remove the command.
- **DONE:** test passes; `docs/V1_GAP_AUDIT.md` updated.

## R-7 — `verify --needs-credential` documented but not wired

- **SEVERITY:** INFO (P5)
- **SYMPTOM:** flag rejected by `parseArgs`; verify accepts only Node servers.
- **ROOT CAUSE:** `cli/src/main.ts` options and `cli/src/verify.ts VerifyFlags` omit it; `sandbox/src/verify.ts:60` already accepts it.
- **PROPOSED FIX:** parse the repeatable flag and pass it through; help text. The Node-only base image (`sandbox/src/stage.ts:36`) is documented as an unresolved product gap, out of scope.
- **TESTS:** cli parse test.
- **DONE:** `rigorrun verify … --needs-credential sync` reaches the planner as NEEDS_CREDENTIAL.

## R-8 — JSON-in-text passes the read probe but yields no records at demonstration

- **SEVERITY:** HIGH (P0, P1)
- **SYMPTOM:** Worktide (all results `content:[{type:'text',text:'<json>'}]`, no `structuredContent`) passes `probeVerifierReads`, then compile refuses: "The reads nominated for verification returned text rather than structured records".
- **ROOT CAUSE:** `daemon/src/service.ts:314` hands the raw content-block array to `induceSchema`, whose `isRecordLike` accepts `{type,text}` (two scalars) → the probe sees "records"; `workspace.ts:364,416` and `connector/src/environment.ts:177` read `structured` only. No product path parses JSON text; the only correct normaliser in the repo is a test fixture (`fixtures/external/booking-agent/src/agent.ts:84-95`, unguarded).
- **AFFECTED CODE:** new `connector/src/result.ts`; `service.ts`, `workspace.ts`, `connector/src/environment.ts`, `mcp/src/induceSchema.ts`, `mcp/test/thirdParty.test.ts`.
- **DEPENDENCIES:** none — first.
- **PROPOSED FIX:** one `normalizeCallResult` with kinds `structured | json_text | text | empty | error`; JSON text is accepted only with an object/array top level; prose is never reinterpreted; every interpreter (discovery probe, demonstration capture, compile inputs, runtime reads, action results) uses it.
- **ALTERNATIVES:** make `induceSchema` skip `{type,text}` (rejected: vocabulary-specific and leaves capture broken); parse text everywhere ad hoc (rejected: the inconsistency is the bug).
- **WHY:** one canonical layer at the lowest package that owns `CallResult`.
- **TESTS:** `packages/connector/test/result.test.ts` corpus; `packages/daemon/test/jsonInText.test.ts` end-to-end; prose server warns before teaching.
- **CASES EXPECTED TO CHANGE:** Worktide W2/W3 journeys (compile proceeds); email/sqlite unchanged (they publish `structuredContent`).
- **RISKS:** a server whose text happens to be JSON prose of unrelated shape would now induce entities (acceptable: it is structured data).
- **ROLLBACK:** revert P1.
- **DONE:** the daemon test reproduces the exact refusal on HEAD and passes after; Worktide reaches compile in the re-run.

## Cross-cutting: abstention and evidence honesty (P2)

Outcome `ABSTAIN` with `missingEvidence` when `stateRead === 'none'`, when a nominated read fails at case start or end, or when no success check is applicable; `UNVERIFIABLE` assertion status; ABSTAIN/HARNESS_FAILURE excluded from the success denominator and gated as "inconclusive" (exit code 3, reusing the `verify` contract); quality-gate warnings carried on the run (`suiteQuality`, `limits: suite_quality_unassessed`). Tests: `packages/runner/test/honesty.test.ts` (both directions, nearby mirror cases), scoring/cli tests.

## Layer A / Layer B

- **Layer A (CI, `pnpm test`):** the new test files above; in-process fixtures and the venue-desk fixture with a result-shape toggle; no public services.
- **Layer B (`reports/public-mcp-audit-2026-09/remediation/scripts/rerun.sh`):** teardown → recreate the three stacks at the pinned commits → journey setups → `run-cases.py` with the manifest's attempt counts → `aggregate-after.mjs`. Environment-dependent, never part of `pnpm test`.

## P8 — added after AFTER-1: deletions held to the demonstration

- **ID:** P8 (regression in the R-1 fix; found by the Layer B re-run, not by a finding's reproduction)
- **SEVERITY:** HIGH (a destructive side effect passes)
- **SYMPTOM:** `SQ-W1-06-forbidden-extra-delete` and `SQ-W1B-06-forbidden-extra-delete` insert the requested row and delete another; TRUE_POSITIVE at the baseline, FALSE_NEGATIVE on all six AFTER-1 attempts.
- **ROOT CAUSE:** P3 implemented EXPECTED_FINAL_STATE = CASE_INITIAL_STATE + the demonstrated delta for creations (values, count) and changes (identifier, count) of the focus entity, but not for deletions. The baseline's detection was an artefact of R-1.
- **AFFECTED CODE:** `packages/core/src/environmentContract.ts`, `packages/compiler/src/induce.ts`, `packages/generator/src/counterfactual.ts`.
- **DEPENDENCIES:** P3.
- **PROPOSED FIX:** observe `expectedDeletedCount` for the focus entity from the demonstration's deltas; generate `success__nothing_else_deleted`: `derived.deleted.<Entity>.length` equals it.
- **ALTERNATIVES CONSIDERED:** (a) every observed entity's created, changed and deleted counts exactly as demonstrated. Rejected for now: reads that flip flags or counters (a message marked read by the read itself), paged listings and system-maintained records would fail correct agents, and none of that can be ruled out from one demonstration. (b) A review-time "must not delete" rule. Rejected: the spec's operator confirmed no rules, and a deletion is visible in the delta without asking.
- **WHY THIS FIX:** the smallest change that makes the state semantics the plan already defined true for deletions, with the lowest false-positive exposure.
- **REGRESSION TESTS:** `packages/runner/test/expectedDelta.test.ts`, "records the job never deletes" (written first; failed on the unchanged code).
- **BENCHMARK CASES EXPECTED TO CHANGE:** `SQ-W1-06`, `SQ-W1B-06` back to TRUE_POSITIVE. No other frozen case deletes a focus record.
- **RISKS:** a newest-N read that is already full; an unrequested change to another record stays undetected; which record a demonstrated deletion removed is not bound.
- **ROLLBACK:** revert `65bbaed`; contracts compiled before it carry no `expectedDeletedCount`, and the check is not generated for them.
- **DEFINITION OF DONE:** new tests pass; full suite, typecheck and lint clean; the repro harness still shows the 10 original defects absent; the full re-run (AFTER-2) at the fixed commit detects both cases, with every gate evaluated from its evidence.
