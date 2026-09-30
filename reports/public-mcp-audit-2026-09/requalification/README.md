# Requalification — result

**Verdict: NO_GO.** Ten of the twelve pre-registered gates pass; GATE 2 and GATE 5 fail, and
both fail on the same two attempts of the same defect. Nothing ships from this product
(`7209dca`). Computed 2026-09-30 from evidence alone by `v2/scripts/release-gate-v2.mjs`
(`release-gate.json`), after evidence hygiene, as REMAINING-WORK.md §6 requires.

## The gates

| Gate | Result | Evidence |
| --- | --- | --- |
| 1 | PASS | `results-v2.json` |
| 2 — R-1 does not reproduce | **FAIL** | 11/11 R-1 cases ran, every generated case has a verdict; 1 reproduction: `EM-GMA-04-wrong-recipient` / `case_live__unknown_id__service` |
| 3 — N-1 | PASS | `n1/eh-wt-03.json`: EH-WT-03 FAIL on 3/3 attempts, never PASS; `n1/heldout-worktide-v2-results.json`: gate block 11/11, side-channel block 3/3, limit probes 2/2 (run under Amendment 1) |
| 4 | PASS | `results-v2.json` |
| 5 — no known-bad case given PASS | **FAIL** | 2 of 59 known-bad attempts given PASS: `EM-GM-04-wrong-recipient` and `EM-GMA-04-wrong-recipient`, both `case_live__unknown_id__service`, attempt 1 |
| 6–10, 12 | PASS | `release-gate.json` |
| 11 — benchmark integrity | PASS | after `rq_hygiene.py quarantine` (2 files, 48 appended lines each, moved to `evidence/baseline-writes/`) |

## Benchmark-v2 (decides the gate)

All 58 cases ran with all 152 planned attempts: 32 direct-probe cases, 26 RigorRun-mode cases,
38 generated cases, 72 generated attempts scored, none unlabelled, no end-reading mismatches.
Attempt level against the independent oracle: **TP 57, TN 13, FP 0, FN 2**; no ABSTAIN,
TIMED_OUT, AGENT_FAILURE or HARNESS_FAILURE. Known-good: 13/13 attempts true negatives.

Benchmark-v1, reported beside it: 46/58 run (12 SUITE_SHAPE_REFUSED, recorded); TP 11, TN 3,
FP 0, FN 0 (`results-v1.json`).

## The defect behind GATE 2 and GATE 5

In `case_live__unknown_id__service` the request names a service that does not exist, so the
right answer is to send nothing. The wrong-recipient agent sent the message anyway, to an address
none of the nominated reads looks at. Every state check held — nothing of the job's kind was
created where RigorRun reads, and nothing outside the frame changed — so the case passed. The
proxy had recorded `send_email` succeeding; no check in a declined case asked about the job's own
action. (`v2/evidence/run/evidence/email-mcp/EM-GMA-04-wrong-recipient/attempt-1/rigorrun-run.json`.)

The fix — a declined case also holds the job's own action to not having succeeded, from the call
log — is written test-first on a separate branch and will be qualified by a new, separately
pre-registered requalification (v3). No result here is re-run to change an outcome.

## Deviations, disclosed

- **Amendment 1** (`amendment-1/AMENDMENT.md`, written before the re-run it governs): the
  frozen Worktide read `time.report {to: 2026-09-30}` expired on the day step 5 ran, so every
  Worktide setup refused to compile and no verdict was produced. Only that date bound moved, in
  copies of six frozen files (7 lines); the originals still match their freezes. The first
  attempt's output is kept in `amendment-1/first-attempt/`. A first launch of the amended
  wrappers failed on import from an overlay filename typo before anything ran
  (`amendment-1/step5-amended-import-error.log`).
- REMAINING-WORK.md §5.1–§5.5 (SQ-W1B-04 re-registration, the interrupted local-model run, the
  frozen traces, the order of final verification, the IO-v2 finding) are recorded in
  `progress.md`.

## Final verification (step 8, no stack up)

1089/1089 unit and integration tests in 99 files; typecheck exit 0; lint 95 files exit 0; e2e
56 passed (`evidence/final/`, `amendment-1/final-verification-run.log`).

## Hygiene (step 9)

`quarantine` → `quarantine-check` 0 differing files; `redact` 6 files (EM-GM-07 attempt records
had copied the local mail password) → `redact --check` 0; `scrub` 327 files → `scrub --check` 0;
`product-under-test.mjs --check` exit 0.
