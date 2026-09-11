---
title: Your first project
description: Connect a system, demonstrate one job, and rule on what RigorRun worked out from it.
---

A project is one job you want an agent to do, in one of your systems. Everything about it — the
connection, what it learned, your recordings, your credentials — stays on this machine, and you can
stop at any point and pick it up later.

## 1. Connect your system

Pick what your agent actually does:

| Your agent | Connection | What a verdict can be |
| --- | --- | --- |
| Uses tools | [MCP server](/systems/mcp/) | `PARTIAL` — read back through the operations you nominate |
| Calls an API | [OpenAPI document](/systems/openapi/) | `PARTIAL` — same |
| Clicks around a page | [Browser](/systems/browser/) | `OBSERVATIONAL` — watched, not read back |

Mark the environment honestly. A project marked `production` cannot mutate at all: your agent still
gets to try, and you see what it would have done.

## 2. Say what RigorRun may use

RigorRun shows you everything the system can do and asks two things it cannot work out from the
outside:

- **Which tools only look.** Your system can say so itself, and RigorRun shows you when it does —
  but it will not take a system's word about its own safety.
- **Which tools it should use to check what happened.** These are called after your agent finishes.
  This is the whole reason a result can be trusted, and RigorRun will not let you continue without
  at least one.

If you can also nominate something that puts the system back, say so. RigorRun calls it before every
case so each one starts from the same place. See [isolation](/concepts/isolation/) for what that
does and does not prove.

## 3. Do the job once

Start recording and do the work, using the system's own tools. RigorRun reads the system before you
start and again when you finish, and derives the rules from what changed.

A job that leaves no trace cannot be learned. If nothing observable changed, there is nothing to
derive a rule from.

The recording survives a reload. If you close the tab, **Carry on where I left off** keeps what you
have done; **Start again** resets the system and throws it away.

## 4. Rule on what it worked out

RigorRun reads the *shape* of the data and never the names of things — that is what stops it only
working on businesses it has already seen, and it is also why a few things it genuinely cannot know.
It shows the evidence behind each proposed rule, so you disagree with the evidence rather than with
a verdict.

It deliberately proposes more than it expects you to keep. Missing a real rule is far worse than
proposing one you do not want, and **a rule you reject cannot fail your agent**, so rejecting one
costs you nothing.

Only `observed` and `confirmed` rules may produce a release-blocking check. That is asserted by
test, not left to the interface.

## Next

[Connect an agent and run the suite](/start/first-run/).
