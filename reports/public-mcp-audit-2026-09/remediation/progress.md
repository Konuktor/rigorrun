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
