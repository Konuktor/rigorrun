---
title: A black-box agent
description: Your agent with no change to its code, wherever it runs. RigorRun sends it the work, then reads the system itself and judges what changed.
---

The fastest way to test an agent you already have, with no change to its code: it keeps its own
tools, its own SDKs, its own credentials and its own deployment — your laptop, staging, the cloud.
RigorRun posts each case's work to the endpoint the agent already serves (in your request shape,
with a [body template](#what-rigorrun-sends)), waits for the answer, and then reads the system
through **its own connection** to decide what actually happened. What the agent must share with
RigorRun is the system: the same staging database, or the same Stripe test account — or, for
Stripe's local twin, a Stripe base URL pointed at the twin.

That makes every verdict `INDEPENDENT`: the agent never touched the connection the result was read
through, and its own account of what it did is shown next to the evidence and never scored.

## What you need

- An address your agent takes work on — a staging API, a webhook, a local server.
- The agent working on the same system this project reads (the same staging database, the same
  Stripe test account, the same MCP server's backend).

## Connect it

In the interface, at the agent step, choose **It is running already — send it the work, then check
the system**, and give the address. Off this machine RigorRun only uses `https`, never follows a
redirect, and only sends work to a host you explicitly agree to.

Or in a setup spec:

```json
{
  "agents": [
    {
      "name": "Support agent (staging)",
      "blackBox": {
        "endpoint": "https://staging.example.com/agent/tickets",
        "allowedHosts": ["staging.example.com"],
        "headers": { "authorization": "STAGING_AGENT_TOKEN" },
        "bodyTemplate": "{\"message\": \"{{task.text}}\", \"ticketId\": \"{{caseId}}\"}",
        "claimPath": "reply.text"
      }
    }
  ]
}
```

Header values are **secret names**, never values: set the value once with
`npx rigorrun secrets set STAGING_AGENT_TOKEN`, or in CI as `RIGORRUN_SECRET__STAGING_AGENT_TOKEN`.

The address is stored in the project, so it may not carry a credential: one whose query has a
parameter named like `key`, `api_key`, `token`, `secret`, `password`, `auth`, `signature` or `sig`,
or a value starting `sk_`, `rk_`, `pk_` or `whsec_`, is refused. Wherever an agent is listed, its
address is shown without its query.

## What RigorRun sends

With no `bodyTemplate`, each case arrives as `rigorrun/task/1`:

```json
{
  "protocol": "rigorrun/task/1",
  "caseId": "case_live__existing_bookingId_BKG-4002",
  "task": {
    "text": "Confirm a held booking.\n\nbookingId: BKG-4002",
    "instruction": "Confirm a held booking.",
    "inputs": { "bookingId": "BKG-4002" },
    "policyBrief": "…the rules a person confirmed…"
  }
}
```

with an `Idempotency-Key` header unique to the attempt. Answer `{"ok": true}` to
`{"protocol": "rigorrun/task/1", "probe": true}` so the connection can be checked without doing any
work.

With a `bodyTemplate`, RigorRun sends the JSON your endpoint already accepts, filling
`{{task.text}}`, `{{task.instruction}}`, `{{inputs.<name>}}` and `{{caseId}}`. Values are escaped, so
a ticket containing a quote cannot rewrite the request around it.

## When it is finished

| `completion`         | Your endpoint                              | RigorRun                                                                                                         |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `response` (default) | answers when the work is done              | reads the system after the answer; a `202 Accepted` ends the case as the agent not finishing, never as a verdict |
| `poll`               | answers `202 {"statusUrl": "…"}`           | polls the status address (same host rules) until `completed`, `failed` or `declined`                             |
| `settle`             | answers straight away and works afterwards | waits `settleQuietMs`, then reads the system                                                                     |

Whatever it answers at `claimPath` is recorded as the agent's claim and shown next to what the system
holds.

## What a black-box run does not check

RigorRun does not see the agent's calls, so checks about their **order** — "record the sign-off
before confirming" — are listed on every result as not made. Everything the system holds afterwards
is checked in full: that the work was done, done to the right record, with the right values, that a
sign-off the job needs is recorded, and that nothing else changed. Connect the agent through the MCP
proxy as well (glass-box) to have its calls checked too.

A black-box agent writes to the system directly, where RigorRun cannot refuse anything, so it is never
run against a system marked production.
