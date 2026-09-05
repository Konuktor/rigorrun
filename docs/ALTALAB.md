> **Historical submission material.** Written against an earlier build. The
> figures in it (17 cases, 10 categories, a hardened agent at 100%) no longer
> match what the pipeline produces, and the agent ids it names have been
> renamed. Kept as a record of what was claimed and when; do not read it as a
> current statement of the product. See `docs/PRODUCT_REALITY_AUDIT.md`.

# RigorRun

**Do the job once. Test every agent forever.**

## 30-second pitch

Companies are handing real operational work to AI agents, and they are choosing
which agent to trust based on vendor demos and public leaderboards. Neither
tells you whether an agent can do _your_ job without doing something unsafe.

RigorRun watches a person do the job once, turns that recording into a private
executable benchmark, and runs any agent against it — proving success or failure
by inspecting the system the agent changed, never by asking the agent how it
went. Do the job once. Test every agent forever.

## Problem

Agent evaluation today is either **vibes** — a demo, a few prompts, a gut call —
or **weeks of work**, because every existing eval tool starts by asking you to
author datasets, rubrics and assertions.

Both fail in the same specific way. An agent that is right 90% of the time and
_confidently wrong_ the rest will pass a demo and fail in production, in a
workflow where being wrong moves money. The failure that matters is not "the
model is not smart enough"; it is "the agent skipped the approval", "the agent
refunded the wrong customer", "the agent followed an instruction a customer
typed into a support note".

Nobody has a repeatable, private, deterministic way to catch that before
deployment.

## ICP

**AI automation agencies and implementation consultancies.** Small teams — 3 to
30 people — building custom agents for clients.

Their pain is sharp and immediate: at handoff, the client asks "how do you know
it works?" and the honest answer is a demo and some spot checks. Their
reputation, their renewal and their next referral all depend on an answer they
cannot currently produce. They feel this on every single engagement.

They are also the easiest wedge: few decision-makers, no procurement, and they
sit _between_ the agent vendors and the enterprises — so winning them puts
RigorRun in front of every client they serve.

Second wave: in-house platform and AI teams who need a release gate.

## Solution

```
Human does the job once
        ↓
RigorRun records the workflow          sanitised, semantic, local
        ↓
Workflow → executable contract         observed vs inferred, with open questions
        ↓
Normal + edge + adversarial cases      17 cases, 10 categories, from one recording
        ↓
Run multiple agents                    same cases, same seeded state
        ↓
Deterministic verification             read the system, not the agent's claim
        ↓
Compare success / policy / cost        with confidence intervals, not just a number
        ↓
PASS / FAIL release gate               exit 1 in CI
```

## Why now

- **Agents are crossing into operational work.** 2024 was chatbots; now it is
  refunds, claims and back-office processing — work with money and policy in it.
- **Buyers have no basis for comparison.** Every vendor demo looks identical.
  Procurement has nothing to point at.
- **Prompt injection through business data is now the live threat**, not a
  research curiosity. Agents read customer-authored content by design.
- **Deterministic verification finally works** because agents act through tools,
  and tool calls leave a state trail you can check.
- **Regulatory pressure is arriving.** "We tested it" is becoming a requirement
  rather than a virtue.

## Wedge

> Most tools: **user creates tests → tool runs tests**
> RigorRun: **human performs real work → RigorRun builds the test**

Everything else follows from removing the authoring step. The customer does not
adopt a testing methodology; they do their job once while we watch.

## Competition

| Category            | Examples                         | What they assume                       | Where RigorRun differs                                       |
| ------------------- | -------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| LLM eval frameworks | Braintrust, LangSmith, Promptfoo | You will author cases and rubrics      | We derive both from one real execution                       |
| Agent observability | Langfuse, Arize, Helicone        | The agent is already in production     | We gate _before_ production                                  |
| Red-team tooling    | Lakera, Garak                    | You want to find jailbreaks            | We measure whether _your workflow_ survives adversarial data |
| Public benchmarks   | SWE-bench, WebArena, τ-bench     | A shared public task is representative | The benchmark is private and is your actual job              |
| RPA testing         | UiPath test suites               | The process is deterministic           | Agents are not; we score distributions, not pass/fail        |

Nobody is competing on _"the benchmark writes itself from a recording"_ — which
is exactly the step that stops teams from evaluating properly today.

## Moat

**Weak at first, compounding fast.** Honestly:

1. **The workflow corpus.** Every recorded workflow makes contract compilation
   and case generation better for the next customer in that vertical. Refund
   workflows look alike across companies; the tenth one compiles far better than
   the first.
2. **Trust and neutrality.** An independent verifier is only valuable if it is
   independent. Whoever becomes the reference gets cited in procurement, and
   that position is not easily copied by an agent vendor grading its own work.
3. **Integration surface.** Recorder, contract format, CI gate — once a
   benchmark gates a build, replacing it is a migration, not a switch.
4. **Being the format.** The workflow contract is a portable artefact. If buyers
   send it to vendors, the format becomes the standard.

What is _not_ a moat: the verifier, the scoring, the UI. All reproducible. The
defensibility is the corpus and the neutral position.

## Business model

**Free forever:** local runner, CLI, recorder, offline agents, CI gate. This is
deliberate — the gate has to be free to be adopted, and an unadopted gate proves
nothing.

**Team ($99–299/month):** shared workflow index, run history and regression
tracking, hosted sanitised reports, multi-workflow projects.

**Agency ($499–1,500/month):** client-branded reliability reports, multi-client
workspaces, handoff artefacts — the thing they currently cannot produce.

**Enterprise (annual):** private deployment, SSO, audit trails, signed reports,
procurement-grade comparison across vendors.

**Later, the real business:** _verification as procurement infrastructure_ —
buyers pay for an independent verdict on agents they are considering, and
vendors pay to be verified against the buyer's own workflow.

## Go to market

**Motion one — free benchmarks for agencies.** "Send us one workflow your agent
automates. We will benchmark it and give you a client-ready reliability report,
free." It costs us a session, it produces the artefact they need, and it lands
RigorRun inside their delivery process.

**Motion two — the injection demo.** The prompt-injection case is a 60-second
video that makes a specific, uncomfortable point: your agent will follow
instructions your customers type into your support tool. That travels.

**Motion three — the CI gate.** Free, open, and it lives in the repository where
engineers already are. `rigorrun gate` in a pipeline is the wedge into the team.

**Motion four — procurement pull.** Once a few buyers ask vendors for a RigorRun
report, vendors arrive on their own.

## Long-term vision

**The independent verification and procurement layer for AI labour.**

When a company buys human labour, an interview, a reference and a probation
period stand between a claim and a hire. When it buys AI labour, there is
currently nothing — a demo and a leaderboard.

RigorRun is the missing layer: an independent, private, deterministic way to
answer "can this thing do this job, reliably, without doing something unsafe?"
— for any agent, from any vendor, against the buyer's own work.

The unit of trust in agent procurement should be _verified against your
workflow_, not _scored well on someone else's benchmark_.

## Current status

Working MVP, end to end, offline, with no account or key required. Recorder,
compiler, generator, runner, verifier, scoring, reports, CLI, dashboard, and an
optional Cloudflare control plane. 380 unit and integration tests plus 13 end-to-end tests, including a real
browser-extension smoke test.

Honest about what it is not: one synthetic environment, one workflow family's
policy templates, no browser-driven execution yet. [ROADMAP.md](ROADMAP.md) is
specific about all of it.
