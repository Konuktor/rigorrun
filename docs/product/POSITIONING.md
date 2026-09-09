# Positioning

Settled before the redesign, so the design had something to be true to.

## One sentence

RigorRun turns one human demonstration of a real job into an executable acceptance suite, and
decides whether an AI agent can do that job by reading the system it changed.

## Category, in five words

**Acceptance testing for AI agents.**

Not "agent reliability platform" — a phrase that means nothing until it is explained, and by the
time it has been explained a concrete sentence would have done the work.

## The pain

You have an agent that calls tools and changes real records. It worked last week. Somebody changed a
prompt, or a model version moved, or a tool's schema shifted. You have no way to find out whether it
can still do the job except by watching it in production, and the thing production tells you first
is that a customer was refunded twice.

The reason acceptance tests for agents do not already exist is not that nobody wants them. It is
that writing them means writing down every rule your business already knows and has never said out
loud.

## The wedge

```
human demonstration  →  derived acceptance suite  →  state-based verdict
```

A person does the job once. RigorRun reads the system before and after, derives what the rules must
be, asks about what it can only guess, and generates cases across ten categories. Then it runs your
agent and reads your system to decide what happened.

## Why not an evaluation harness

```
eval harness:  prompt → output → a judge scores the text
   RigorRun:   job → state → acceptance suite → agent → state → verdict
```

An agent that reports success and an agent that achieved it are indistinguishable from the
transcript. They are trivially distinguishable from the database. That single sentence is the
product.

## Why local-first

Not a privacy stance — an architectural fact with a consequence people like. A page served over
`https` cannot fetch `http://127.0.0.1` in Firefox or Safari, so a hosted interface could never reach
a customer's staging box or internal MCP server. Serving both halves from one loopback origin removes
the problem instead of working around it, and it means there is no relay, no account and no route by
which a credential could reach us.

## What RigorRun is not

- Not an LLM evaluation harness; it does not rank models.
- Not a benchmark; the suite is yours and describes your job.
- Not an observability tool; it gates changes before production, it does not watch production.
- Not an MCP scanner. `rigorrun verify` is one command, and leading with it would reposition the
  whole product as a registry linter.

## MCP, OpenAPI and Browser are how, never why

They are the answer to "how does RigorRun reach your system", asked after somebody knows why they
want it reached. In the product this is asked as **"What does your agent do?"** — uses tools, calls
an API, or clicks — because that is a question a person can answer on their first screen.

## Vocabulary

Words that carry meaning and must be used precisely:

| | |
| --- | --- |
| **Project** | One job, in one system. |
| **Contract** | What RigorRun worked out from the demonstration. |
| **Rule** | `observed`, `inferred`, `confirmed` or `rejected`. Only the first and third may block. |
| **Case** | One scenario, in one of ten categories. |
| **Check** | One assertion about what should be true afterwards. |
| **Verification strength** | `AUTHORITATIVE`, `PARTIAL`, `OBSERVATIONAL`. What was read, not how confident anybody is. |
| **Isolation** | `RESET`, `PARTIAL`, `DECLARED`, `NONE`. Whether cases started clean, and whether that was observed or believed. |
| **Verdict** | `YES`, `CONDITIONAL`, `NO`. Conditional is not a softer yes. |

## Sentences that are allowed

- "Your agent said it worked. RigorRun checks what it actually did."
- "Show RigorRun the job once."
- "A verdict against a real system is `PARTIAL`, and says so."
- "19 of 37 tools were exercised. The other 18 are named."
- "Evidence, with the denominator."

## Sentences that are banned

- "Unlock", "seamless", "effortless", "supercharge", "agentic possibilities".
- "Enterprise-grade", "production-ready", "battle-tested" — none of which has been earned.
- "Trusted by", "used by teams at", any implied customer. There are none.
- "AI-powered." RigorRun's verification is deterministic; the phrase would be false as well as
  vacuous.
- "First", "only", "novel", "state of the art" — not without a search that has actually been run.
- "100% verified", or any coverage figure without its denominator.
