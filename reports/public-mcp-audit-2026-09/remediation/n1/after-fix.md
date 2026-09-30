# N-1 / EH-WT-03 after the fix

Every marked number below is read from `results.json`, which `scripts/aggregate-n1.mjs` generates from the evidence and checks against this page. The reproduction before the fix is `before-fix.md`; the design and its three amendments are `design.md`.

## What changed in the product

The fix is generic. No target, field name, case or benchmark value appears in production code; `release-gate.mjs` scans for them.

| Layer | Change | Where |
| --- | --- | --- |
| Identity | Readings of the same nominated read, before and after the job, are compared. A field that changed for the same record, or adds up to a total, is a value, never the identity. The identity is one stable field, else the smallest set of stable fields (null a value), else `identity: 'unestablished'`. | `packages/mcp/src/induceSchema.ts` (`changedFields`, `noteTotals`, `chooseIdentity`); `packages/daemon/src/workspace.ts` labels the readings |
| Record key | `recordKey` is the one place a row's key is computed. The projection matches rows by table key. Two different rows sharing an identity in one answer abstain, rather than one silently replacing the other. | `packages/environment/src/state.ts`, `projection.ts`; `packages/connector/src/rows.ts`, `environment.ts` |
| Expected change | The contract records how each changed focus record changed (`expectedChanges`) and how many focus records a changing job created (`expectedCreatedCount`). | `packages/core/src/environmentContract.ts`; `packages/compiler/src/induce.ts` |
| Comparison | `state_change` compares the record now with the same record at case start. It fails a demonstrated start that ends elsewhere, and abstains where one demonstration cannot say what the job does. | `packages/core/src/assertion.ts`; `packages/verifier/src/evaluate.ts` |
| Checks | `success__as_demonstrated__<n>` and `success__nothing_else_created` | `packages/generator/src/counterfactual.ts` |

## EH-WT-03, final measurement

The case is the frozen held-out definition (`../heldout/external/cases.json`: agent `wt-w2-duplicate`, a 150 s budget, the oracle's `expect`), run by the frozen runner's own `run_case`. W2 was re-created at the final product sources through the unchanged audit tooling (`final/traces/worktide-mcp/w2-setup/`). Every run reset Worktide to the seeded snapshot first.

Commit measured: <!-- n1:commit -->54f6e79f016a4297c7ec1d3c43866ef17b0b9500<!-- /n1 -->.

**What the re-created suite knows** (`final/traces/worktide-mcp/w2-setup/`):
- **Identity:** a Group is named by `label`.
- **Contract:** the job changes records; one Group changed and none deleted, and <!-- n1:EXPECTED_CREATED -->0<!-- /n1 --> Groups created.
- **Demonstrated change:** `minutes` <!-- n1:EXPECTED_CHANGES.minutes.from -->0<!-- /n1 --> → <!-- n1:EXPECTED_CHANGES.minutes.to -->1<!-- /n1 -->, and `billableMinutes` <!-- n1:EXPECTED_CHANGES.billableMinutes.from -->0<!-- /n1 --> → <!-- n1:EXPECTED_CHANGES.billableMinutes.to -->1<!-- /n1 -->, both compared as quantities.

| Run | RigorRun | Oracle | Time entries | Unassigned minutes (oracle) | Unassigned group in the final projection | Identity | Minutes check | Created check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | <!-- n1:ATTEMPTS.final.EH-WT-03#1.actual -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#1.oracle -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#1.entriesBefore -->10<!-- /n1 --> → <!-- n1:ATTEMPTS.final.EH-WT-03#1.entriesAfter -->12<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#1.unassignedBefore -->0<!-- /n1 --> → <!-- n1:ATTEMPTS.final.EH-WT-03#1.unassignedAfter -->2<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#1.projectedUnassigned -->2<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#1.identity -->label<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#1.minutesCheck -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#1.createdCheck -->PASS<!-- /n1 --> |
| 2 | <!-- n1:ATTEMPTS.final.EH-WT-03#2.actual -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#2.oracle -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#2.entriesBefore -->10<!-- /n1 --> → <!-- n1:ATTEMPTS.final.EH-WT-03#2.entriesAfter -->12<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#2.unassignedBefore -->0<!-- /n1 --> → <!-- n1:ATTEMPTS.final.EH-WT-03#2.unassignedAfter -->2<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#2.projectedUnassigned -->2<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#2.identity -->label<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#2.minutesCheck -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#2.createdCheck -->PASS<!-- /n1 --> |
| 3 | <!-- n1:ATTEMPTS.final.EH-WT-03#3.actual -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#3.oracle -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#3.entriesBefore -->10<!-- /n1 --> → <!-- n1:ATTEMPTS.final.EH-WT-03#3.entriesAfter -->12<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#3.unassignedBefore -->0<!-- /n1 --> → <!-- n1:ATTEMPTS.final.EH-WT-03#3.unassignedAfter -->2<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#3.projectedUnassigned -->2<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#3.identity -->label<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#3.minutesCheck -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.final.EH-WT-03#3.createdCheck -->PASS<!-- /n1 --> |

**The FAIL reason**, as recorded in each failing run (`after-fix-final.json`): "expected minutes 0 → 1 (+1); observed minutes 0 → 2 (+2)", together with the same for `billableMinutes`.

In <!-- n1:EH_WT_03.duplicateStaged -->3<!-- /n1 --> of <!-- n1:EH_WT_03.attempts -->3<!-- /n1 --> runs the duplicate was actually staged, and <!-- n1:EH_WT_03.pass -->0<!-- /n1 --> passed.

**Sanity cases at the same product sources.** They are not evidence of generalisation, because this set is no longer held out for Worktide:
- EH-WT-01 (correct): <!-- n1:ATTEMPTS.final.EH-WT-01#1.actual -->PASS<!-- /n1 --> (oracle <!-- n1:ATTEMPTS.final.EH-WT-01#1.oracle -->PASS<!-- /n1 -->; unassigned minutes <!-- n1:ATTEMPTS.final.EH-WT-01#1.unassignedBefore -->0<!-- /n1 --> → <!-- n1:ATTEMPTS.final.EH-WT-01#1.unassignedAfter -->1<!-- /n1 -->).
- EH-WT-02 (timer left running): <!-- n1:ATTEMPTS.final.EH-WT-02#1.actual -->FAIL<!-- /n1 --> (oracle <!-- n1:ATTEMPTS.final.EH-WT-02#1.oracle -->FAIL<!-- /n1 -->).

## The first measurement, kept

This measurement was taken before amendment 3 (the creation check), at commit <!-- n1:FIRST_MEASUREMENT.commit -->f1ad84152d836be20e0684598f37fea9a6dfc07c<!-- /n1 -->. It is kept because it includes a run the host starved. In `after-fix.json`, EH-WT-03 ran <!-- n1:FIRST_MEASUREMENT.EH_WT_03.attempts -->4<!-- /n1 --> times: <!-- n1:FIRST_MEASUREMENT.EH_WT_03.fail -->3<!-- /n1 --> FAIL and <!-- n1:FIRST_MEASUREMENT.EH_WT_03.timedOut -->1<!-- /n1 --> TIMED_OUT.

| Run | RigorRun | Oracle | Unassigned minutes (oracle) |
| --- | --- | --- | --- |
| 1 | <!-- n1:ATTEMPTS.first.EH-WT-03#1.actual -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.first.EH-WT-03#1.oracle -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.first.EH-WT-03#1.unassignedBefore -->0<!-- /n1 --> → <!-- n1:ATTEMPTS.first.EH-WT-03#1.unassignedAfter -->2<!-- /n1 --> |
| 2 | <!-- n1:ATTEMPTS.first.EH-WT-03#2.actual -->TIMED_OUT<!-- /n1 --> | <!-- n1:ATTEMPTS.first.EH-WT-03#2.oracle -->PASS<!-- /n1 --> | <!-- n1:ATTEMPTS.first.EH-WT-03#2.unassignedBefore -->0<!-- /n1 --> → <!-- n1:ATTEMPTS.first.EH-WT-03#2.unassignedAfter -->1<!-- /n1 --> |
| 3 | <!-- n1:ATTEMPTS.first.EH-WT-03#3.actual -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.first.EH-WT-03#3.oracle -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.first.EH-WT-03#3.unassignedBefore -->0<!-- /n1 --> → <!-- n1:ATTEMPTS.first.EH-WT-03#3.unassignedAfter -->2<!-- /n1 --> |
| 4 | <!-- n1:ATTEMPTS.first.EH-WT-03#4.actual -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.first.EH-WT-03#4.oracle -->FAIL<!-- /n1 --> | <!-- n1:ATTEMPTS.first.EH-WT-03#4.unassignedBefore -->0<!-- /n1 --> → <!-- n1:ATTEMPTS.first.EH-WT-03#4.unassignedAfter -->2<!-- /n1 --> |

**Run 2 is not a reproduction of the duplicate.**
- **What happened:** the host had about 550 MB of memory left and a load average near 11. The target's second `time.start` returned "MCP error -32001: Request timed out" 116.9 s into the case, and the agent ran out of its budget. Only one entry was ever created, so the oracle judged the world correct.
- **What RigorRun did:** its checks passed that world, and it reported TIMED_OUT rather than a verdict.
- **Handling:** the run is kept, not discarded, and a fourth run was taken so that three runs completed.

## The frozen artefacts, replayed in-process

`repro/eh-wt-03.repro.test.ts` rebuilds the case's worlds from the frozen W2 project (hash-identical to the recorded run) and replays the production projection and verifier.

- **Before the fix** (`evidence/repro-before-fix.json`): the frozen checks PASS, and re-inducing the demonstration names a Group by `minutes`.
- **After the fix** (`evidence/repro-after-fix.json`): the frozen checks still PASS, because they encode the old identity. Re-inducing the same demonstration now names a Group by `label`, and the report header by `from`. The identity question says that `minutes` and `billableMinutes` changed between the readings and add up to a total.

## What this does not show

- **Generalisation.** EH-WT-03 exposed the defect and shaped the fix, so these runs only show that it is gone. Generalisation evidence is the frozen v2 set: `../heldout-worktide-v2/README.md`, with results in `../heldout-worktide-v2/results.json`.
- **Split contributions.** Two entries adding up to the demonstrated minutes are invisible in a report of totals, and RigorRun passes a correct aggregate delta. This is disclosed as limit probe V2-L-01.
- **Timing-dependent measures.** A timer measured in whole minutes depends on how long the agent took; a much slower correct agent can fail (`design.md`, false-positive risks).
