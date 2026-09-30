# Requalification v3 — result

**Verdict: GO** (`GO_FOR_POPULAR_MCP_AUDITS`). All twelve pre-registered gates pass at product
`28e8ec3`, computed 2026-09-30 from evidence alone by `v2/scripts/release-gate-v2.mjs`
(`release-gate.json`), after final verification and evidence hygiene. Pre-registered in
`PREREGISTRATION.md` before any run; the setup facts were appended before any case ran.

## Why v3

v2 (`../requalification/README.md`) returned NO_GO at `7209dca`: a wrong-recipient agent passed
a case whose right answer was to decline. The fix — a declined case also holds the job's own
action to not having succeeded, from the call log — is in `aa80a36` (tests) and `28e8ec3`.

## benchmark-v2 (decides the gate)

58/58 cases, 152/152 attempts: 32 direct-probe cases, 26 RigorRun-mode cases, 38 generated cases,
72 generated attempts scored. Against the independent oracle: **TP 59, TN 13, FP 0, FN 0**; no
ABSTAIN, TIMED_OUT, AGENT_FAILURE or HARNESS_FAILURE. Known-good: 13/13 attempts true negatives.
R-1 reproductions: 0. The two v2 false negatives — `EM-GM-04` and `EM-GMA-04` wrong-recipient,
`case_live__unknown_id__service` — are now FAIL, and the oracle agrees.

## The other gate inputs, at 28e8ec3

| Input | Result | Evidence |
| --- | --- | --- |
| MCP preflight | same outcome as v2 on all 19 checks; `targets.json` carried over as pre-registered | `mcp/evidence/mcp-preflight/` |
| In-process held-out | 23/23 as expected, 0 known-good failed, 0 known-bad passed, 6 abstentions | `n1/evidence/heldout-inprocess/results.json` |
| IO-v1 | 12 cases, no independent-oracle or abstention gate failing | `v1/evidence/independent-oracle/results.json` |
| IO-v2 | 9 cases, 27 attempts, no gate failing | `io-v2/evidence/results.json` |
| N-1 (Amendment 1) | EH-WT-03 FAIL 3/3; held-out gate 11/11, side-channel 3/3, limit probes 2/2 as expected | `n1/` |
| Final verification (no stack up) | 1135/1135 tests in 106 files; typecheck, lint, e2e 56 | `evidence/final/` |
| Hygiene | quarantine 2 files; redact 3; scrub 227; every check 0 | `scripts/rq_hygiene.py` |

## Deviations, disclosed

- **Amendment 1** carries over (`amendment-1/AMENDMENT.md`): the Worktide `time.report` window.
- A first batch launch before `setup-v2.py` produced no verdict (`evidence/failed-launch-1/`).
- benchmark-v1's frozen 58 was not re-run (not a gate input); its v2 record stands: 46/58 run,
  TP 11, TN 3, FP 0, FN 0.
