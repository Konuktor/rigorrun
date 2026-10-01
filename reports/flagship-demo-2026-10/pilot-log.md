# Flagship demo: pilot log

Every pilot run, as the pre-registration requires ("Pilot"): each one is listed here with what was
changed since the one before and why. A pilot runs on the local twin, before `freeze.json` exists,
for one purpose only — finding harness faults, such as a tool schema the model's API rejects or a
timeout. The texts, the tool set and the prompt fixed in `PREREGISTRATION.md` are never changed to
make a variant fail or pass, and no pilot is evidence of anything about an agent.

Entries below the line are appended by `packages/cli/scripts/record-stripe-replay.ts --pilot`,
which refuses to run without `--note` (what changed, and why) and never writes a pilot's output
under `fixtures/` or `recording/`.

---
