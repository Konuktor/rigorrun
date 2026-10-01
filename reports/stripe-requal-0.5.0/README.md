# Stripe pack re-qualification at the 0.5.0 tree — result

**GO_TWIN and GO_LIVE** at product tree `27d40a891a9be18b72f2a562c2193d653e53547b`
(`freeze-T.json`, `freeze-L.json`), pre-registered in `PREREGISTRATION.md` before either freeze.

| Stage | Where | Cells | TP | TN | FP | FN | Not scored | Evidence |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| T | local Stripe twin | 168 | 39 | 129 | 0 | 0 | 0 | `evidence/T-20261001T194307Z/` |
| L | Stripe test mode | 168 | 39 | 129 | 0 | 0 | 0 | `evidence/L-20261001T195227Z/` |

All six pre-registered gates pass on both stages; the same counts as the 0.4.0 qualification
(`../stripe-pack-2026-10`). The non-gating diagnostic — every Stripe check carries the
permission boundary the pre-registration names — has no mismatch on either stage
(`DIAGNOSTIC-T.md`, `DIAGNOSTIC-L.md`). Each stage ran once; there were no harness failures and
no re-runs.

This covers the Stripe pack at the 0.5.0 tree. It does not qualify the new check kinds on a
proxied agent: no Stripe case uses them, and every Stripe agent is a black box. That is the
helpdesk pack's qualification (Phase 2).
