---
title: Your first agent run
description: Point RigorRun at your agent, run the suite, and read a verdict that comes from the system rather than the transcript.
---

## Connect your agent

RigorRun gives your agent one task at a time. Four ways in:

- **It already runs somewhere, and works on your system itself.** RigorRun posts each task to the
  endpoint it already serves, with no change to its code, then reads your system through its own
  connection. The quickest way to test an agent you have; the [Stripe guide](/start/stripe/) uses
  it. See [a black-box agent](/agents/black-box/).
- **It listens on an address, and works through RigorRun.** RigorRun posts each task to your
  endpoint with a URL to work through. If your agent already speaks MCP, that plus about ten lines
  is the whole integration. See [an HTTP agent](/agents/http/).
- **It is a command on this machine.** RigorRun starts it.
- **You drive it.** RigorRun makes a key, and your own loop pulls work. About twenty lines, and the
  agent can live behind a login, in a notebook, or anywhere that will not take a request from this
  machine. See [an agent you drive](/agents/driven/).

The private half of each case — the checks and the reference plan — is never sent to the agent, so
there is nothing to read the answer from.

## Read the verdict

In the interface, the headline is the decision, and it always carries how it was reached:

```
SAFE TO SHIP?   CONDITIONAL      VERIFIED   PARTIAL
                                 ISOLATION  RESET
```

- **YES** — every check passed, read back from your own system, with each case starting clean.
- **CONDITIONAL** — the thresholds were met, but something about _how_ it was checked limits what
  that means. This is the common case against a real system. It is not a softer pass.
- **NO** — the run missed the bar you set.

From the command line, `gate` prints the verification and isolation first and ends with `PASS`,
`FAIL` or `INCONCLUSIVE`. A `PASS` whose verification is not `AUTHORITATIVE`, or whose isolation is
`NONE`, is what the interface calls `CONDITIONAL`.

Read [verification strength](/concepts/verification-strength/) before you read anything else.

## What each case gives you

Open any case and it answers, in this order: which check failed and how it was checked, what the
agent did, what your system said afterwards, and — last, and labelled — what the agent said it did.

That last section is never scored. It is shown because it is useful to see the gap between the two.

## Then break something

Change a prompt, swap a model, flip a flag. Run again. RigorRun tells you which specific case
regressed rather than that a number moved. Then
[put it in CI](/start/ci-gate/).
