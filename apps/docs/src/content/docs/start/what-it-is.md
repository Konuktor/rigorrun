---
title: What RigorRun is
description: RigorRun tests an AI agent that takes real actions — first of all a support agent that issues Stripe refunds — by reading the system afterwards, never by trusting what the agent said it did.
---

You have an agent that takes real actions — most often, a support agent that issues refunds in
Stripe. You need to know whether it does the right thing on the tickets that matter: the refund
that is owed and nothing else, no refund on a disputed payment, never somebody else's payment,
never the same item twice. And you need to know again next week, after somebody changes the model
or the prompt.

RigorRun sends your agent support tickets, lets it work with its own key, then reads Stripe itself
— your test mode, or a local twin with no keys — and decides each ticket on what Stripe holds
afterwards. What the agent said it did is shown beside that, labelled, and never scored.

```
transcript evals:   read what the agent said  →  a person or a model grades it
        RigorRun:   read Stripe afterwards    →  what it did, beside what it said
```

Start with [Test a Stripe refund agent](/start/stripe/): a local twin, your agent over HTTP, a
canary and a gate.

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
