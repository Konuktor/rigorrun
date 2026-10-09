# RigorRun — hackathon and investor pitch

This is a pitch for an early local-first product, not a claim of production,
funding, customer or revenue readiness. Read `MVP_RUNBOOK.md` for the runnable demo
and its verification checkpoint. The new MVP is not an npm release; historic
qualification reports do not qualify a changed package tree.

## Positioning

**Verify what your AI agents actually do.**

RigorRun is a pre-deployment verification system for tool-using AI agents. Give an
agent a job and a scope, run adversarial tasks in a disposable environment, then
check the observable system state, access records and outbox against the rules.
The agent's explanation is shown for comparison, not used as the judge.

The problem is not “agents need another chat evaluation.” A plausible response
can hide a refund for the wrong customer, another tenant's data being read, an
unauthorised change or an email to the wrong recipient. A team changing a model,
prompt, credential or tool needs repeatable evidence that its workflow boundaries
still hold before releasing that change.

This is not a second autonomous agent that supervises every production action.
RigorRun tests observable behaviour before deployment; it does not block actions
at runtime or guarantee safety beyond a suite and its verification strength.

## First customer hypothesis

- **Organisation:** a B2B software team moving a tool-using agent from prototype
  to deployment, with a disposable test environment and observable system reads.
- **User:** the engineer shipping the agent or maintaining its tool integrations.
- **Buyer:** the CTO or AI/platform lead responsible for release risk.
- **Trigger:** a prompt/model/tool/credential change, a permission incident, or a
  release review asking for reproducible evidence rather than a transcript.
- **First workflow:** customer support in a multi-tenant system: read customer
  records, change an order and send a response. Payments are one example, not the
  product's boundary.

Not the first ICP: consumers buying a chatbot, teams without reset/readback, or
buyers seeking a production firewall or compliance certification. This ICP is a
testable hypothesis, not validated demand.

## Why pay if the runner is open source?

The MIT runner stays free to self-host. A paid customer should buy work and an
operating service they do not want to build themselves, not permission to use the
same downloadable code.

| Offer                     | Customer outcome                                                                                      | Commercial stage                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Free local runner         | Inspect and run existing suites on the customer's machine                                             | Available open source                                             |
| Scoped verification pilot | One agreed workflow, adapter feasibility, rules, system readbacks and repeatable acceptance/reporting | Proposed paid service; quote after scoping, no automatic checkout |
| Team workspace            | Shared run history, review/approval workflow and operated release checks                              | Planned subscription, not implemented                             |

Start with a fixed-scope paid pilot. Agree the acceptance criteria and what the
system cannot observe **before** agreeing delivery or taking payment. Custom
permission packs are not an off-the-shelf supported integration today.

The eventual subscription unit is a team/workspace with a defined run allowance;
larger usage and private deployments can be separate tiers. That is a proposed
business model, not live billing or validated pricing. Do not promise cloud,
SSO, compliance, runtime protection or enterprise support in the MVP.

The reason to renew would be recurring releases: maintained adapters and suites,
repeatable checks on changed agents, and evidence the whole team can use. If users
only need a one-off check and prefer self-hosting, subscriptions are not yet
justified. Validate that before building billing.

## 60-second English pitch

> AI agents can say they completed the right task while changing the wrong
> customer's records. Teams need to verify the action, not just the answer.
>
> RigorRun runs permission and workflow checks before deployment, then reads the
> system to see what actually happened. In our local Helpdesk twin, the same
> scripted control passes with a scoped credential and fails with a broad service
> credential. The report shows the other tenant's read, refund and email beside
> the control's inaccurate claim.
>
> Stripe is one pack, not our category. Our direction is repeatable release
> verification for tool-using agents across business workflows. The open-source
> runner is the adoption path. We are offering scoped workflow pilots and testing
> demand for a paid team workspace.
>
> We are early: this is a simulated, model-free demo, not proof for every agent or
> production system. We are looking for a team with one real workflow, a safe test
> environment and a concrete release decision we can help verify.

## Three-minute demonstration

1. **Problem, 20 seconds:** show a plausible agent claim. Ask whether a transcript
   proves which tenant was read, whose order changed or where data was emailed.
2. **Proof, 90 seconds:** run the model-free Helpdesk CLI test from the runbook.
   Show the default project gate passing the scoped control and failing the
   service-token control. Open the defective HTML report and compare the claim
   with actual access/refund/outbox evidence. PASS details are in stored run JSON;
   the current PASS HTML is a summary/matrix, not a detailed evidence card.
3. **Product, 40 seconds:** show the browser workflow examples and explicit review.
   Say “synthetic architectural examples,” not qualified customer integrations.
   Invoice and access examples have known quality limitations. The daemon-backed
   Projects interface and browser demo are different launch paths in the runbook.
4. **Business, 30 seconds:** free runner → scoped paid pilot → planned recurring
   team workspace, if repeated release use is established. Finish with one scoped
   workflow and the founder contact: **erbol@rigorrun.xyz**.

If a live demonstration fails, show the retained synthetic report and label it
as a previous run. Never describe a recording as a fresh live result. The existing
public replays are historical evidence about their recorded build and scope.

## What to validate next

Ask a prospective design partner:

1. Which agent action would force you to roll back a release?
2. What did the last failure cost in engineering time, support or lost trust?
3. Can we reset a test instance and read authoritative evidence of that action?
4. Who approves the release, and what evidence would change their decision?
5. Will you pay for one scoped pilot with agreed acceptance criteria?
6. How often will you rerun it, and what would make a team subscription worthwhile?

Measure completed qualified pilot workflows, repeated release use, onboarding
effort and actual willingness to pay. Do not substitute GitHub stars, hypothetical
TAM, a scripted pass rate or verbal interest for customers and revenue.

## Claims to avoid

- “Works with any tool/system today”: adapters, reset and observable evidence are
  prerequisites; custom two-tenant permission tests are not generally available.
- “An agent firewall”: no production runtime enforcement is implemented.
- “Certified safe” or “zero false positives”: a suite's checks and quality do not
  prove universal safety; historic qualification is scoped and build-specific.
- “SaaS launched” or “paying customers”: there is no hosted workspace or billing
  in this MVP, and this pitch makes no adoption/revenue claim.
- “Invoice/access are qualified”: they are synthetic examples with known defects
  in suite-quality coverage, not new qualified packs.
