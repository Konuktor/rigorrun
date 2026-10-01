- 20261001T032339Z: stage T, evidence `dev-runs/T-20261001T032339Z`
- 20261001T032538Z: stage T, evidence `dev-runs/T-20261001T032538Z`
- 20261001T035040Z: stage T, evidence `dev-runs/T-20261001T035040Z`

- 2026-10-01, before any freeze: the freeze is per stage (`freeze-T.json`, `freeze-L.json`) and
  holds the git tree of `packages/` (the product) besides HEAD. A counted stage refuses unless that
  tree is unchanged, so the evidence of stage T can be committed before stage L without invalidating
  it, while any product change still does. Before this, one `freeze.json` compared HEAD, which made
  the two pre-registered stages impossible to run in order. No cell, case, agent, label or gate
  changed.

- **Stage L, first counted run: interrupted.** It was started at the frozen product (`freeze-L.json`)
  and stopped after 76 of 168 cells, at `double_refund × other_customer`, attempt 1. The harness
  process was killed when the session controlling it ended; nothing in the product or the harness
  failed.
  - Its 76 cells are kept whole in `evidence/L-20261001T082426Z-interrupted/`. RigorRun agreed with
    the oracle on every one: 58 TN, 18 TP, 0 FN, 0 FP.
  - An interrupted stage has no outcome, so stage L is run again in full at the same frozen product.
    The interrupted run is published beside the full one and is never replaced by it.
  - Timestamps in this directory come from a machine whose clock was corrected during the day
    (dual-boot RTC). The evidence directory names are not in time order; `cells.jsonl` order is.
- Stage L, second counted run, did not start. `rigorrun stripe init` could not reach
  api.stripe.com within 10 s ("Connect Timeout") because this machine's network dropped for a
  moment. No cell ran (`evidence/L-20261001T084730Z-failed-to-start/`, empty). Started again at once,
  at the same frozen product.
- **Stage L, third counted run: interrupted.** It stopped after 31 cells, when the oracle's request
  for `already_refunded` failed DNS resolution on this machine ("Temporary failure in name
  resolution"). The 31 cells all agree: 25 TN, 6 TP, 0 FN, 0 FP. They are kept whole in
  `evidence/L-20261001T084824Z-interrupted/`.
- **Harness hardening, made at the same frozen product, in response to that interruption.** The
  oracle and the scripted agents now retry transport failures — DNS, dropped connections, timeouts —
  up to five times, waiting 1, 2, 4, 8 and 16 s.
  - These are reads, or writes that carry their Idempotency-Key, so a repeat cannot double an
    action.
  - Stripe's own answers are never retried, except 429 as before.
  - RigorRun's client already did this (`packages/env-stripe/src/client.ts`).
  - Nothing that decides a label or a verdict changed. 70 harness tests still pass.
  - Stage L is run again in full.
- **Stage L, fourth counted run: stopped on purpose after 4 cells.**
  - The cold-founder walkthrough had just found two first-run defects in the product: a late write
    by a timed-out agent was counted against the next case, and the per-case budget was too short
    for a model calling tools.
  - Fixing them changes `packages/`, so any stage run at the old tree would not qualify the release.
  - The 4 cells are kept in `evidence/L-20261001T085948Z-stopped/`.
  - After the fix, stages T and L and the black-box qualification are run again, at the new product
    tree, with new freeze files. Every earlier counted result stays published under the tree it was
    run against.
