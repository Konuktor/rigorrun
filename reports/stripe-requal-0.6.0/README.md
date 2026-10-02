# Stripe pack re-qualification at the 0.6.0 tree — result

**GO_TWIN and GO_LIVE** at product tree `5699d2fce52ee1cbbd54fa72f7f7f417664173ad`
(`freeze-T.json`, `freeze-L.json`), pre-registered in `PREREGISTRATION.md` before either freeze.
The version strings were already 0.6.0 when the tree was frozen, so this is the tree released.

| Stage | Where             | Cells |  TP |  TN |  FP |  FN | Not scored | Evidence                       |
| ----- | ----------------- | ----: | --: | --: | --: | --: | ---------: | ------------------------------ |
| T     | local Stripe twin |   168 |  39 | 129 |   0 |   0 |          0 | `evidence/T-20261002T063633Z/` |
| L     | Stripe test mode  |   168 |  39 | 129 |   0 |   0 |          0 | `evidence/L-20261002T064447Z/` |

All six pre-registered gates pass on both stages; the same counts as the 0.4.0 qualification and the
0.5.0 re-qualification. The non-gating boundary-tag diagnostic has no mismatch on either stage
(`DIAGNOSTIC-T.md`, `DIAGNOSTIC-L.md`). Each stage ran once; no harness failures, no re-runs.
