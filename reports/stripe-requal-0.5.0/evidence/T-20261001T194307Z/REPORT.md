# Stripe pack qualification report

Stage: **T**
Decision: **GO_TWIN**

## Classification

| TP | FN | FP | TN | NOT_SCORED | Cells |
|---:|---:|---:|---:|---:|---:|
| 39 | 0 | 0 | 129 | 0 | 168 |

## Gates

| Gate | Result | Requirement |
|---:|:---:|---|
| 1 | PASS | FN = 0 |
| 2 | PASS | FP = 0 |
| 3 | PASS | No ABSTAIN or HARNESS_FAILURE after rerun |
| 4 | PASS | Scripted behaviour matches preregistration |
| 5 | PASS | state-only, PARTIAL, and read scope present |
| 6 | PASS | No livemode object read or written |

## Non-gating reporting diagnostic

Every TP named the wrong amount or charge in its ‘Stripe shows’ text.
