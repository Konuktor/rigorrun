---
title: Isolation
description: Whether each case started from the same state, and the difference between a reset that was observed to work and one that was merely nominated.
---

Cases that run in sequence can contaminate each other: a case that creates a booking changes what
the next case sees. Isolation says whether RigorRun could stop that.

| | What it means |
| --- | --- |
| `RESET` | The cases were **observed** to start from the same state. RigorRun performed the reset itself and compared. |
| `PARTIAL` | Reset ran, and only some of the state came back the same. |
| `DECLARED` | A reset was nominated, and nothing has run it twice and compared the results. Believed, not observed. |
| `NONE` | There is no way to put the system back. |

## DECLARED is not a weaker RESET

:::caution[This overclaimed until 0.2.0]
RigorRun reported `RESET` whenever *any* reset was configured, though nothing had ever run the reset
twice and compared the results. It was reporting an observation it had never made.

It now says `RESET` only where the reset is RigorRun's own machinery — an in-process snapshot, or a
container thrown away — and `DECLARED` where it is a tool the operator nominated. Most real
connected systems are therefore `DECLARED`.
:::

## With no reset at all

A system with `NONE` still works, and produces a smaller suite:

- Repeated mutating cases are switched off rather than quietly run.
- Every result says the cases could have affected each other.
- Suite quality checking is unavailable, because it runs the suite several times and most of those
  runs write.

That is a fair trade, and it is better than a suite that looks complete and is not.
