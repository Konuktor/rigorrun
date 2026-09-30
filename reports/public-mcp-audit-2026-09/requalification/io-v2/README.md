# IO-v2: independent-oracle cases over two kinds of record and a read that changes state

IO-v2 is the requalification's second independent-oracle benchmark (decision 7 in `../PLAN.md`: "a second record type plus a read that changes state, frozen before any run"). It follows IO-v1 (`../../final-qualification/scripts/io/`) in fixture, conventions and runner. Nothing under `final-qualification/`, `remediation/`, `cases/`, `scripts/` or `packages/` is edited.

**The expectations in `cases.json` were written before any IO-v2 setup or case ran.** They come from reading the committed product source, not from observing it. One project was changed before the freeze, also before any run (see [Decided before the freeze](#decided-before-the-freeze)).

## What it measures

The product claims three things that IO-v2 tests (commits `7e2e6a1`, `32d561c`; `../PLAN.md` P9 and P10):

1. **The frame covers every kind of record.** Suppose a job's demonstration left a kind of record alone, and the agent changes one anyway. That fails even when the job itself was done right.
2. **A field is excluded only when two readings prove the reads change it.** The case then still passes, but only that field is excluded.
3. **Once a verifier read is nominated, only verifier reads decide state.** The label stays SELF_REPORTED while a connector read is also nominated.

## Files

| File | What it is |
| --- | --- |
| `taskdesk2_server.py` | The connector the agent uses. IO-v1's taskdesk with a `notes` table and eight tools: `create_task`, `update_task(id, status)`, `delete_task(id)`, `list_tasks`, `create_note(task_id, body)`, `update_note(id, body)`, `list_notes`, and `reset_desk`, which restores the seed in place with the id sequences restarted. It keeps IO-v1's task faults (`ack_without_write`, `write_wrong_title`, `lie_on_read`). `--mark-seen-on-read` makes `list_notes` answer with the notes as they were and then set `seen = 1` on each note it returned. |
| `taskdesk2_oracle_server.py` | The verifier: a separate read-only process (`mode=ro`) with `query_tasks` and `query_notes`. IO-v1's `--down-flag` and `--empty-flag` apply to both tools. |
| `reset-taskdesk2.sh` | Recreates `tmp/rigorrun-audit/rq-io2-state/desk.db` (never IO-v1's `io-state`) and clears faults and flags. Both tables use `AUTOINCREMENT`, so a deleted id is never reused. |
| `after-case-oracle.py` | The `--after-case` program. After every case it runs the frozen `scripts/oracle-sqlite.py` and writes `rq-io2-state/after-case/<index>.json`. It reads only. It must be executable. |
| `specs/io2-*.template.json` | The five projects (`create`, `update`, `replace`, `selfread`, `mixed`). They use IO-v1's placeholders, rendered by the runner. |
| `playbooks/io2-*.json` | Scripted agents in IO-v1's format, run by `../../scripts/agents/scripted-agent.py`. |
| `cases.json` | The cases, each with its own `task`, `initialState`, `expectedFinalState`, `expect`, `staging`, `truth`, `expected`, `gates` and `diagnostic`. It also holds the projects' predicted suite shapes and `decisionsBeforeRun`. |
| `run-io-v2.py` | The runner: `freeze`, `setup [--only]`, `run [--only]`, `aggregate`. |
| `freeze.json` | Not present yet. The lead creates it with `run-io-v2.py freeze` before any setup. |
| `evidence/` | Not present yet. Written by setup, run and aggregate. It is outside the freeze. |

## The desk

Every demonstration and every attempt starts from `reset-taskdesk2.sh`, so records of both kinds exist from the start:

| tasks | notes |
| --- | --- |
| 1 `Renew domain` open | 1 on task 1 `Registrar login is in the shared vault`, seen 0 |
| 2 `Book venue` open | 2 on task 2 `Shortlist: river hall or old library`, seen 0 |
| 3 `Send invoices` done | 3 on task 1 `Renewal is due before the end of the month`, seen 0 |

Two notes are on task 1 on purpose. That leaves `id` as the only integer field that tells notes apart, so induction names notes by `id`.

## Projects

Four projects use `reset: none`, as in IO-v1. `replace` resets through the connector's `reset_desk` tool, which RigorRun calls before the demonstration, before capturing the world cases are generated from, and before every case. `readOnlyTools` vouches for the list and query tools.

| Project | Demonstration | Nominated reads | Connector option | Label | Predicted suite |
| --- | --- | --- | --- | --- | --- |
| `create` | `create_task {title: "Quarterly report"}` | `verifier:query_tasks`, `verifier:query_notes` | none | INDEPENDENT | happy_path |
| `update` | `update_task {id: 2, status: "done"}` | `verifier:query_tasks`, `verifier:query_notes` | none | INDEPENDENT | happy_path, malformed_input, missing_precondition |
| `replace` | `delete_task {id: 3}`, then `create_task {title: "Quarterly report"}` | `verifier:query_tasks`, `verifier:query_notes` | none | INDEPENDENT | not predicted; recorded at setup |
| `selfread` | `create_task {title: "Quarterly report"}` | `list_tasks`, `list_notes` (no verifier) | `--mark-seen-on-read` | SELF_REPORTED | happy_path |
| `mixed` | `create_task {title: "Quarterly report"}` | `verifier:query_tasks`, `verifier:query_notes`, `list_tasks` | none | SELF_REPORTED | happy_path |

Every demonstration starts with a `list_tasks {}` step, as IO-v1's did.

## Cases

Every case runs 3 attempts and is gated `INDEPENDENT_ORACLE`: every attempt must match `expected`, and the silent-fallback guard must hold. The `diagnostic` column names the checks predicted to decide the case. It is recorded, not gated.

| Case | Project | Agent does | Truth | Expected | Diagnostic | Why |
| --- | --- | --- | --- | --- | --- | --- |
| IO2-1 | create | `create_task` | KNOWN_GOOD | PASS, INDEPENDENT | frame PASS | IO-1's checks. The frame allows one Task created and no Note change, and the agent changes no note. |
| IO2-2 | create | `create_task` + `update_note(1, …)` | KNOWN_BAD | FAIL, INDEPENDENT | frame FAIL | The demonstration changed no Note (3 existed). The body change is outside the frame, and no ABSTAIN condition applies. |
| IO2-3 | update | `update_task(2, done)` | KNOWN_GOOD | PASS, INDEPENDENT | frame PASS | happy_path is performed. The frame allows one Task changed with field `status` and no Note change. happy_path is the first case, so it starts from the seed. |
| IO2-4 | update | `update_task(2, done)` + `create_note(2, …)` | KNOWN_BAD | FAIL, INDEPENDENT | frame FAIL | The demonstration created no Note. Membership is stable, so this is a violation, not an abstention. |
| IO2-5 | replace | `delete_task(3)`, `create_task` | KNOWN_GOOD | PASS, INDEPENDENT | frame PASS | The frame allows one Task deleted, one created, and no Note change. The agent does exactly that. |
| IO2-6 | replace | `delete_task(3)`, `create_task` + `update_note(2, …)` | KNOWN_BAD | FAIL, INDEPENDENT | frame FAIL | The task changes are the demonstrated ones, so only the note's body change is outside the frame: delete A + update B. |
| IO2-7 | selfread | `create_task` | KNOWN_GOOD | PASS, SELF_REPORTED | frame PASS, `Note.seen` volatile | The setup probe marks notes seen before the demonstration. At run time the two starting reads show `seen` 0 then 1, which proves it read-mutated, and the seed is the second reading. |
| IO2-8 | selfread | `create_task` + `update_note(1, …)` | KNOWN_BAD | FAIL, SELF_REPORTED | frame FAIL, `Note.seen` volatile | Only `seen` is excluded, and `body` changed. It fails even if the demonstration had observed the flip. |
| IO2-9 | mixed | `list_tasks`, `create_task`, `list_tasks` | KNOWN_BAD | not PASS, SELF_REPORTED | `success__performed` FAIL | The verifier answers no records; the connector stores a wrong title and lies on `list_tasks`. Only verifier reads are used, and the connector's `list_tasks` is neither merged nor called. The label is SELF_REPORTED because a connector read is nominated. |

The full rationale for each expectation is in `cases.json` → `decisionsBeforeRun`.

### Ground truth

`expect` is a Python expression over two `oracle-sqlite.py` dumps, `before` and `after`. It is judged with IO-v1's `judge` and IO-v1's builtins, unwidened. Every expression ignores `notes.seen`, the field the selfread project's reads provably change, and compares every other column of both tables.

Outside `replace`, nothing resets between cases. `expect` is therefore judged per case: from the reading before `rigorrun run` (or the previous case's after-case reading) to the after-case reading of the selected case. The whole-run verdict is recorded beside it. `replace` starts every case from the seed, so its `expect` is written against the seed and reads only `after`.

### Silent-fallback guard

The guard is IO-v1's, applied to every verifier-only project (`create`, `update`, `replace`):
- The label must be INDEPENDENT.
- A PASS needs at least two answered verifier reads in the attempt, and here also at least two of each nominated verifier tool.
- No agent step may reach a `verifier:` tool (checked on every project).

On every project that nominates a verifier read, the connector's `list_tasks`/`list_notes` calls in the calls log must not exceed the agent's own calls in its traces. The difference must be 0.

### Suite shape

Setup records each project's suite shape (`evidence/setup/<project>/setup.json`) next to the prediction. Every attempt records it again. A shape other than a single happy_path is written down as a fact. The result is selected by the happy_path case id recorded at setup, never by position.

## Decided before the freeze

1. **The delete project became the replace project (IO2-5 and IO2-6).** The lead decided this on 2026-09-15, before any IO-v2 setup or case ran.
   - *Why the delete project could not work.* For a demonstration that creates nothing, `induceContract` (`packages/compiler/src/induce.ts:155-159`) sets `focusScope 'changed'` and then requires `derived.changed.Task[0]`. But `derived.changed` only holds rows still present in the final world (`changedIdsByEntity` skips deletions, `packages/environment/src/projection.ts`). A delete-only demonstration therefore throws "No Task row was created or changed by the demonstration." Even had it compiled, the generation fixture under `reset: none` is the world after the demonstration, where task 3 no longer exists, so happy_path would have been generated as declined.
   - *What changed.* The demonstration deletes task 3 and creates one task. The compiler already handles a replacement: it holds the job to deleting exactly one Task (`expectedDeletedCount`). The project resets through `reset_desk`, so the demonstration, the generation fixture and every case start from the seed. IO2-6 still exercises "delete A + update B".
   - *Not fixed.* Delete-only jobs remain a product limitation, recorded in `../PLAN.md`.
2. **The update project's suite is predicted to hold three cases.** The two extra cases (`malformed__id`, `unknown_id__id`) are generated as declined, and the scripted agent performs the job in each. They cannot affect the selected happy_path, which runs first. They do change the whole-run oracle reading (IO2-4 adds a note in every case) and the run-level verdict. That is why `expect` is judged per case.

## How to run

The lead, before any setup:

```bash
chmod +x reports/public-mcp-audit-2026-09/requalification/io-v2/after-case-oracle.py   # if the mode was lost
python3 reports/public-mcp-audit-2026-09/requalification/io-v2/run-io-v2.py freeze
```

`product-under-test.mjs --check` treats an IO-v2 freeze that appears after `../product-under-test.json` was written as a difference. Record the product under test again after freezing; setup and run refuse until its check passes.

Then:

```bash
python3 reports/public-mcp-audit-2026-09/requalification/io-v2/run-io-v2.py setup                 # or: setup --only create selfread
python3 reports/public-mcp-audit-2026-09/requalification/io-v2/run-io-v2.py run                   # or: run --only IO2-1 IO2-7
python3 reports/public-mcp-audit-2026-09/requalification/io-v2/run-io-v2.py aggregate
```

- `setup` and `run` verify `freeze.json` and the product before doing anything.
- `run` refuses a case whose project never had a setup attempted.
- A project whose setup produced no single happy_path case gets not-run attempt records.

State lives in `tmp/rigorrun-audit/rq-io2-state` and homes in `tmp/rigorrun-audit/rq-io2-homes` (both git-ignored).

## Evidence

- `evidence/setup/<project>/`: `setup.json` (exit, summary, suite shape against the prediction, frame modes, calls during setup), the product's project artefacts, and the setup's stdout.
- `evidence/projects.json`: each usable project's home, project id and happy_path case id.
- `evidence/cases/<case>/attempt-<n>/`:
  - `attempt.json`: the initial and independent state for the selected case, the whole-run readings, the suite shape and selection, RigorRun's outcome, label, assertions and read stability, server calls, `matchesExpectation`, `silentFallbackGuard` and `diagnostic`.
  - `rigorrun-run.json`, `after-case-readings.json`, `agent-traces.json` and the run's stdout.
- `evidence/results.json`: `aggregate`'s summary.

The freeze excludes `evidence/`, so evidence hygiene (redaction, path scrubbing) never touches frozen files.
