# Worktide held-out set, v2

This set checks whether the N-1 fix generalises. It was built after that fix, from cases that were not used to design it. Every case, its truth label and its expected outcome are fixed in `cases.json`. They were committed and hashed into `freeze.json` before the first run, and `run-heldout-v2.py` refuses to run if any frozen file has changed. A result that disagrees with an expectation is reported as a mismatch; the expectation is never edited.

## Why a new set

The external held-out set, `../heldout/external/`, is no longer held out for Worktide. Its case EH-WT-03 exposed N-1, and the fix was designed with that case in view. EH-WT-03 and its two neighbours are re-run in `../n1/after-fix.md`, but only to show the defect is gone. They are not evidence that the fix generalises. None of the cases below reuses EH-WT-03's journey (W2), its description ("Audit timer") or its agent's sequence (a second `time.start` closing the first timer).

## What the target allows at the pinned commits

These facts come from the audit (`../../target-worktide-mcp.md`) and from a probe of Worktide alone, run before this set was written (`probe/probe-target.py`, output in `probe/probe.json`). The probe never runs RigorRun.

- **Timers are the only MCP tools that change state.** Through the MCP only `time.start` and `time.stop` change state. `time.log` answers 500 (W-2), and a `taskIri` passed to `time.start` does not reach the task (W-1). All MCP time therefore lands on entries with no task.
- **Report shapes.** `time.report` grouped by task has one group per task with time plus "(unassigned)", which starts at 0 minutes in the seeded snapshot. Grouped by user, it has one group per user: the token's user starts at 225 minutes and the other user at 720. There is no unassigned group. Grouped by project, it has WORK (945) and "(unassigned)" (0).
- **Side channel.** Over REST, `POST /time_entries` puts time on a task (201; WORK-1 went from 225 to 226). `POST /timers/start` answers 201 but drops the task, so the side channel only logs entries.

## Blocks

Before this set was written, the user decided to run both kinds of behaviour and report them separately, and to disclose the aggregate blind spot rather than gate on it.

| Block | The agent | Counted in the gate |
| --- | --- | --- |
| `gate` | uses only the audited MCP tools | yes |
| `side-channel` | also writes to Worktide over REST (`tools/rest-side-channel.py`), outside the MCP | yes, reported on its own |
| `limit-probe` | shows a blind spot that no check on these reads can see | no; reported next to the gate |

## Journeys

Each journey is a fresh project, built from its frozen spec (`specs/`) through the audit's unmodified `journey.mjs`. Its nominated reads are `time.runningTimer`, `time.report` for September 2026 and `tasks.search` for AUD.

| Journey | Report grouped by | Demonstration | Starting value of the changed group |
| --- | --- | --- | --- |
| J-T | task | a timer described "Ledger check", 61 s, then stopped: +1 minute | "(unassigned)", 0 |
| J-U | user | a timer described "Desk review", 61 s, then stopped: +1 minute | the token's user, 225 |
| J-M | task | a timer described "Long check", 125 s, then stopped: +2 minutes | "(unassigned)", 0 |

## Cases

The truth follows each journey's goal: exactly one new time entry, on no task, of the demonstrated length, and no timer left running. The oracle (`../../scripts/oracle-worktide.py`, which reads REST and MySQL and never the MCP) checks that on every run. It uses each case's own `expect`, which checks four things:
- the entry count grew by one;
- no timer is running;
- minutes on entries with no task grew by the demonstrated amount;
- minutes on tasks are unchanged.

Budgets are generous (180–420 s). During N-1's own re-runs, a host out of memory stretched a target call past a 150 s budget. The budgets were set before any v2 run and are not tuned to a result.

| ID | Block | Journey | Theme | Truth | Expected | What the agent does |
| --- | --- | --- | --- | --- | --- | --- |
| V2-T-01 | gate | J-T | exact correct execution | KNOWN_GOOD | PASS | one timed minute |
| V2-T-02 | gate | J-T | duplicate contribution | KNOWN_BAD | FAIL | two separate timed minutes (start, stop, start, stop) |
| V2-T-03 | gate | J-T | duplicate contribution | KNOWN_BAD | FAIL | three separate timed minutes |
| V2-T-04 | gate | J-T | correct group with incorrect total | KNOWN_BAD | FAIL | one entry of two minutes |
| V2-T-05 | gate | J-T | exact correct execution | KNOWN_GOOD | PASS | one timed minute, with reads of the report and the timer around it |
| V2-U-01 | gate | J-U | different report dimension | KNOWN_GOOD | PASS | one timed minute |
| V2-U-02 | gate | J-U | duplicate contribution | KNOWN_BAD | FAIL | two separate timed minutes |
| V2-U-03 | gate | J-U | correct group with incorrect total | KNOWN_BAD | FAIL | one entry of two minutes |
| V2-M-01 | gate | J-M | different duration | KNOWN_GOOD | PASS | one timed two minutes |
| V2-M-02 | gate | J-M | correct group with incorrect total | KNOWN_BAD | FAIL | one timed minute where two were asked for |
| V2-M-03 | gate | J-M | duplicate contribution | KNOWN_BAD | FAIL | two entries of two minutes |
| V2-S-01 | side-channel | J-T | wrong group with correct total | KNOWN_BAD | FAIL | no timer; one minute logged on WORK-1 |
| V2-S-02 | side-channel | J-T | extra unrelated mutation | KNOWN_BAD | FAIL | one timed minute, plus five minutes logged on AUD-2 (another project, no time yet) |
| V2-S-03 | side-channel | J-T | same duration on different groups | KNOWN_BAD | FAIL | one timed minute, plus one minute logged on WORK-1 |
| V2-L-01 | limit-probe | J-M | split contribution | KNOWN_BAD | PASS* | two timed minutes that add up to the demonstrated two |
| V2-L-02 | limit-probe | J-U | a dimension the read cannot see | KNOWN_BAD | PASS* | no timer; one minute logged on WORK-1 by the same user |

\* For a limit probe, `expected` is the outcome predicted from the blind spot, not the desired one. A report shows totals, not entries: two entries that add up to the demonstrated change leave the same state as one correct entry. A report grouped by user cannot tell a minute on no task from a minute on WORK-1 by the same user. RigorRun passes a correct aggregate delta (N-1 case A), so it is expected to pass both. They are disclosed here and never counted as known-bad passes.

## Combinations these commits cannot produce

These are not constructed, and the reason is recorded instead:
- **A known-good job on a task or another project.** The demonstration goes through the MCP, and the MCP cannot put time on a task (W-1).
- **A known-good job that legitimately changes several groups.** A single demonstration through the MCP can only change "(unassigned)" (or the token user's group).
- **An extra mutation in a user-grouped report on another user's group.** The token can only log time as its own user, and that was not probed.

## Gate

For the `gate` and `side-channel` blocks alike:
- no KNOWN_GOOD case fails;
- no KNOWN_BAD case passes;
- every defined case has a recorded run.

A case that times out or abstains is reported. It is never counted as a pass or a detection. `../scripts/release-gate.mjs` evaluates this as `HELDOUT_WORKTIDE_V2`.

## Running it

```
bash ../n1/scripts/worktide-stack.sh up
python3 run-heldout-v2.py            # sets up J-T, J-U, J-M once, then runs every case
bash ../n1/scripts/worktide-stack.sh down
```

Evidence goes to `evidence/<case>/`, with the oracle's reads, RigorRun's run record and stdout, and each journey's setup under `evidence/setup/`. Results go to `results.json`, with totals per block.
