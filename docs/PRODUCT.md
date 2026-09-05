# RigorRun — product

**Do the job once. Test every agent forever.**
_Real workflows. Measurable agents._

## The problem

Teams are deploying AI agents into real operational work — refunds, claims,
onboarding, ticket triage, back-office processing — and choosing between them
using vendor demos, public leaderboards and impressions from a few prompts.

None of those measure the thing that matters. A model that tops a coding
benchmark tells you nothing about whether an agent will refund the wrong
customer, skip an approval, or follow an instruction that a customer typed into
a support note.

The failure mode is specific and expensive: an agent that is right 90% of the
time and _confidently wrong_ the rest, in a workflow where being wrong moves
money.

## The wedge

Evaluation tooling already exists. Almost all of it starts the same way:

> Write your test cases. Define your rubric. Author your assertions.

That is weeks of work by the person who least wants to do it, and it produces
tests that reflect what someone _imagined_ the job to be.

RigorRun starts somewhere else:

```
   most tools:   user creates tests        →  tool runs tests
     RigorRun:   human performs real work  →  RigorRun builds the test
```

A person does the job once, in their own application. RigorRun records it,
compiles it into an executable contract, and generates the case suite. The
artefact is derived from reality rather than from a spec.

## Four commitments

**1. The benchmark is derived, not authored.** One real execution becomes a
contract, then a case suite covering normal, boundary, missing-precondition,
duplicate, policy-violating, malformed, tool-failure, timeout, injection and
unexpected-state paths.

**2. Verification is deterministic and external.** A verdict comes from the
system the agent changed. Assertions read state and events. The agent's own
report is displayed for comparison and never scored. Where a judgement genuinely
needs a model or a person, it is labelled `MODEL-JUDGED` or `HUMAN-REVIEW` and
never silently replaces a deterministic check.

**3. Workflows are private.** The recording of how your company works is
commercially sensitive. It stays on the machine that produced it. Publishing is
explicit, previewed, and strips the workflow before anything leaves.

**4. Comparison is vendor-independent.** The same private cases run against
your agent, a vendor's agent, and last month's version of your own — from the
same seeded state, with the same checks.

## Honesty as a feature

The compiler could pretend that watching one refund reveals a company's refund
policy. It does not:

- Rules taken from what the person demonstrably did are `observed`, confidence 1.0.
- Anything generalised beyond that is `inferred`, with a confidence below 1, a
  `needsConfirmation` flag, and an open question phrased for a human.
- A person reviewing the contract confirms or rejects each one. Rejecting a rule
  removes the assertion behind it, which genuinely changes the generated cases.

The same discipline runs through the metrics. A suite with no failures is
reported with its Wilson interval and its `n` beside it — because the honest
reading of a few dozen cases is "no failures observed yet", not "never fails". Cost is `null` and displayed as
"cost unavailable" unless a real price is known.

## Who it is for

**First ICP: AI automation agencies and implementation consultancies.**

They build an agent for a client, and at handoff they have no rigorous,
repeatable way to prove it works. The client asks "how do you know?" and the
honest answer is a demo and some spot checks. Their reputation and their next
contract depend on an answer they cannot currently produce.

RigorRun turns handoff into an artefact: _here is the workflow we automated,
here are the cases we generated from it, here is the reliability report, and
here is the gate that will fail your build if it regresses._

Second wave: in-house platform and AI teams who need a release gate before an
agent touches production.

## What this is deliberately not

- **Not an observability product.** It does not watch production traffic.
- **Not a red-team service.** Adversarial cases exist to measure a workflow, not
  to enumerate jailbreaks.
- **Not a model leaderboard.** The benchmark is private and specific to one job.
- **Not an LLM-judge harness.** A model may be a second opinion, never the
  arbiter.

## Current state

An early MVP that runs end to end, offline, with no account or key. The
shipped environment is synthetic (Northstar Support), and the policy-template
library covers one workflow family. [ROADMAP.md](ROADMAP.md) is explicit about
what is not built yet.
