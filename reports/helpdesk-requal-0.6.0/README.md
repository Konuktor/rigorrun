# Larch Helpdesk pack re-qualification at the 0.6.0 tree — result

**GO_TWIN** at product tree `5699d2fce52ee1cbbd54fa72f7f7f417664173ad` (`freeze-T.json`),
pre-registered in `PREREGISTRATION.md` before the freeze. The version strings were already 0.6.0,
so this is the tree released.

| Stage | Where               | Cells |  TP |  TN |  FP |  FN | Not scored | Evidence                       |
| ----- | ------------------- | ----: | --: | --: | --: | --: | ---------: | ------------------------------ |
| T     | Larch Helpdesk twin |   144 |  42 | 102 |   0 |   0 |          0 | `evidence/T-20261002T063359Z/` |

All six pre-registered gates pass; the same counts as the first qualification
(`../helpdesk-pack-2026-10`, tree `f6ed4d3`). The stage ran once; no harness failures, no re-runs.

This covers the pack on its twin, for black-box agents. It does not qualify the call-based checks
(`tool_not_called`, `tool_args_in_scope`) — no case uses them — nor any helpdesk but the twin.
