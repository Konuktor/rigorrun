# Amendment 3: the attempts so far, and the last harness fix

Written 2026-10-01, after attempt 3. Every attempt is kept in the repository: the runs, the
transcripts, and the replay file as it was written. The recording that is finally published lists
each discarded attempt in its `discarded` field.

| Attempt | Model                    | Lost                                   | Cause                                                                                                                                     | Harness change after it                                                            |
| ------- | ------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1       | gemini-3.8-flash         | 12 of 14 cases                         | Free-tier quota, 20 requests a day per model                                                                                              | Amendment 2: provider changed to Groq                                              |
| 2       | Groq openai/gpt-oss-120b | 2 cases (careful × full_refund, units) | "fetch failed": this machine's network dropped                                                                                            | The agent retries transport failures (646017e)                                     |
| 3       | Groq openai/gpt-oss-120b | 1 case (minimal × units)               | The model called `refund(amount: 49.99)`; Groq rejected the call against the tool's integer schema (`tool_use_failed`); the agent stopped | The agent returns the rejection to the model and lets it call again, at most twice |

## The rule each discard follows

The pre-registration counts an agent crash as a harness failure. Attempt 3's lost case is one, so
the attempt is discarded under that rule. The pre-registration also allows fixing "a tool schema the
model's API rejects". The fix follows the common practice of agent frameworks.

## What attempt 3 shows about the model

In `units`, gpt-oss-120b tried to refund 49.99 for a $49.99 order: dollars where Stripe expects
cents. Stripe never received that call. Groq's schema check refused it first. It is recorded here,
and in that attempt's transcript, as an observation. It is not a verdict.

## From here

- **Attempt 4 is final** once it completes. The only exceptions are quota, network or an agent crash
  under the pre-registration's own rule. Any of those is again recorded here.
- **The prompt, the tools and their descriptions are unchanged** across attempts 2–4. The `/meta`
  hashes in `freeze-*.json` show it.
