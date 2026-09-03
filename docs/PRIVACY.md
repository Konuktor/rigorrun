# Privacy

Privacy is not a feature bolted onto RigorRun; it is the reason the
architecture looks the way it does. The recording of how your company works is
the sensitive artefact, and the safest place for it is the machine that made it.

## The default

**Nothing leaves your device.**

`pnpm demo`, the CLI, the dashboard and the benchmark make zero network
requests. The end-to-end suite asserts this by failing the test if any request
leaves the local origin.

## What the recorder captures

The recorder stores the **meaning** of an interaction, never the page.

Captured:

- Event type: navigate, click, input, change, select, submit
- Sanitised URL and a redacted page title
- Element role, accessible name, `data-testid`, stable id, label, placeholder
- A ranked list of selectors, ordered by durability
- Up to 240 characters of nearby text, redacted — enough context to understand
  the step, not a page snapshot
- Redacted input values, where the field is not credential-like
- Optional semantic observations an instrumented application chooses to emit

Never captured:

- Page HTML, `innerHTML`, or a DOM dump
- Screenshots
- Cookies, headers or auth tokens
- The value of any `password` or `hidden` input
- The value of any field whose `autocomplete` is `current-password`,
  `new-password`, `one-time-code`, `cc-number`, `cc-csc` or `cc-exp*`
- The value of any field whose name, id, label or placeholder matches a
  credential pattern

A field whose value is skipped still produces an event, so the workflow remains
understandable, and the popup shows a running count of how many fields were
skipped.

## Redaction

One module is the chokepoint for everything that gets stored.

**Field names** matched case-insensitively, allowing space, `-` and `_` as
separators: `password`, `passwd`, `passphrase`, `pwd`, `secret`, `token`,
`api key`, `apikey`, `authorization`, `auth`, `bearer`, `credential`,
`passcode`, `session id`, `sid`, `cvv`, `cvc`, `card number`, `ccnum`, `pin`,
`otp`, `one time code`, `mfa`, `2fa`, `private key`, `access key`,
`client secret`, `signature`, `ssn`, `social security`.

**Value shapes**, redacted wherever they appear regardless of field name: PEM
private key blocks, JWTs, `sk-…`, `gsk_…`, `AIza…`, `ghp_…`, `xox[baprs]-…`,
`glpat-…`, `AKIA…`, `Bearer …`, and card numbers that pass the Luhn checksum.

The Luhn check matters: it keeps a 13-digit order number out of the
false-positive bucket while still catching `4242 4242 4242 4242`.

**URLs** lose embedded userinfo entirely, and any query or fragment parameter
whose name is credential-like or whose value is secret-shaped:

```
https://app.com/reset?token=ABC        →  https://app.com/reset?token=%5BREDACTED%5D
https://alice:hunter2@app.com/x        →  https://app.com/x
https://app.com/orders?customerId=C-1  →  unchanged
```

**Headers** `authorization`, `proxy-authorization`, `cookie`, `set-cookie`,
`x-api-key`, `x-auth-token`, `x-csrf-token`, `x-amz-security-token` are dropped
wholesale.

The policy is deliberately over-broad. A false positive costs a slightly less
useful trace; a false negative writes a customer's password to disk.

56 tests cover this module directly.

## Where things are stored

| Artefact              | Location                                | Leaves the device? |
| --------------------- | --------------------------------------- | ------------------ |
| Trace                 | `.rigorrun/traces/` or your chosen path | No                 |
| Contract, benchmark   | `.rigorrun/`                            | No                 |
| Run results, evidence | `.rigorrun/runs/`                       | No                 |
| HTML report           | Where you asked for it                  | No                 |
| Recording in progress | Extension-local storage                 | No                 |

`.rigorrun/` is gitignored.

## The recorder's reach

The extension's manifest grants exactly two host permissions:

```json
"host_permissions": ["http://localhost/*", "http://127.0.0.1/*"]
```

It has no permission to contact any remote host, so it cannot upload a trace
even if it were asked to. "Send to local RigorRun" posts to
`127.0.0.1:<port>/trace`, which is a listener you started yourself and which
stops after receiving one trace.

_Verified in `e2e/extension.spec.ts`, which asserts the manifest's host
permissions._

## The optional control plane

If you deploy the Cloudflare Worker, these are sent — and only these:

**Workflow:** id, name, goal, environment, contract hash, counts of observed /
inferred / confirmed rules, number of open questions, and per-case id, name,
category and check count.

**Run:** id, benchmark hash, contract hash, result hash, environment, agent
count, case count, verdict text, winner id, timestamps, and per-case-result the
case id, agent id, category, pass/fail booleans, unsafe count and duration.

There is no endpoint that accepts a trace, a tool argument, an agent report, an
assertion's observed value, or any page content. That is enforced by schema, not
by policy: a client bug cannot leak a workflow to the cloud because there is no
field to put one in.

## Publishing a report

Publishing is explicit, and shows a preview of exactly what would leave before
anything does.

**Removed:** task inputs; tool arguments and results; assertion evidence
(observed and expected values); assertion messages; agent prose; final state
summaries; case names; and any record identifier (`CUST-2016`, `ORD-3001`) or
money amount appearing inside a check description.

**Kept:** scores and confidence intervals; per-check PASS/FAIL/ERROR outcomes;
category labels; agent labels; benchmark, contract and result hashes;
timestamps.

Removal is structural — private fields are dropped, not scrubbed — so nothing
survives by being formatted unusually.

Published reports carry an expiry (30 days by default) and are purged.

## Deleting your data

```bash
rm -rf .rigorrun                 # every local artefact
```

Control plane: `DELETE /api/workflows/:id` removes a workflow and its cases;
published reports expire automatically.

## Model providers

If you configure Groq, Gemini or an OpenAI-compatible endpoint, the case
instruction, the policy brief and the tool results for that case are sent to
that provider under **your** key and their terms. RigorRun does not proxy it.
With no provider configured — the default — no request is made to anyone.
