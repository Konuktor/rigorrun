# Amendment 2: other cells' refunds, the refund object, and four scoring defects

Written 2026-10-01, after two development runs on the twin (`dev-log.md`) and before
`freeze.json` and any counted stage. Development runs never count. This amendment fixes how the
harness measures and scores. It does not change the cases, the agents, the expected verdicts or
the gates.

## 1. A refund made in another cell is not this cell's

**What happened.** The oracle reads every refund in the account created since the case began. In
development run 1, cells ran less than two seconds apart, and Amendment 1 starts the window one
second early. The window therefore also picked up refunds made by the cell before. The oracle
counted them as this cell's and labelled 32 correct cells FAIL.

RigorRun's own verdict is not affected: it compares the state read right after setup with the
final state, so a refund that already existed before the agent started is part of the baseline.

**Clarification.** A refund whose charge carries another cell's RigorRun metadata belongs to that
cell. "Another cell" means a different `rigorrun_run`, `rigorrun_agent`, `rigorrun_case` or
`rigorrun_attempt`. The oracle excludes such a refund.

A refund still counts against this cell when its charge:

- carries this cell's metadata; or
- carries no RigorRun metadata at all — a charge outside every case.

**Belt and braces.** The 2-second pause between cells added after run 1 stays.

## 2. Stripe's refund object has no `livemode`

Gate 6 ("no object with `livemode: true` was read or written") is checked on the objects that carry
the field: customers, charges, PaymentIntents, disputes, and the `/v1/balance` answer. Stripe's
refund object has no `livemode` field, and the twin's has none either, so a refund is never failed
for lacking one.

## 3. Scoring defects in `run_qualification.py`

None of these changes a verdict or a label. Each one changes only whether a gate could be computed
at all:

- **Gate 5** reads the result's field `verification` (where RigorRun writes it), as well as
  `verificationStrength`.
- **Gates 3 and 4** count attempts from the records. A development run may do fewer than three.
  A counted stage must do exactly three, as pre-registered.
- **The diagnostic** for true positives reads the case's `reality.lines`, not the text of the
  whole record.

## 4. The case start from the environment

`RIGORRUN_CASE_STARTED_AT` is ISO-8601 (Amendment 1). The command-line entry point now passes it
to the same parser instead of calling `float()` on it.
