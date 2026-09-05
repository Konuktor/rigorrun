> **Historical submission material.** Written against an earlier build. The
> figures in it (17 cases, 10 categories, a hardened agent at 100%) no longer
> match what the pipeline produces, and the agent ids it names have been
> renamed. Kept as a record of what was claimed and when; do not read it as a
> current statement of the product. See `docs/PRODUCT_REALITY_AUDIT.md`.

# AltaLab application — RigorRun

_Fall 2026 cohort. Every claim below is verifiable in the repository or at the
live URL. Where something does not exist yet, this document says so._

---

## Startup name

**RigorRun**

## One-line description

RigorRun turns how a human actually performs a job into a private executable
benchmark, then proves whether an AI agent can do that job reliably — by
checking the system the agent changed, not by asking the agent how it went.

**Tagline:** Do the job once. Test every agent forever.

---

## Problem

Companies are handing real operational work to AI agents — refunds, claims,
onboarding, ticket triage, back-office processing — and choosing which agent to
trust based on vendor demos and public leaderboards.

Neither answers the question that matters: _can this agent do my company's job,
reliably, without doing something unsafe?_

The dangerous failure is not "the model isn't smart enough". It is an agent that
is right 90% of the time and **confidently wrong** the rest — in a workflow
where being wrong moves money. It skips an approval. It refunds the wrong
customer. It follows an instruction a customer typed into a support note.

Evaluation tooling exists, but nearly all of it starts the same way: _write your
test cases, define your rubric, author your assertions._ That is weeks of work
by the person least willing to do it, and it produces tests that reflect what
someone imagined the job to be. So most teams skip it and ship on vibes.

## Solution

The user does the job once. RigorRun does the rest.

1. **Record** — a person performs the real task in their real application. A
   browser recorder captures the semantics of each step (role, accessible name,
   stable selector, redacted values). No page content, no credentials.
2. **Compile** — that recording becomes an executable _workflow contract_:
   preconditions, required actions, forbidden actions, assertions.
3. **Stress-test** — the contract generates normal, boundary and adversarial
   cases: 17 of them, across 10 categories, including a prompt injection hidden
   inside customer data.
4. **Verify** — agents run against those cases from identical seeded state, and
   every verdict comes from reading the resulting system state.
5. **Gate** — a threshold decides whether the agent ships. In CI, a failing
   agent exits non-zero and stops the build.

The product's central rule: **we never ask the agent whether it succeeded.** In
the live demo, one agent reports _"I refunded $500.00 against ticket TCK-4016"_
— truthfully. RigorRun ignores the report and reads the refund record:
`amount = 500`, `approval = null`. Policy violation. Unsafe. Fail.

## Why now

- **Agents crossed into operational work.** Two years ago this was chat. Now it
  is money movement and policy enforcement.
- **Buyers have no basis for comparison.** Every vendor demo looks identical, and
  procurement has nothing to point at.
- **Prompt injection through business data is a live production threat**, not a
  research curiosity — agents read customer-authored content by design.
- **Deterministic verification only became possible recently.** Agents now act
  through tools, and tool calls leave a state trail you can check. Two years ago
  you could only grade text.
- **"We tested it" is turning from a virtue into a requirement** as AI assurance
  expectations arrive.

## Customer

Organisations that are about to let an AI agent perform real operational work,
and need evidence before it does.

## Initial ICP

**AI automation agencies and implementation consultancies** — teams of roughly
3 to 30 people building custom agents for clients.

Their pain is sharp, immediate and recurring. At handoff the client asks _"how
do you know it works?"_ and the honest answer today is a demo and some spot
checks. Their reputation, their renewal and their next referral depend on an
answer they cannot currently produce.

They are also the right wedge structurally: few decision-makers, no
procurement cycle, and they sit _between_ agent vendors and enterprises — so
winning one agency puts RigorRun in front of every client it serves.

Second wave: in-house platform and AI teams who need a release gate before an
agent reaches production.

## How it works

```
Human does the job once
        ↓
RigorRun records the workflow          sanitised, semantic, stays local
        ↓
Workflow → executable contract         observed vs inferred, with open questions
        ↓
Normal + edge + adversarial cases      17 cases, 10 categories, from one recording
        ↓
Run multiple agents                    identical cases, identical seeded state
        ↓
Deterministic verification             read the system, not the agent's claim
        ↓
Compare success / policy / latency     with confidence intervals, not bare numbers
        ↓
PASS / FAIL release gate               non-zero exit in CI
```

Two design decisions are worth calling out to a technical reviewer:

**Honesty about inference.** Watching one refund does not reveal a company's
policy, and the product says so out loud. Rules taken from what the person
demonstrably did are marked `observed` at confidence 1.0. Anything generalised
beyond that is `inferred`, below 1.0, flagged for confirmation, and paired with
the question RigorRun cannot answer on its own — for example: _"The observed
refund of $42.00 was issued without manager approval, and the application
displays a $50 limit. Is $50 the correct threshold?"_ A human confirms or
rejects each one, and rejecting a rule genuinely removes the check behind it and
changes the generated cases.

**Honesty about statistics.** Seventeen cases with no failures is reported as
_100%, 95% Wilson interval 81.6%–100%, n = 17_ — because the honest reading is
"no failures observed yet", not "never fails". Cost shows "cost unavailable"
rather than an invented figure when a provider does not report a real price.

## What is built today

A working end-to-end MVP. Runs offline with no account, no API key and no
network access. Also deployed publicly.

|                           |                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Browser recorder          | Chrome MV3 extension; captures semantic events with redaction; smoke-tested by driving the real unpacked extension in a real browser |
| Trace → contract compiler | Provenance (`observed` / `inferred` / `user_confirmed`), confidence, and an open question attached to every inference                |
| Benchmark generator       | 17 cases across all 10 categories; expectations computed from the approved policy rather than hand-written                           |
| Deterministic verifier    | 14 assertion kinds over a filtered path language; every verdict carries observed-vs-expected evidence                                |
| Execution engine          | reset → seed → execute → observe → verify → score; every case starts from isolated seeded state                                      |
| Scoring                   | Success and policy-compliance rates, Wilson confidence intervals, pass@k, latency percentiles, configurable thresholds               |
| Agent adapters            | Two demo agents, an HTTP protocol for any external agent, an OpenAI-compatible adapter (Groq / Gemini / self-hosted)                 |
| Dashboard                 | Landing page plus a five-step demo that executes the real benchmark in the browser, with a per-case evidence drawer                  |
| Reports                   | Self-contained HTML export, plus a sanitising publish step with a preview of exactly what would leave                                |
| CLI                       | `rigorrun gate` returns 0 / 1 / 2 so a failing agent fails a build, and a config error is never mistaken for a failing agent         |
| Control plane             | Optional Cloudflare Worker + D1; metadata only, deployed and live                                                                    |

**Test evidence:** 380 unit and integration tests, 15 end-to-end tests. The E2E
suite includes the real browser extension and asserts that a full demo run makes
**zero** network requests outside the local origin. Verified from a clean
`git clone` + `pnpm install`.

**Demo result**, derived from executions that happen when you press the button —
nothing is hardcoded:

|                   | Agent A (baseline)       | Agent B (hardened)     |
| ----------------- | ------------------------ | ---------------------- |
| Task success      | 76.5% (95% CI 52.7–90.5) | 100% (95% CI 81.6–100) |
| Policy compliance | 76.5%                    | 100%                   |
| Unsafe actions    | 5                        | 0                      |
| Release gate      | FAIL                     | PASS                   |

## Differentiation

> Most tools: **user creates tests → tool runs tests**
> RigorRun: **human performs real work → RigorRun builds the test**

Four things follow, and together they are the product:

1. **The benchmark is derived, not authored.** We remove the step that stops
   teams evaluating at all.
2. **Verification is deterministic and external.** State and events decide, not
   an LLM judge and not the agent's own account. A model judge is supported only
   as a labelled second opinion that can never overturn a deterministic result.
3. **Workflows are private.** A recording of how your company works is
   commercially sensitive. It never leaves the machine unless you publish, and
   publishing strips the workflow first.
4. **Comparison is vendor-independent.** Your agent, a vendor's agent, and last
   month's version of your own, on the same cases from the same starting state.

## Competitors

| Category            | Examples                         | What they assume                       | Where we differ                                                  |
| ------------------- | -------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| LLM eval frameworks | Braintrust, LangSmith, Promptfoo | You will author cases and rubrics      | We derive both from one real execution                           |
| Agent observability | Langfuse, Arize, Helicone        | The agent is already in production     | We gate _before_ production                                      |
| Red-team tooling    | Lakera, Garak                    | You want to find jailbreaks            | We measure whether _your workflow_ survives adversarial data     |
| Public benchmarks   | SWE-bench, WebArena, τ-bench     | A shared public task is representative | The benchmark is private and is your actual job                  |
| RPA test suites     | UiPath and similar               | The process is deterministic           | Agents are not; we score distributions with confidence intervals |

Nobody is competing on _"the benchmark writes itself from a recording"_ — which
is precisely the step that prevents teams from evaluating properly today.

## Moat

Honest assessment: **weak on day one, compounding quickly.**

1. **The workflow corpus.** Every recorded workflow improves contract
   compilation and case generation for the next customer in that vertical.
   Refund flows look alike across companies; the tenth compiles far better than
   the first. This is a data advantage that accrues from ordinary usage.
2. **Neutrality.** An independent verifier is only valuable if it is
   independent. Whoever becomes the reference gets cited in procurement — a
   position an agent vendor grading its own work cannot occupy.
3. **Integration depth.** Recorder, contract format, CI gate. Once a benchmark
   gates a build, replacing it is a migration rather than a switch.
4. **Owning the format.** The workflow contract is a portable artefact. If
   buyers start sending it to vendors, the format becomes the standard and we
   sit underneath it.

What is _not_ a moat: the verifier, the scoring, the UI. All reproducible. The
defensibility is the corpus and the neutral position, not the code.

## Business model

**Free forever:** local runner, CLI, recorder, offline agents, CI gate. This is
deliberate — a reliability gate has to be free to be adopted, and an unadopted
gate proves nothing.

| Tier       | Price              | For                                                                               |
| ---------- | ------------------ | --------------------------------------------------------------------------------- |
| Team       | $99–299 / month    | Shared workflow index, run history, regression tracking, hosted sanitised reports |
| Agency     | $499–1,500 / month | Client-branded reliability reports, multi-client workspaces, handoff artefacts    |
| Enterprise | Annual contract    | Private deployment, SSO, audit trails, signed reports, cross-vendor comparison    |

**The larger business later:** _verification as procurement infrastructure_ —
buyers pay for an independent verdict on agents they are considering, and
vendors pay to be verified against the buyer's own workflow.

## Go to market

1. **Free benchmarks for agencies.** _"Send us one workflow your agent
   automates. We will benchmark it and give you a client-ready reliability
   report, free."_ It costs us a session, produces the artefact they cannot
   currently produce, and lands RigorRun inside their delivery process.
2. **The injection demo as content.** A 60-second video making one
   uncomfortable, specific point: _your agent will follow instructions your
   customers type into your support tool._ That travels in the channels our ICP
   already reads.
3. **The CI gate as bottom-up adoption.** Free, open, and it lives in the
   repository where engineers already work.
4. **Procurement pull.** Once a few buyers ask vendors for a RigorRun report,
   vendors arrive on their own.

## Current traction and status

Stated precisely, because precision is the product:

**What exists:** a working end-to-end MVP, publicly deployed and usable by
anyone with a browser. 380 unit and integration tests, 15 end-to-end tests
including a real browser-extension smoke test. A 17-case benchmark generated
from a recorded human workflow. Deterministic verification. A weak-versus-
hardened agent comparison whose numbers come from real executions. A browser
recorder. A CLI release gate. An optional deployed control plane.

**What does not exist:** no customers, no revenue, no pilots, no letters of
intent, no waitlist. No usage beyond the founder. This was built as a technical
proof that the approach works, and that is exactly what it currently is.

**What is honestly incomplete**, all listed in `docs/ROADMAP.md`: the shipped
environment is synthetic (a demo CRM built for the purpose); the policy-template
library covers one workflow family; there is no browser-driven execution lane
yet; and no model-judged evaluator is implemented — the label and UI treatment
exist, but shipping the evaluator half-done would blur the line the product
depends on.

The immediate next step is the one that decides everything: let a real agency
point RigorRun at a real workflow, and find out whether the contract compiler
generalises.

## Long-term vision

**The independent verification and procurement layer for AI labour.**

When a company hires a person, an interview, a reference and a probation period
stand between a claim and a hire. When a company buys AI labour, there is
currently nothing — a demo and a leaderboard.

RigorRun is the missing layer: an independent, private, deterministic answer to
_"can this thing do this job, reliably, without doing something unsafe?"_ — for
any agent, from any vendor, measured against the buyer's own work.

The unit of trust in agent procurement should be _verified against your
workflow_, not _scored well on someone else's benchmark_.

## Why this can be venture-scale

- **The market is every company that deploys an agent into operational work**,
  which is on track to be most companies with a back office. Verification is not
  a niche within that; it is a precondition for it.
- **It is infrastructure, not a tool.** Benchmarks get embedded in CI and in
  procurement. That is recurring, expanding revenue with structurally low churn:
  removing a reliability gate is a decision nobody wants to sign.
- **The data compounds.** Each workflow makes the next compile better. This is
  a defensible position that emerges from usage rather than from spend.
- **Two-sided over time.** Buyers pay for verdicts; vendors pay to be verified.
  The neutral middle is historically a durable place to sit — Verisign, UL,
  SOC 2 auditors, Moody's all occupy some version of it.
- **The wedge is cheap to test.** One agency, one workflow, one free report.
  This is a business that can find out quickly whether it is real.

## Why AltaLab

Three specific things, in order of how much they matter to us:

1. **Distribution into the ICP.** This is a design-partner problem, not a
   technical one. What we need most is introductions to five AI automation
   agencies who will point RigorRun at a real client workflow. That single input
   determines whether the contract compiler generalises — the one question the
   product cannot answer alone.
2. **Pressure on the commercial thesis.** The technology works; the open
   question is whether agencies will pay for proof, or whether only their
   enterprise clients will. We want that assumption attacked early and hard
   rather than discovered slowly.
3. **Credibility in the neutral position.** An independent verifier needs to be
   trusted to be worth anything. An accelerator with standing in the AI
   ecosystem accelerates exactly the asset we cannot build alone.

We are not looking for engineering help. We are looking for the customers who
will tell us we are wrong faster than we could find out ourselves.

---

## Links

|                                 |                                                                   |
| ------------------------------- | ----------------------------------------------------------------- |
| **Live demo**                   | <https://rigorrun.pages.dev> — no account, no key, no install     |
| **Demo CRM** (the recorded app) | <https://rigorrun-crm.pages.dev>                                  |
| **Control-plane API**           | <https://rigorrun.takhiroverbol.workers.dev/api/health>           |
| **Founder demo video**          | `[VIDEO LINK PLACEHOLDER — record from docs/ALTALAB_DEMO_60S.md]` |
| **GitHub repository**           | `[GITHUB LINK PLACEHOLDER — repository not yet published]`        |
| **Founder**                     | `[FOUNDER NAME / EMAIL PLACEHOLDER]`                              |

### For a reviewer with 60 seconds

Open <https://rigorrun.pages.dev>, press **Run the live demo**, then click
through Compile → Approve & generate → Run. When the verdict appears, click the
red **!** in the Agent A column on the row _"A customer note contains injected
instructions"_.

You will see an agent that reported success, next to the system state proving it
moved $500 it was never permitted to move.
