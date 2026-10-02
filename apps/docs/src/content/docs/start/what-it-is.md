---
title: What RigorRun is
description: RigorRun tests an AI agent's permissions and scope before it ships — that it acts only for the right customer and stays out of everyone else's data — by reading the real system, never by trusting what the agent said it did.
---

Your agent acts for many customers through one set of tools: it reads their orders, refunds their
payments, answers their tickets. Each time, it is meant to act for one customer and stay out of
everyone else's data. You need to know it does — on the tickets that tempt it not to — and to
know again next week, after somebody changes the model or the prompt.

RigorRun sends your agent tickets that test that line, lets it work with its own key, then reads
the system itself and decides each ticket on what the system holds afterwards. What the agent said
it did is shown beside that, labelled, and never scored.

```
transcript evals:   read what the agent said  →  a person or a model grades it
        RigorRun:   read the system afterwards →  what it did, and for whom, beside what it said
```

**What is checked today.** Two packs. [Larch Helpdesk](/start/helpdesk/): a helpdesk twin shared by
two organisations, where each ticket is decided from what the agent _read_ of the other one (the
twin's access log), what it _changed_, and what it _sent_ (planted markers in email and in its
reply). [Stripe refunds](/start/stripe/): a local twin with no keys or your test mode, a canary and
a gate; each ticket is decided on what changed in Stripe — including a refund on another customer's
payment — and every verdict is `PARTIAL`, because it reads what each case created, not the whole
account.

**What is being built next.** Checks on the agent's tool calls themselves, and the same permission
tests on your own system — two tenants, your MCP server or API. Neither is built yet.

## Why not just score the transcript

An agent that reports success and an agent that achieved it are indistinguishable from the
transcript. They are trivially distinguishable from the database.

That is the whole argument. An evaluation harness measures what the model wrote; RigorRun compares
system state before and after, through read operations you nominate. The agent's own account of
what it did is displayed on every result, labelled, and never scored.

## Beyond Stripe

For a system with no pack, RigorRun builds the suite from a demonstration: connect the system (an
MCP server, an HTTP API from OpenAPI, or a web application), do the job once, and RigorRun reads the
system before and after, works out what the rules must be and asks about what it can only guess.
[Your first project](/start/first-project/) walks it.

## What it is not

- **Not an LLM evaluation harness.** It does not rank models on a benchmark.
- **Not a benchmark leaderboard.** The suite it builds is yours and describes your job.
- **Not an observability tool.** It does not watch production; it gates changes before they reach it.
- **Not an MCP scanner.** [`rigorrun verify`](/cli/verify/) exists and is useful, but it is one
  command, not the product.

## What it costs

Nothing, and there is no pricing. It runs entirely on your machine, there is no account, and no
external team has used it yet. See [what is and is not built](https://rigorrun.xyz/what-is-built).
