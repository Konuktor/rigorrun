# Amendment 1 — an expired date window in six frozen inputs

Written 2026-09-30T19:02:14Z, **before** any re-run it governs. Nothing under `v2/`, `io-v2/`,
`remediation/`, `scripts/` or `cases/` is edited; the originals still match their
freezes, and the amended copies live in `overlay/` next to this file.

## What happened

Step 5 of REMAINING-WORK.md §6 ran 2026-09-30 18:49–18:51Z (log kept at
`amendment-1/step5-first-attempt.log`). Every Worktide setup refused to compile:

> The recording performed "time.stop" but nothing in the system changed.

The demonstration starts a timer, waits 61 s and stops it, so it creates one time entry.
The only read that can see a new entry is `time.report {from: "2026-09-01", to: "2026-09-30"}`,
frozen in September. By the time step 5 ran, the Worktide server's date had passed that
window (18:5xZ on 2026-09-30 is 00:5x on 2026-10-01 at UTC+6), so the new entry was outside
it, the before/after reads were equal, and RigorRun correctly refused to compile a job that
changed nothing it could see. **No project was built, no agent was run and no verdict was
produced**, so re-running does not re-roll any outcome — the same reasoning §5.1 applied to
SQ-W1B-04.

## The change, and nothing else

Only the upper bound of that read moves, from `2026-09-30` to `2026-12-31`, in:

| Frozen file | Lines changed |
| --- | --- |
| scripts/specs-worktide-w2.json | 1 |
| scripts/specs-worktide-w3.json | 1 |
| remediation/heldout-worktide-v2/specs/j-m.json | 1 |
| remediation/heldout-worktide-v2/specs/j-t.json | 1 |
| remediation/heldout-worktide-v2/specs/j-u.json | 1 |
| remediation/heldout-worktide-v2/playbooks/v2-one-minute-with-reads.json | 2 |

`overlay.sha256` records the digests of each original and its copy; `diff` of every pair
shows the date and nothing else. The labels, cases, expectations, budgets, agents, oracle,
blocks and gate rules are untouched.

## How the copies are used

`run-step5-amended.sh` runs step 5 exactly as REMAINING-WORK.md §6 says, through two thin
wrappers that change only which file is read for those six paths:

- `run-eh-wt-03-amended.py` imports `n1/run-eh-wt-03-rq.py` unmodified and, in the
  setup module it loads, redirects the `journey.mjs setup <spec>` argument for the two
  Worktide specs to their overlay copies.
- `run-heldout-amended.py` imports `n1/run-heldout-worktide-v2-rq.py` unmodified; its
  `verify_freeze()` still hashes the originals, and only the spec path handed to
  `journey.mjs` and the text of the expanded playbook are taken from the overlay.

## Disclosure

The release gate and README report this amendment by name, with its timing, as a deviation
from the frozen protocol.

## The first attempt's output

Moved, not deleted, to `amendment-1/first-attempt/` before the re-run: `n1/evidence/w2-setup/`,
`n1/evidence/heldout-worktide-v2/` and `n1/heldout-worktide-v2-results.json` (every case
`NOT_RUN`, every setup refused). The re-run writes to the original locations from nothing.
