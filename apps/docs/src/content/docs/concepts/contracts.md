---
title: Contracts and rules
description: How one demonstration becomes a set of rules, what each rule status means, and which of them are allowed to fail your agent.
---

A **contract** is what RigorRun worked out from your demonstration. It holds observed facts and
proposed rules, each traceable to the step it came from.

## Rule statuses

| Status | Meaning | Can it block a release? |
| --- | --- | --- |
| `observed` | The demonstration literally shows this. Deterministic. | yes |
| `inferred` | RigorRun generalised from what it saw. | no — explores only |
| `confirmed` | A person said yes to an inferred rule. | yes |
| `rejected` | A person said no. | never |

Only `observed` and `confirmed` may produce a release-blocking check. That is asserted by test
rather than left to the interface.

## Why it over-proposes

RigorRun proposes more rules than it expects you to keep. The asymmetry is deliberate: missing a real
rule means an agent ships with a hole in its acceptance suite, while proposing one you do not want
costs you a click. Rejecting a rule is free.

Rules it is least sure about are shown first, each with the evidence behind it, so you are
disagreeing with evidence rather than with a verdict.

## What it cannot know

RigorRun reads the shape of the data and never the names of things — that is what lets it work on a
business it has never seen. It is also why some things have to be asked:

- Is this number money, a count, or a quantity?
- Is this field the person who did it, or the person it was done for?
- Was this ordering a rule, or the order this one demonstration happened in?

Each question shows what it saw. Where it genuinely cannot decide, it asks rather than guessing and
labelling the guess as a fact.
