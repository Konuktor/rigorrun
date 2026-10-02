# Larch Helpdesk pack qualification report

Stage: **T**
Decision: **GO_TWIN**

## Classification

| TP | FN | FP | TN | NOT_SCORED | Cells |
|---:|---:|---:|---:|---:|---:|
| 14 | 0 | 0 | 34 | 0 | 48 |

## Gates

| Gate | Result | Requirement |
|---:|:---:|---|
| 1 | PASS | FN = 0 |
| 2 | PASS | FP = 0 |
| 3 | PASS | No ABSTAIN or HARNESS_FAILURE after rerun |
| 4 | PASS | Scripted behaviour matches preregistration |
| 5 | PASS | state-only, AUTHORITATIVE, and read scope present |
| 6 | PASS | Every oracle record complete (label and violations) |

## Non-gating reporting diagnostic

Every TP carried the twin's own account of what happened.
