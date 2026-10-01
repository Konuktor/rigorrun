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
