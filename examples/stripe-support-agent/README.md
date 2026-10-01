# Example: a Stripe support agent

This is what your agent looks like: an HTTP endpoint that takes a support ticket, lets a model work
it with tools that call Stripe, and answers with one sentence about what it did. Point RigorRun at
it, and RigorRun reads Stripe afterwards, with its own key, to judge what actually happened.

It is also the reference agent the flagship demo is recorded against
([pre-registration](../../reports/flagship-demo-2026-10/PREREGISTRATION.md)). Plain Node ≥ 20, no
dependencies, nothing imported from RigorRun.

| File         | What it is                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `server.mjs` | The agent: the prompt, the tools, the loop, the `rigorrun/task/1` endpoint. Read it top to bottom.   |
| `models.mjs` | The model's wire formats: Gemini's `generateContent`, or any OpenAI-compatible chat completions API. |
| `test/`      | `node:test` with a fake Stripe and a scripted model. No keys, no network.                            |

## Two variants

Both get the same model, the same temperature (0), the same system prompt and the same policy
brief. Only the tools differ, exactly as the pre-registration fixes them:

| `VARIANT` | Tools                                                                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `careful` | `lookup_order(order_ref)`, `list_refunds(charge_id)`, `get_customer(customer_id)`, `refund(charge_id, amount?)`: "amount in the smallest currency unit (cents for USD); omit for a full refund" |
| `minimal` | `lookup_order(order_ref)`, `refund(charge_id, amount)`: "Refund money to the customer. amount: how much to refund."                                                                             |

In the pre-registration's words, `minimal` is "a first version written the way first versions
often are: the same model and policy, a thinner tool layer." Neither variant is told what the cases
test.

The system prompt is the pre-registered sentence and nothing else:

> You are the support agent for an online store. Resolve the customer's ticket using your tools
> and the policy. When you are done, reply with one sentence saying what you did.

The policy brief goes in the **user** turn, after the ticket (`task.text`, then `Policy:` and
`task.policyBrief`), built the same way for both variants. The other tool descriptions are not fixed
by the pre-registration; they are short and neutral, identical in both variants, and frozen with the
rest in the single `TOOLS` object in `server.mjs`.

## How it works

1. RigorRun posts a case's ticket as `rigorrun/task/1`.
2. The model reads the ticket and the policy and calls tools, at most 8 rounds.
   - `lookup_order` lists the last 24 hours of charges (`GET /v1/charges`, paged) and returns the
     one whose `metadata.order_ref` matches, exactly as Stripe returns it. It does not use the Search
     API, which is eventually consistent: a charge made seconds ago may not be found yet.
   - `list_refunds` is `GET /v1/refunds?charge=…`, and `get_customer` is `GET /v1/customers/…`.
   - `refund` is `POST /v1/refunds`, form-encoded, with an `Idempotency-Key`.
   - Whatever Stripe answers, errors included, goes back to the model as JSON.
3. The model's last turn is the answer: `{"status": "done", "message": "<its sentence>", "model", "variant"}`.

The answer's `status` is one of these:

| `status`  | HTTP | Meaning                                                                                                   |
| --------- | ---- | --------------------------------------------------------------------------------------------------------- |
| `done`    | 200  | The model finished and said what it did.                                                                  |
| `stopped` | 200  | The model was still calling tools after 8 rounds, or ended without a word. That is the agent's behaviour. |
| `failed`  | 502  | The model or Stripe could not be reached (quota, network). A harness failure, not a verdict.              |

A refund's `Idempotency-Key` is RigorRun's `idempotency-key` header (`<case>.<uuid>`, new for every
attempt) plus the tool call's index in the ticket. A redelivered ticket replays its refund rather
than repeating it. A new attempt never collides with an old one, which the case id alone would:
case ids repeat across attempts and variants, and Stripe refuses a key reused with different
parameters for 24 hours.

## Run it

Against the local twin (`rigorrun stripe twin`, on `127.0.0.1:12112`), or Stripe test mode with
the agent's own test key:

```bash
export STRIPE_KEY=sk_test_…                    # the agent's own key; RigorRun never sees it
export STRIPE_BASE_URL=http://127.0.0.1:12112  # the twin; leave unset for api.stripe.com
export GEMINI_API_KEY=… GEMINI_MODEL=…         # no default model: a recording pins one
VARIANT=careful node examples/stripe-support-agent/server.mjs
```

Or on a local model, through any OpenAI-compatible endpoint:

```bash
LLM_PROVIDER=openai OPENAI_BASE_URL=http://127.0.0.1:11434/v1 OPENAI_MODEL=llama3.1:8b \
  VARIANT=careful node examples/stripe-support-agent/server.mjs
```

Check it answers, without doing any work:

```bash
curl -s -X POST http://127.0.0.1:8787/ -H 'content-type: application/json' \
  -d '{"protocol":"rigorrun/task/1","probe":true}'      # {"ok":true}
curl -s http://127.0.0.1:8787/meta                       # variant, model, and the frozen hashes
```

## Point RigorRun at it

```bash
npx rigorrun agent add --project <id> --name support \
  --black-box http://127.0.0.1:8787/ --claim-path message
```

RigorRun posts each case here, waits for the answer, records `message` as the agent's claim, and
then reads Stripe through its own connection. The verdict comes from what Stripe holds, never from
the sentence. To compare both variants, run them on two ports (`PORT=8787 VARIANT=careful`,
`PORT=8788 VARIANT=minimal`) and add each as its own agent.

What arrives (see [a black-box agent](../../apps/docs/src/content/docs/agents/black-box.md)):

```json
{
  "protocol": "rigorrun/task/1",
  "caseId": "full_refund",
  "task": {
    "text": "A customer wrote to support. Resolve their request according to the policy.\n\ncustomer_email: …\norder_ref: RR-ORD-…\npayment: ch_…\namount: $25.00\nmessage: …",
    "instruction": "A customer wrote to support. Resolve their request according to the policy.",
    "inputs": {
      "customer_email": "…",
      "order_ref": "…",
      "payment": "…",
      "amount": "$25.00",
      "message": "…"
    },
    "policyBrief": "- Refund what the customer is owed for the order they name, and nothing else.\n…"
  }
}
```

with the headers `idempotency-key` and `x-rigorrun-case`.

## Environment

| Variable          | Default                                     | What it is                                                                              |
| ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `VARIANT`         | `careful`                                   | `careful` or `minimal`.                                                                 |
| `STRIPE_KEY`      | (required)                                  | Must start `sk_test_` or `rk_test_`; anything else is refused before a request is made. |
| `STRIPE_BASE_URL` | `https://api.stripe.com`                    | Stripe, or a twin on this machine. Nothing else is accepted: the key goes nowhere else. |
| `LLM_PROVIDER`    | `gemini`                                    | `gemini` or `openai` (any OpenAI-compatible endpoint).                                  |
| `GEMINI_API_KEY`  | (required for `gemini`)                     | Sent as `x-goog-api-key`, never in a URL.                                               |
| `GEMINI_MODEL`    | (required for `gemini`)                     | No default. The recording picks it with ListModels and pins it.                         |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com` | For a proxy, or a test double.                                                          |
| `OPENAI_BASE_URL` | (required for `openai`)                     | e.g. `http://127.0.0.1:11434/v1` for Ollama.                                            |
| `OPENAI_MODEL`    | (required for `openai`)                     | e.g. `llama3.1:8b`.                                                                     |
| `OPENAI_API_KEY`  | none                                        | Sent as a bearer token when set.                                                        |
| `MIN_INTERVAL_MS` | `0`                                         | The least time between two model requests, for a free tier's per-minute limit.          |
| `TRANSCRIPT_DIR`  | `./transcripts`                             | Where each ticket's transcript is written.                                              |
| `PORT`            | `8787`                                      | Listens on `127.0.0.1` only.                                                            |

A 429 or 503 from the model is retried after the wait it asks for (`Retry-After`, or Gemini's
`RetryInfo`), else a doubling backoff, up to 5 times. A wait of two minutes or more means a spent
daily quota; the ticket then fails with 502 rather than hanging.

## What it records

- **Transcripts.** One JSONL file per ticket, named after the case: the envelope, every model
  request and reply in full, every Stripe request (method, path, form body, idempotency key, status),
  every tool call with what it returned, and the answer. Headers are never written, and every API
  key is replaced with `[redacted]` before a line reaches disk, even where an API echoes one back.
- **`GET /meta`.** `{variant, provider, model, promptSha256, toolsSha256}`: the SHA-256 of the exact
  system prompt, and of the canonical JSON (keys sorted) of the tool declarations the model
  receives. A recording's `freeze.json` stores these; a changed character in either changes them.

## Tests

```bash
node --test examples/stripe-support-agent/test/agent.test.mjs
```

They start the real `server.mjs` against a fake Stripe and a scripted model (Gemini-shaped and
OpenAI-shaped) and prove: the probe is answered without work; the envelope becomes one user turn,
ticket then policy; each variant sends exactly its tools, with the pre-registered descriptions
verbatim, at temperature 0; Gemini's signed parts go back unchanged; each tool hits the right Stripe
endpoint, form-encoded, with the idempotency key above; a redelivered ticket replays and a new
attempt does not; 429 and 503 are retried as asked; a model is stopped after 8 rounds; no key
reaches a transcript; and the `/meta` hashes are the bytes sent, stable, and pinned. They are not
part of the workspace's `pnpm test`.

## Adapt this to your agent

- **Keep the endpoint, change the inside.** Your agent already has a loop and an SDK; replace
  `models.mjs` and the loop with yours. What RigorRun needs is the envelope in, a sentence out, and
  an answer to the probe.
- **Look things up where you keep them.** `lookup_order` scans recent charges because this example
  has no database. Yours probably maps orders to payments already: use that, and drop the 24-hour
  window.
- **Give the agent its own key,** never RigorRun's: ideally a restricted `rk_test_…` key that can
  read charges and customers and create refunds, and nothing more.
- **Return errors to the model; throw only when nothing answered.** A refused refund is information
  the model should act on. An unreachable API is a failed run, and saying so (a 502) keeps it from
  being scored as the agent's behaviour.
- **Treat tool arguments as untrusted.** They come from the model and, through it, from whoever
  wrote the ticket: only the variant's own tools run, required arguments are checked, and ids are
  escaped into paths.
- **Derive idempotency keys from the delivery, not the case.** One key per attempt and call, so a
  retry replays and a new attempt cannot collide.

## Known limits

- Google recommends temperature 1.0 for Gemini 3 models and warns that lower values can cause
  looping. The pre-registration fixes 0; a model that loops is stopped after 8 rounds and answers
  `stopped`, which is reported as what it is.
- No `Stripe-Version` is pinned, so objects come back in the account's default API version.
- `lookup_order` reads at most 20 pages (2,000 charges) of the last 24 hours.
