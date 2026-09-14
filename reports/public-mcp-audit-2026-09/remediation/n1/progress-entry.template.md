
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
  - **On unchanged product code:** {{n1:TESTS_BEFORE_FIX.failed}} failed and {{n1:TESTS_BEFORE_FIX.passed}} passed (`n1/evidence/tests-before-fix.log`).
  - **The creation regression** was recorded failing on its own (`n1/evidence/tests-before-created-check.log`).
- **TEST RESULTS:**
  - Full suite at the final product sources: {{n1:TESTS.passed}} of {{n1:TESTS.total}} in {{n1:TESTS.files}} files (`n1/evidence/full-test.log`).
  - `pnpm typecheck` is clean, and ESLint is clean on every TypeScript file N-1 changed.
  - In-process held-out set re-run at the N-1 commit: {{n1:INPROCESS.matchingExpected}} of {{n1:INPROCESS.cases}} as expected.
- **ENVIRONMENT ISSUE DURING TESTING:** four browser tests failed once because the host's Playwright Chromium download had disappeared from `~/.cache/ms-playwright`. The same tests passed in the earlier final run. `pnpm e2e:install` restored the browser, and they pass; no code was involved.
- **EH-WT-03 AFTER THE FIX** (`n1/after-fix.md`): the frozen case, run by the frozen runner, against W2 re-created at the final product sources.
  - **Final measurement:** {{n1:EH_WT_03.fail}} of {{n1:EH_WT_03.attempts}} runs FAIL, and {{n1:EH_WT_03.pass}} PASS. In each run the oracle confirmed unassigned minutes 0 → 2, against a demonstrated {{n1:EXPECTED_CHANGES.minutes.from}} → {{n1:EXPECTED_CHANGES.minutes.to}}.
  - **Sanity:** EH-WT-01 {{n1:ATTEMPTS.final.EH-WT-01#1.actual}}, EH-WT-02 {{n1:ATTEMPTS.final.EH-WT-02#1.actual}}.
  - **First measurement** (before amendment 3): {{n1:FIRST_MEASUREMENT.EH_WT_03.fail}} FAIL and {{n1:FIRST_MEASUREMENT.EH_WT_03.timedOut}} TIMED_OUT.
- **HOST NOTE:** that TIMED_OUT came from memory exhaustion. The target's call timed out, the duplicate was never staged, and the oracle said PASS. The run is kept. When the user was asked, they pointed to free space; it was disk, not memory. Memory recovered, and the external work resumed in foreground batches.
- **WORKTIDE V2 HELD-OUT** (`heldout-worktide-v2/`):
  - **Design:** {{n1:V2.defined}} cases on three new journeys, with {{n1:V2.knownGood}} known-good and {{n1:V2.knownBad}} known-bad.
  - **Freeze:** definitions committed and hashed at {{n1:V2.frozenAt}} before any case ran.
  - **Target facts:** from a Worktide-only probe.
  - **Structure:** decided with the user — a gate block of MCP-only behaviour, a separately reported side-channel block, and disclosed limit probes.
  - **Measured at {{n1:V2.commit}}:**
    - **Gate:** {{n1:V2.gate.run}} of {{n1:V2.gate.defined}} run; known-good failed {{n1:V2.gate.knownGoodIncorrectlyFailed}}, known-bad passed {{n1:V2.gate.knownBadIncorrectlyPassed}}, abstentions {{n1:V2.gate.abstentions}}, timed out {{n1:V2.gate.timedOut}}.
    - **Side channel:** {{n1:V2.sideChannel.run}} of {{n1:V2.sideChannel.defined}} run; known-good failed {{n1:V2.sideChannel.knownGoodIncorrectlyFailed}}, known-bad passed {{n1:V2.sideChannel.knownBadIncorrectlyPassed}}.
    - **Limit probes:** {{n1:V2.limitProbe.run}} of {{n1:V2.limitProbe.defined}} run; known-bad passed there {{n1:V2.limitProbe.knownBadIncorrectlyPassed}}.
- **CORRECTION:** the freeze commit's message says 25 files. `freeze.json` hashes 21, and it is the record.
- **STATUS:** see `open-regressions.json` (N-1) and `release-gate.json`.
