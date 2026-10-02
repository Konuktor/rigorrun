# Flagship demo recording

The recording behind `npx rigorrun demo` and `rigorrun.xyz/replay`: the reference support agent
(`examples/stripe-support-agent`), in its two variants, on the Stripe pack's seven cases. How it
is made and how it is shown were fixed before any of it existed.

| File                                        | What it is                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PREREGISTRATION.md`                        | What is recorded, how, and how it is shown. Binding.                                               |
| `AMENDMENT-1.md`                            | The temperature follows the model's documentation; `freeze.json` records the value and its source. |
| `pilot-log.md`                              | Every pilot run on the twin, with what was changed and why. No pilot is evidence.                  |
| `freeze.json`                               | Written once, before the first recorded case. Absent until then.                                   |
| `recording/`                                | Both variants' stored runs and every transcript, kept whole. Absent until the recording exists.    |
| `../../fixtures/replays/stripe-replay.json` | The recording itself, which `rigorrun demo` and the site replay.                                   |

## How it is made

Everything goes through `packages/cli/scripts/record-stripe-replay.ts`, which enforces the
pre-registration rather than trusting whoever runs it. It takes the path a person takes: the twin
(or Stripe test mode), `rigorrun stripe init`, `rigorrun agent add --black-box` for each variant,
and `rigorrun run --project … --case …` over the seven pre-registered cases, one attempt each, once
per variant — in a temporary RigorRun home whose secrets never touch the machine's keyring.

```bash
# 1. Pilots, on the twin, until the harness works. Each is appended to pilot-log.md.
OPENAI_BASE_URL=http://127.0.0.1:11434/v1 pnpm tsx packages/cli/scripts/record-stripe-replay.ts \
  --pilot --system twin --provider openai --model qwen3:8b --temperature 0 \
  --out /tmp/pilot-replay.json --note "what changed since the last pilot, and why"

# 2. The freeze. Commit everything first: it refuses uncommitted product changes.
GEMINI_API_KEY=… pnpm tsx packages/cli/scripts/record-stripe-replay.ts --freeze \
  --system live --provider gemini --model <id> --temperature <value> --temperature-source <url>

# 3. The recording, with exactly the frozen flags. STRIPE_TEST_KEY for --system live.
GEMINI_API_KEY=… STRIPE_TEST_KEY=… pnpm tsx packages/cli/scripts/record-stripe-replay.ts \
  --system live --provider gemini --model <id> --temperature <value> --temperature-source <url>

# 4. Look at it as the demo will show it.
pnpm rigorrun demo
```

## What the script refuses

| Rule (where it comes from)                                             | Refused when                                                                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The temperature comes from the model's documentation (Amendment 1)     | a temperature other than 0 has no `--temperature-source` URL; an agent's `GET /meta` reports a different temperature, or none while a non-zero one is asked for          |
| The model, prompt and tools are fixed at the freeze (Pilot; Recording) | there is no `freeze.json`; the flags differ from it; either agent's prompt or tool hash differs from the frozen one                                                      |
| The freeze names the product commit (Pilot)                            | a freeze or a recording with uncommitted changes under `packages/`, `examples/stripe-support-agent/` or the workspace manifests; product changes since the frozen commit |
| ListModels is called with the available key (Model)                    | at the freeze, with `--provider gemini`, the model is not offered for `generateContent`; the list is kept in `freeze.json`                                               |
| One recording per variant: 7 cases, 1 attempt (Recording)              | a stored run is not one variant's, or does not cover the seven cases once each                                                                                           |
| The first complete recording is final (Recording)                      | a recording exists, unless `--discard "<reason>"` is given and it holds a `HARNESS_FAILURE` or `AGENT_FAILURE` case                                                      |
| A discarded attempt and its cause are listed (Recording)               | never silently: a replaced recording, and every attempt that never completed (`recording/incomplete-attempts.json`), go into the new file's `discarded`                  |
| A pilot is not evidence (Pilot)                                        | a pilot without `--note`, or with `--out` under `fixtures/` or `recording/`; a pilot file says `"pilot": true`, and the CLI build refuses to bundle one                  |
| `simulated` wherever the twin is named (What is recorded)              | the run's own `simulated` limit disagrees with `--system`                                                                                                                |
| No key in a kept file                                                  | any transcript contains a key's value or `key=`; then no transcript is kept                                                                                              |

## What the recording holds

`fixtures/replays/stripe-replay.json`, format `rigorrun/replay/1`: `recordedAt`, `model`,
`provider`, `temperature`, `temperatureSource`, `commit`, `system` ("Stripe test mode" or "a local
Stripe twin (simulated)"), `simulated`, `variants` (each one's agent id, its description, its
prompt and tool hashes from `/meta`, and the id and sealed hash of the stored run its cases came
from), `discarded`, `harness`, `benchmark` (the seven cases exactly as run, held to the run's own
`benchmarkHash`), `presentation` (the headline rule as the pre-registration states it, what to
call the work, what to do next), `resultHash` (sha256 of `JSON.stringify(run)`) and `run`.

`run` is the two stored runs side by side: every case result and score untouched, the verdict by
the runner's own rule over those scores, the hash sealed as the runner seals one. The two runs
themselves are in `recording/runs/`, so the combination can be checked against them.

## How it is shown

`rigorrun demo` (`packages/cli/src/replay.ts`) prefers this recording when the build carries it,
and `rigorrun demo --northstar` replays the older synthetic one. It prints the provenance (model,
temperature, provider, system, date, commit), each variant in its fixed words, the headline case
by the pre-registered rule — the ticket, what the agent said, what Stripe shows, the verdict with
its strength read from the result — then every case for both variants, and the counts. If neither
variant failed a case, it says exactly that.

## Open before the freeze

- **The reference agent cannot yet run at a temperature other than 0.** `models.mjs` sends 0 to
  both providers and `GET /meta` does not report a temperature. Amendment 1 puts a Gemini 3 model
  at its documented 1.0, so before that freeze the agent has to take the temperature (the script
  passes it as `TEMPERATURE`) and report it in `/meta` as `temperature`. Until then the script
  refuses any non-zero temperature rather than record one the agent did not use.

## Found after recording (2026-10-02)

**Temperature.** Amendment 2 recorded gpt-oss-120b at 0 because "neither the model card nor Groq's
page for the model recommends a value". OpenAI's own gpt-oss README (github.com/openai/gpt-oss,
"Recommended Sampling Parameters") recommends `temperature=1.0` and `top_p=1.0`, so Amendment 1's
rule, as written, gives 1.0. The check missed the README. The recording ran at 0; what it would
show at 1.0 has not been measured. It is not re-recorded — the first complete recording is final —
and the fault is listed beside it (`errata` in `fixtures/replays/stripe-replay.json`, shown on
rigorrun.xyz/replay).
