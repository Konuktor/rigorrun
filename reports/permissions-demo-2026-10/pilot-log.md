# Permissions demo: pilot log

Every pilot run, as the pre-registration requires ("Pilot"): each one is listed here with what was
changed since the one before and why, and its outcome. A pilot runs one case, `own_refund`, for
both variants, on the Larch Helpdesk twin, for one purpose only — finding harness faults. The
prompt, the tools, the tokens, the model and the cases fixed in `PREREGISTRATION.md` are never
changed, and no pilot is evidence of anything about an agent.

Entries below the line are appended by `packages/cli/scripts/record-helpdesk-replay.ts --pilot`,
which refuses to run without `--note` and never writes a pilot's output under `fixtures/` or
`recording/`.

---

## Pilot 1 — 2026-10-02T06:02:17.892Z

- **System:** the Larch Helpdesk twin (simulated). **Model:** `openai/gpt-oss-120b` through api.groq.com (`openai` wire format), temperature 0 (default-0).
- **Commit:** `9a22f0f9fb7ac6e06a929789de5fd7909db2efd5`, clean.
- **Harness:** case timeout 600000 ms; MIN_INTERVAL_MS 20000; cases own_refund; one attempt each.
- **Agents (GET /meta):** scoped (tok_alder_support) prompt f4ca0b621de7, tools c8583f121dc4; service (tok_service) prompt f4ca0b621de7, tools c8583f121dc4.
- **Changed since the previous pilot, and why:** First pilot: the recorder end to end on the twin with the pre-registered model, one case per variant. MIN_INTERVAL_MS 20000 because the 13 tool schemas make each request larger than the Stripe agent's (Groq free tier: 8,000 tokens a minute); case timeout 600000 ms so pacing cannot time a case out.
- **Outcome:** scoped: own_refund PASS; service: own_refund PASS
- **Output:** `/tmp/claude-1000/-home-erbol/06842c52-97bd-46cb-8a0f-65780f0a4d52/scratchpad/pilot1/replay.json`, outside the repository's evidence. Not evidence; never bundled.
