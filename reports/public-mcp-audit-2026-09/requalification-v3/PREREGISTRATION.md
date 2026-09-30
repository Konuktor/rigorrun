# Requalification v3 — pre-registration

Written 2026-09-30T20:02:33Z, before any v3 run. Committed with the product pin it describes.

## Why

Requalification v2 (`../requalification/README.md`) returned **NO_GO** at product `7209dca`:
GATE 2 and GATE 5 failed on the same two attempts — a wrong-recipient agent passed
`case_live__unknown_id__service`, a case whose right answer is to decline, because the
stray message was outside every nominated read and no check in a declined case asked
whether the job's own action had succeeded. Nothing was re-run to change that outcome.

## The product under test

`redesign/brand-site-product` at `28e8ec3`, recorded by `scripts/product-under-test.mjs`
into `product-under-test.json`. Product commits since `7209dca`, all measured here:

| Commit | Change |
| --- | --- |
| bbe981d, f9b1afa | RigorRun never resets, records or builds a suite on a system marked production; the safety mode must be chosen explicitly |
| df075f0, 8652e37 | Credentials from `RIGORRUN_SECRET__<NAME>` for CI; agent docs matching the protocol |
| aa80a36, 28e8ec3 | **The fix:** a declined case also holds the job's own action to not having succeeded, from the call log (EVENT). Also: black-box agents (`rigorrun/task/1`), unobserved evidence listed as non-blocking, and a field changed from unset to an operator-typed value held to being left set |

## What does not change

- Every frozen definition, byte for byte: `v2/` (benchmark-v2 cases, labels, budgets,
  scripts; its freeze verifies in this directory), `io-v2/` (freeze verifies), the IO-v1,
  held-out and frozen-58 inputs outside this directory, and the scoring scripts.
- The twelve gates and `v2/scripts/release-gate-v2.mjs`, unmodified.
- Amendment 1 (`amendment-1/AMENDMENT.md`): the Worktide `time.report` window, read from
  the same six overlay copies with the same digests.

The only edits in the copied harness are two destinations that named `requalification/`
literally: `scripts/rq_hygiene.py` (which tree it treats as this run's own) and
`n1/run-heldout-inprocess-rq.sh` (where the in-process results are written).

## Order

1. MCP preflight (`mcp/mcp-preflight.ts`)
2. In-process held-out (`n1/run-heldout-inprocess-rq.sh`)
3. IO-v1 (`scripts/rq_io_v1.py setup|run|aggregate`)
4. IO-v2 (`io-v2/run-io-v2.py setup|run|aggregate`)
5. Recreate the audit stacks
6. benchmark-v2, manifest order, six batches (`scripts/run-v2-chain.sh`)
7. N-1 under Amendment 1 (`amendment-1/run-eh-wt-03-amended.py`, `run-heldout-amended.py`)
8. aggregate-v2 → cross-regression → aggregate-v2
9. Final verification with no stack up
10. Hygiene (quarantine, redact, scrub) and the product check
11. The release gate

`mcp/evidence/mcp-preflight/targets.json` is carried over from v2 only if the new
`summary.json` records the same outcome for every check; otherwise it is rewritten from the
new evidence and the difference disclosed.

## Not re-run

benchmark-v1's frozen 58 (not an input to any gate). Its v2 record stands and is reported
beside this one.

## Rules

A result is never re-run to change it. A harness failure that produced no verdict may be
re-run once, recorded with its timing. A NO_GO is recorded as the verdict.
