---
title: Choosing a connection
description: How RigorRun reaches your system decides how strong a verdict it can give you. The three options, and what each one can prove.
---

The question is not which protocol your system speaks. It is what your agent does.

| Your agent | Connect via | Verdict ceiling |
| --- | --- | --- |
| Uses tools | [MCP server](/systems/mcp/) | `PARTIAL` |
| Calls an API | [OpenAPI document](/systems/openapi/) | `PARTIAL` |
| Clicks around a page | [Browser](/systems/browser/) | `OBSERVATIONAL` |

## Why the ceiling matters more than the protocol

RigorRun decides a verdict by reading your system after the agent has finished. A connection that
can read state back can close that loop; one that cannot, cannot.

A browser is the case worth understanding before you start. A page saying "done" is a claim by the
same system that would have to be wrong for it not to be done — so a browser cannot check its own
work, and RigorRun's types refuse to let a browser be its own verifier.

That is not a gap waiting to be closed. It is what a browser is.

## The combination that works

You can attach both. RigorRun drives the browser so the agent works the way a person would, and
reads a connected MCP server or HTTP API for the same system afterwards to decide what actually
changed. The clicking is watched in the page; the verdict comes from records.

Most systems that look API-less have something that can be read.

## Where to point it

Staging, a scratch instance, or a local copy. Mark the environment honestly when you connect it:

| Safety | What RigorRun will do |
| --- | --- |
| `ephemeral` | Anything. Made for testing, reset freely. |
| `local` | Anything. Your machine, nobody else affected. |
| `staging` | Anything. Shared, but not the live system. |
| `production` | **Nothing that writes.** Your agent still gets to try, and you see what it would have done. |
