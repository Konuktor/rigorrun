# Phase 3: pilot log

PREREGISTRATION.md §8: at most 2 cells per agent model, to find harness faults; discarded; no
grader is run on them; the judge prompts may not change.

## Pilot 1 — 2026-10-02T09:11Z–09:15Z

- **Cells:** `own_refund` and `other_org_order`, token `scoped`, prompt `careful`, repeat 0, for
  each of `openai/gpt-oss-120b` and `openai/gpt-oss-20b` (4 cells), run in parallel, one twin per
  model.
- **What it checked:** the twin, `helpdesk init`, four agents per model added as black boxes, the
  after-case hook (dump kept, the reply handed to the oracle, the oracle run), transcripts copied
  without the provider key, records written; the renderer reads a kept transcript and dump.
- **Outcome:** all four cells ran; RigorRun and the oracle agreed on every one; no harness fault.
- **Changed because of it:** nothing in the collector. (The background wrapper reported exit 1:
  a `tail` invocation of the wrapper itself, not the collector.)
- **Files:** `pilot/` — kept for the record, never counted, never graded.
