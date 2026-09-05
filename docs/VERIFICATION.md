# How a verdict is reached

The single rule: **the evaluator never trusts the agent.** An agent's account of
what it did is recorded, shown next to what actually happened, and never scored.

That rule does not soften when an agent is given more autonomy. An agent driving
itself through the MCP proxy is judged exactly like one RigorRun drove
step-by-step: by reading the system afterwards.

## Where a verdict comes from, in order

1. **The system's own state**, read through the tools you nominated.
2. **The action log** — what RigorRun saw go past on its channel.
3. **The agent's report** — displayed, never scored.

## Verification strength

Every run carries how it was established, because a pass against a system
nothing could be read back from is a different claim from a pass against one
that could, and only one of them is worth acting on.

| Label | Meaning |
| --- | --- |
| `AUTHORITATIVE` | The whole system was read back. Only in-process environments manage this. |
| `PARTIAL` | The nominated reads were read back. Anything outside them could not be checked. |
| `OBSERVATIONAL` | Nothing was read back. The only evidence is what the agent was seen to do. |

A real MCP system is normally `PARTIAL`, and widening it is a matter of
nominating more reads.

## Inapplicable is not passing

A check that could not be evaluated — because a mutation removed its
antecedent, or because no nominated read covers the record it asks about —
comes back `INAPPLICABLE`. It is excluded from both the success and the policy
verdict.

Counting those as passes would let a benchmark score perfectly by never testing
anything, which is the failure mode that makes eval tooling worthless.

## Isolation

`RESET` means each case started from the same place. `NONE` means it did not,
and every result says so. See [ENVIRONMENT_RESET.md](ENVIRONMENT_RESET.md).

## What the suite does not cover

A benchmark carries `notTestable`: rules the environment enforces itself, so
nothing can be caught breaking them; and coverage this system cannot offer at
all. Both appear on the result.

A rule that silently produced no case looks exactly like a rule that everything
satisfies, and the difference is the whole question of whether the suite covers
the job.

## Comparing runs

Comparison is by case id. A case that used to pass and now does not is a
regression, named, with what specifically moved.

Two judgements in there are worth knowing about:

- **A mixed result counts as a regression.** Job done, policy broken, is not a
  draw — the policy is the half somebody gets fired over.
- **Two runs of different suites are not compared.** A different benchmark means
  a different question was asked, and the honest answer to "did this get worse"
  is then "that cannot be known from these two".

## When a system cannot be read back at all

RigorRun works out what changed by calling the reads you nominate and comparing
what comes back. That requires the reads to return *records* — structured
output with fields it can compare. A great many MCP servers answer in prose
instead: a directory listing, a formatted summary, a document.

RigorRun does not parse prose. Guessing at what a sentence means is exactly how
a verdict stops being worth anything, and a confident PASS derived from a
regular expression over English is worse than no verdict at all.

So when you nominate your reads, RigorRun calls them and tells you what it got.
If none of them return records, it says so there and then — before you spend
twenty minutes demonstrating a job it will not be able to check — and offers to
continue anyway. If you do, every result says `OBSERVATIONAL`: RigorRun saw
what your agent did, and did not look at your system afterwards.

The fix, where one exists, is to nominate a different read. If your system has
no read that returns structure, the honest position is that RigorRun cannot
verify against it, and it will keep saying so rather than quietly grading your
agent on its own account of itself.

## A browser is weaker again

RigorRun can drive a web application, and a verdict from one says
`OBSERVATIONAL`: it watched what your agent did and did not check what changed.

That is not a limitation waiting to be lifted. A page saying "Refund issued" is
a claim by the same system that would have to be wrong for the refund not to
exist — the same category of evidence as the agent's own report, which RigorRun
shows beside the verdict and never scores. Reading it back and calling it
verification would be making exactly the mistake this product exists to prevent,
one layer down.

Attach an MCP server or an OpenAPI document for the same system and the
arrangement becomes the one worth having: the clicking is watched in the page,
and the verdict comes from records. Verification is then `PARTIAL`, as it would
be for that connector alone.

RigorRun will not let a browser be its own verifier even if you ask for it. See
[BROWSER_ENVIRONMENT.md](BROWSER_ENVIRONMENT.md).
