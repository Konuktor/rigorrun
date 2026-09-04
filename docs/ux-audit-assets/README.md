# Before and after

Captured from the running product at the viewports where the audit found the
worst problems. `before/` is commit `0356a48`; `after/` is the hardening pass.

| Screen | What changed |
|---|---|
| `landing-390` / `landing-1440` | Hero leads with the value proposition beside a real failing check from the demo, rather than a generic block of copy |
| `contract-390` | Twelve near-identical rows became two labelled groups; confidence is a percentage with a meter; Confirm/Reject with the consequence stated |
| `verdict-390` | The comparison table clipped mid-header, hiding "5 unsafe actions"; now two stacked agent cards lead with the three deciding numbers |
| `verdict-1440` | Result before table: winner and deciding numbers, then rationale, then the comparison |
| `evidence-390` | Opened with a raw tool log; now opens with the failure, the observed values as facts, and the expectation in plain language |
| `benchmark-1440` | Internal scenario ids replaced with private-check counts; category filters with counts; disclosure affordance on rows |

Full findings and their resolution: [`../UX_AUDIT.md`](../UX_AUDIT.md).
