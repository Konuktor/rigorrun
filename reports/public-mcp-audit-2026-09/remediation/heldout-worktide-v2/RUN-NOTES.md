# Worktide v2 held-out set: run notes

These notes are not part of the freeze. `freeze.json` hashes the files that define the cases; this file records what a reader needs in order to weigh the results. It is appended to and never rewritten.

## How independent the set is (written while the set was running, before any result was read)

- **One author.** The same agent designed the N-1 fix and this set. The freeze stops the cases and expectations from being edited after a result. It does not make the case selection independent of the fix.
- **V2-S-02 is weaker evidence than the other cases.** Writing it ("the correct timed minute, plus five minutes logged on AUD-2, a task with no time yet") showed that time on a task with no time yet appears as a *new* report group, and that a job that changes records never checked creations. That gap was fixed before the freeze (`../n1/design.md`, amendment 3, commit `69e6c33`), with its regression recorded failing first. The fix is generic, but this case was not unseen by it.
- **J-T and J-M exercise the same mechanism as W2.** A timer with no task lands in "(unassigned)" in a report grouped by task; only the description, duration and agent sequences are new. J-U is the structurally new condition: a report grouped by user whose changed group starts from a non-zero total.
- **One run per case.** Timing-dependent outcomes (whole minutes on a timer) and host load can vary between runs, and a single run shows no variance.
- **One target.** All cases run on one target, Worktide at the pinned commits, and one kind of read, `time.report`. Nothing here speaks for other MCP servers or other aggregate shapes.

## What the set does not re-measure

- **The frozen 58-case real-server benchmark (AFTER-2) predates N-1.** N-1 changes identity induction for every induced schema, including the email and sqlite journeys (the GreenMail inbox header, for one, was keyed by a changing `count`). None of those frozen cases has been re-run at the N-1 commit. Unit and integration tests, and the in-process held-out set, have.
