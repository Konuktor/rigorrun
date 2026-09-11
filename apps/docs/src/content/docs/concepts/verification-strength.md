---
title: Verification strength
description: Every RigorRun verdict says how strongly it could be checked. AUTHORITATIVE, PARTIAL and OBSERVATIONAL are not grades of confidence — they describe what was actually read.
---

Every result carries one of three labels. They are not confidence scores. They describe what
RigorRun was able to read.

| | What it means | When you get it |
| --- | --- | --- |
| `AUTHORITATIVE` | Direct, trusted state. RigorRun can see the whole of the system's state. | In-process environments only — the bundled example, and fixtures. |
| `PARTIAL` | Verified through the reads your system exposes, and nothing beyond them. | **Any real connected system.** |
| `OBSERVATIONAL` | The actions were watched. The final state was not independently read back. | A browser connection with no readable system attached. |

## A real system is PARTIAL, and that is the honest answer

:::note
A verdict against a real external system is `PARTIAL` by design, not by omission. RigorRun reads
back what the nominated reads return and no more. Claiming otherwise would be the single most
damaging thing this product could do.
:::

`AUTHORITATIVE` requires RigorRun to be able to see all of the state. Over MCP or HTTP it sees what
your read operations return. If a write touched a table nothing reads back, RigorRun did not check
it and says so under **What this system stopped RigorRun doing**.

The way to strengthen a verdict is to nominate more reads, not to reinterpret the label.

## Per-check sources

Inside a run, each individual check also names where its answer came from:

| Source | Shown as | Can it block a release? |
| --- | --- | --- |
| `STATE` | read from your system | yes |
| `EVENT` | from your system's own log | yes |
| `OUTPUT` | from what the tool returned | yes |
| `HUMAN` | decided by a person | yes |
| `MODEL` | judged by a model | yes |
| `DECLARED` | claimed by the system itself, unverified | **never** |

`DECLARED` is deliberately not styled as a warning. A warning reads as "probably fine, look when you
can". A claim the system under test made about itself, which nothing has checked, is not probably
fine — it is the thing the rest of the product exists to go and test. Nothing with a `DECLARED`
source may block, and there is a test for it.

## What is not emitted yet

Of the six sources above, generated suites only ever produce `STATE` and `EVENT`. Nothing produces a
model-judged or human-review evaluator today, so those tiers exist in the schema and are unreachable
in practice. See [limitations](/trust/limitations/).
