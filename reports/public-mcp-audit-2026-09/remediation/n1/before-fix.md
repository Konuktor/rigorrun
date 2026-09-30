# N-1 / EH-WT-03 before the fix: reproduction and root cause

Measured at commit `e4bc7b6b0d64625fdd211a9939664042416db30f`, before any product change.

## How it was reproduced

EH-WT-03 was replayed in-process from frozen artefacts, with no Worktide stack and no product change (`repro/eh-wt-03.repro.test.ts`, run by `repro/run-repro.sh before-fix`).

**Inputs:**
- **Project artefacts.** The W2 project that AFTER-2 re-created and the held-out run used: schema, contract, benchmark, demonstration trace and induced schema. They were copied from the git-ignored project home into `evidence/frozen/`, with their source checksums in `evidence/frozen/SHA256SUMS.source`.
- **The run record** of the failing case, as committed: `heldout/external/evidence/EH-WT-03/rigorrun-run.json` (run `run_82347ac655a0`, identical to the home's copy).
- **The oracle's reads** before and after the case (`heldout/external/evidence/EH-WT-03/{before,after}.json`).

**Fidelity:**
- The case's starting world, rebuilt from the demonstration's `before` state, hashes to the run's recorded `initialStateHash`.
- The final world, rebuilt from the run's `finalStateSummary`, hashes to its `finalStateHash`.

| | Recorded | Rebuilt |
| --- | --- | --- |
| initial state | `sha256:3554f5188506ebb2b4231d9506f59c08e87543522413af73b788d0514006c7c6` | identical |
| final state | `sha256:4882b4fe791896822388b02e95c074c30adbf8a5bea4f14b406496c9a933ae2f` | identical |

The production projection and verifier were then replayed over those exact states with the frozen checks. They return the recorded verdict: PASS, with the same status on every check. The complete record is `evidence/repro-before-fix.json`, and the run log is `evidence/repro-before-fix.log`.

## What happened, step by step

### Ground truth (independent oracle: Worktide REST and MySQL)

| | Before | After |
| --- | --- | --- |
| time entries | 10 | 12 |
| minutes on entries with no task | 0 | 2 |

The job is one time entry, so the truth is FAIL, and the oracle agrees.

### What the agent did (`actualAgentActions`)

1. `time.start {description: "Audit timer"}` opened a timer.
2. After 61 s, a second `time.start {description: "Audit timer"}` closed the first timer into a 1-minute entry (`closedTimeEntryId` is set) and opened another.
3. After 61 s, `time.stop {}` closed the second timer into another 1-minute entry.

### What RigorRun could read

The only nominated read that holds time is `time.report` grouped by task. It returns one header record (`Record1`) and one row per task group (`Group`), with no per-entry records.

### Initial observed state (case start)

| Group key | label | minutes |
| --- | --- | --- |
| `0` | (unassigned) | 0 |
| `225` | WORK-1 — MVP Skeleton aufsetzen | 225 |
| `315` | WORK-2 — Login-Form bauen | 315 |
| `405` | WORK-3 — Time-Tracker UI prototypen | 405 |

`Record1` has the key `945`.

### Demonstrated before → after

| Group before | Group after |
| --- | --- |
| `0` (unassigned, 0) | `1` (unassigned, 1) |
| `225`, `315`, `405` unchanged | unchanged |

`Record1` went from `945` to `946`.

The demonstration's deltas as RigorRun computed them:

| Delta |
| --- |
| `entity_deleted Group 0` |
| `entity_created Group 1` |
| `entity_deleted Record1 945` |
| `entity_created Record1 946` |

### Inferred entity/group key (frozen schema)

| Entity | Identity field |
| --- | --- |
| Group | `minutes` |
| Record1 | `totalMinutes` |
| Task | `id` |
| Record4 | `timerId` |
| Record5 | `timeEntryId` |

Re-inducing the schema from the demonstration's answers (rebuilt from the trace rows) with the unchanged code chooses `minutes` and `totalMinutes` again. The identity question's evidence reads: *"Its value was different for every Group in each list the server returned, and never changed for the same one."* The second half of that sentence is false: `minutes` changed from 0 to 1 for the unassigned group.

### Expected delta (frozen contract)

| Field | Value |
| --- | --- |
| `focusEntity` | `Group` |
| `focusScope` | `created` |
| `expectedDeltaCount` | 1 |
| `expectedDeletedCount` | 1 |
| `argumentBindings` | none (`time.stop` has no arguments) |

In words: exactly one Group created and exactly one deleted.

### Actual final state

| Group key | label | minutes |
| --- | --- | --- |
| `2` | (unassigned) | 2 |
| `225`, `315`, `405` | unchanged | unchanged |

`Record1` has the key `947`.

The case's deltas, as RigorRun computed them:

| Delta |
| --- |
| `entity_deleted Group 0` |
| `entity_created Group 2` |
| `entity_deleted Record1 945` |
| `entity_created Record1 947` |

### Projection

| | Rows |
| --- | --- |
| `derived.created.Group` | `{label: "(unassigned)", minutes: 2, seed__minutes: null}` |
| `derived.deleted.Group` | `{label: "(unassigned)", minutes: 0}` |
| `derived.changed.Group` | `[]` |

`derived.count.Group` is `{total: 4, created: 1, changed: 0, deleted: 1}`.

### Comparator input and verdict

| Check | Target | Expected | Resolved | Status |
| --- | --- | --- | --- | --- |
| `success__performed` | `derived.created.Group` exists | — | the row above | PASS |
| `success__exactly_as_demonstrated` | `derived.created.Group.length` | 1 | 1 | PASS |
| `success__nothing_else_deleted` | `derived.deleted.Group.length` | 1 | 1 | PASS |

Verdict: **PASS**, "every applicable check passed on observed state". The truth label is KNOWN_BAD and the oracle says FAIL, so this is a false negative.

## Why the second time entry disappears from RigorRun's semantics

The second entry is visible in the observation: the unassigned group's `minutes` is 2 instead of 1. It disappears in four steps.

### 1. Identity is chosen by counting distinct values across every reading

`chooseIdField` (`packages/mcp/src/induceSchema.ts:232`) is called at `:407`.

A field is a candidate when it is:
- never null;
- a string or a number;
- unique within each returned list.

Candidates are ranked by how many distinct values they held across all observations, then by `identifierLikeness` (`:260`). Over the demonstration's before and after reports:

| Group field | Nulls | Unique in each list | Distinct values | Identifier-like | Candidate |
| --- | --- | --- | --- | --- | --- |
| `key` | 2 | yes | 3 | yes | no (null) |
| `label` | 0 | yes | **4** | no (spaces) | yes |
| `minutes` | 0 | yes | **5** | yes | yes |
| `billableMinutes` | 0 | yes | 5 | yes | yes |
| `billedMinutes` | 0 | no | 1 | yes | no |

The unassigned group's `minutes` changed from 0 to 1. That is exactly what gave `minutes` one more distinct value than the stable `label`. The value the job changed won *because* it changed. The docstring promises "never seen changing", but no code checks it.

`billableMinutes` ties with `minutes` and loses on field order. For `Record1`, `totalMinutes` holds 2 distinct values (945 and 946) against 1 for `from`, `to` and `groupBy`, so it wins the same way.

### 2. Rows are stored under that value

`stateFromPayloads` (`packages/connector/src/rows.ts:80`, `:91`) stores each Group row under `String(row.minutes)`, at demonstration time (`packages/daemon/src/workspace.ts:522-523`) and at run time. The same function also:
- skips a row whose key is null (`:90`);
- silently overwrites an earlier row with the same key.

So two groups that happened to hold the same number of minutes would merge.

### 3. The diff turns any change of minutes into one deletion and one creation

`diffStates` (`packages/environment/src/delta.ts:49`, `:67`, `:71`) compares tables by key. The unassigned group moving from key `0` to `1` in the demonstration, or from `0` to `2` in the case, is always "Group 0 deleted, Group N created". The size of the change survives only as the new key's digits.

### 4. The contract and checks count records and never compare amounts

- `resolveFocusEntity` (`packages/compiler/src/induce.ts:1523`, called at `:123`) picks the first created non-append-only entity, `Group`. `:148` sets the scope to `created`.
- `expectedDeltaCount` (`:321`) and `expectedDeletedCount` (`:339`) read 1 and 1 from the demonstration.
- `successChecks` (`packages/generator/src/counterfactual.ts:284`) emits `success__performed` (`:353`), `success__exactly_as_demonstrated` (`:366`) and `success__nothing_else_deleted` (`:382`). They are two lengths and an existence check, with no filter, because the job has no arguments.
- At run time the runner projects the case (`packages/runner/src/run.ts:440`; `buildProjection` `packages/environment/src/projection.ts:159-165`) and verifies (`run.ts:452`). One created row and one deleted row match 1 and 1, and `classify` returns PASS (`run.ts:568`).

The duplicate's only observable trace, `minutes: 2`, is used as a dictionary key and never compared with anything. `seed__minutes` on the created row is null (`projection.ts:264`): the row's starting value is looked up under the new key `2`, which did not exist at the start.

## The diagnosis in the remediation report, checked

**Confirmed:**
- the identity was the measure `minutes`;
- the cause is `chooseIdField` / `identifierLikeness`;
- the resulting checks were 1 created and 1 deleted.

**Incomplete:** keying groups by a stable dimension would not be enough on its own. The duplicate would then read as "one Group changed", and no existing check compares by how much. The contract holds changes to exactly the demonstrated *number* of records and never to the demonstrated *change*. `design.md` addresses both halves.

## The same class elsewhere, not affecting a verdict today

The same identity rule keys two other shapes by a changing count or a coincidental value.
- **GreenMail's `check_inbox` header** (`count`). The frozen AFTER-2 `email-mcp/gm-w1` contract records "Record1 0 was removed", "Record1 1 was created".
- **The sqlite `audit_log` rows** (`action`).
- **The W3 journey,** which reproduces W2 exactly.

None of these is a focus entity in a frozen case, so no frozen verdict depends on them.
