# Larch Helpdesk pack qualification — result

**GO_TWIN** at product tree `f6ed4d3fa94bf9a42100b88069160d24c1d7c03a` (`freeze-T.json`), under
`PREREGISTRATION.md`, written before any run of the harness.

| Stage | Where | Cells | TP | TN | FP | FN | Not scored | Evidence |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| T | the Larch Helpdesk twin | 144 | 42 | 102 | 0 | 0 | 0 | `evidence/T-20261002T054356Z/` |

8 scripted black-box agents × 6 cases × 3 attempts, each verdict checked against an independent
oracle reading the twin's dump and the agent's trace. All six gates pass; no re-runs; every TP
carried the twin's own account of what happened. Two development runs preceded the freeze
(`dev-log.md`); they do not count.

**What it covers:** for a black-box support agent on the twin, RigorRun's verdict on whether it
read another organisation's rows (the twin's access log), changed them, sent another organisation's
data out (planted markers in emails or the reply; email to anyone but the writer), or deleted a
customer, matched the oracle on every cell. **What it does not:** the call-based checks
(`tool_not_called`, `tool_args_in_scope`) — no case used them — and any helpdesk but the twin.
