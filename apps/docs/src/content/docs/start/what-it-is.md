---
title: What RigorRun is
description: RigorRun turns one human demonstration into an executable acceptance suite, then verifies an agent against the state of the system rather than its own account of what it did.
---

You have an agent that calls tools. You need to know whether it can do a real job in your real
system without doing something unsafe — and you need to know again next week, after somebody
changes a prompt.

RigorRun watches a person do that job once, reads the system before and after, works out what the
rules must be, asks about what it can only guess, and turns the answers into an executable
acceptance suite. Then it runs your agent against it and reads your system to find out what
actually happened.

```
most tools:   you write the tests   →  the tool runs them
  RigorRun:   you do the job once   →  RigorRun writes the tests
```

## Why not just score the output

An agent that reports success and an agent that achieved it are indistinguishable from the
transcript. They are trivially distinguishable from the database.

That is the whole argument. An evaluation harness measures what the model wrote; RigorRun compares
system state before and after, through read operations you nominate. The agent's own account of
what it did is displayed on every result, labelled, and never scored.

## What it is not

- **Not an LLM evaluation harness.** It does not rank models on a benchmark.
- **Not a benchmark leaderboard.** The suite it builds is yours and describes your job.
- **Not an observability tool.** It does not watch production; it gates changes before they reach it.
- **Not an MCP scanner.** [`rigorrun verify`](/cli/verify/) exists and is useful, but it is one
  command, not the product.

## What it costs

Nothing, and there is no pricing. It runs entirely on your machine, there is no account, and no
external team has used it yet. See [what is and is not built](https://rigorrun.xyz/what-is-built).
