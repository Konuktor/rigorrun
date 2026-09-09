---
title: How agents are driven
description: RigorRun hands your agent one task at a time and a URL to work through. The checks are never sent.
---

RigorRun gives your agent one task at a time and a URL to work through. Your agent connects to that
URL, works however it normally works, and says when it is done.

## What an agent receives

The **public** half of a case: the task, in the words you wrote when you created the project, plus
the tools it may use. Your agent is given exactly those words, so write them for a reader who knows
nothing.

## What it never receives

The **private** half: the checks and the reference plan. These are stripped before a case leaves
RigorRun, so there is nothing to read the answer from. The split is enforced by the type, and there
is a test asserting a public case view carries no assertions.

## Three ways to connect

| | When to use it |
| --- | --- |
| [**HTTP**](/agents/http/) | Your agent listens on an address RigorRun can reach. |
| **Process** | Your agent is a command on this machine; RigorRun starts it. |
| [**Driven**](/agents/driven/) | RigorRun cannot start or reach it — your loop pulls work instead. |

## What is scored

What changed in your system. Your agent's own report of what it did is displayed on every case,
labelled **not scored**, and never affects a verdict.

That is deliberate and it is the point of the product: an agent that reports success and an agent
that achieved it are indistinguishable from the transcript.
