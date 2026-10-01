# Amendment 2: the provider, because no Gemini free tier can finish the recording

Written 2026-10-01. The first recording attempt did not complete. No recording on the new provider
has been started.

## What happened

The pre-registration picks "the strongest Gemini model with function calling whose free-tier quota
can finish both variants (14 case runs plus their tool calls)".

- **The first attempt** used `gemini-3.8-flash`, chosen by ListModels and a one-request probe
  (`pilot-log.md`, pilot 2). It stopped after 2 of the 14 case runs. Every later model request was
  answered 429.
- **The quota** is `GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20` for
  `gemini-3.8-flash`, read from the error's own details.
- **The next Flash model**, `gemini-3.5-flash`, has the same 20 requests a day, and 5 a minute. This
  was measured by probing it until it answered 429 with that quota id.
- **The Pro-class models** have no free-tier quota at all (429 on `gemini-3.1-pro-preview`), or are
  closed to new users (404 on `gemini-2.5-pro`).

A recording needs roughly 60–100 model requests. No Gemini model's free tier can finish it. The
pre-registration's own condition is therefore unmet for every Gemini model. The owner chose not to
enable billing.

## The change

**Provider.** Groq, on its free tier, through the reference agent's OpenAI-compatible path. Fixed
before any Groq request is made:

| Field       | Value                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base URL    | `https://api.groq.com/openai/v1`                                                                                                                                                                 |
| Model       | `openai/gpt-oss-120b` if the key's model list shows it active, otherwise `llama-3.3-70b-versatile`                                                                                               |
| Temperature | 0. Neither the model card (huggingface.co/openai/gpt-oss-120b) nor Groq's page for the model (console.groq.com/docs/model/openai/gpt-oss-120b) recommends a value, so Amendment 1's rule gives 0 |

`openai/gpt-oss-120b` has been RigorRun's default Groq model since before this recording
(`packages/providers/src/resolve.ts`).

**Pilot first.** A one-case pilot on the twin checks that tool calls work, as with Gemini. Then
there is a new freeze. The Gemini freeze is kept as `freeze-1-gemini.json`.

**What the demo must say.** Everywhere the demo names its model, it names this model, Groq, and
this amendment. Nowhere may it say "Gemini".

**The discarded attempt.** The Gemini attempt is listed in the new recording's `discarded`, with
its cause: free-tier quota.

## Unchanged

The variants, the tools and their descriptions, the system prompt, the cases, the one-attempt rule,
"the first complete recording is final", and the headline rule.
