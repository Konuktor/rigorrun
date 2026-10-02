# RigorRun — positioning

> **The single source of truth for what RigorRun is and how it is described.** Site, docs, README,
> CLI copy, emails and plans are derived from this file. If anything else disagrees with it,
> this file wins and the other is stale. It changes only with the founder's explicit "yes", and
> each change is logged in [DECISIONS.md](DECISIONS.md).
>
> Adopted 2026-10-02 (D-001). Before that date RigorRun was positioned as "acceptance testing
> from one human demonstration"; that text is archived in `docs/archive/v0.2/` and is not a source.

## One sentence

**RigorRun tests an AI agent's permissions and scope before it ships: that it acts only for the
right customer, only within its role, and never reads, changes or sends another customer's data —
checked against the real system, not the transcript or an LLM judge.**

Today only part of that sentence is qualified. [CLAIMS.md](CLAIMS.md) says which part. Public copy
may use the sentence only as the direction ("what we are building"), with the qualified part
stated as fact and the rest marked as being built.

## Headline (site, OG image, email subject line family)

- Site H1 (draft): **"Your agent acts for one customer. Check it never touches another's."**
- Email subject (draft): **"can {company}'s agent touch another customer's data?"**
- Do not use "prove … never" in headlines: every real-system verdict is `PARTIAL` (it reads what
  each case created, not the whole account). "Check" and "test" are accurate.

## The problem

An agent with tools acts on behalf of many customers (or patients, borrowers, tenants) through one
set of credentials. Teams check it by reading transcripts or by asking a model to grade the reply.
A reply can say "I can't share that" after the agent has already read another customer's records,
or say "Refunded $30.00" after refunding someone else's charge. The transcript and the system
disagree, and only the system is the truth.

## How RigorRun decides (three kinds of evidence)

1. **State of the system, before and after** — what was created, changed or deleted, and for whom.
   _Qualified for the Stripe pack and the Larch Helpdesk pack._
2. **The system's own access log, and the agent's tool calls** — what it read and what it tried.
   _The access log is qualified on the Larch Helpdesk twin (black-box agents). Checks on the
   agent's tool calls are being built._
3. **Marker strings planted in another customer's data** — if a marker shows up in an outbound
   channel (email, webhook, reply), that data left. _Qualified on the Larch Helpdesk twin (email
   and the agent's reply)._
   Never call these "canaries": in RigorRun, "canary" already means the $1.00 Stripe refund that
   runs before a suite.

What the agent says it did is shown beside the evidence, labelled, and never scored.

## Who it is for (ICP)

- **Core:** YC-stage teams shipping an agent that acts on behalf of many customers through tools:
  support and CX agents, finance-ops and back-office agents, healthcare billing and intake, agent
  platforms. In the 100-company outreach list (verified per company,
  `~/Documents/rigorrun-outreach/yc_founders_100_needs.csv`): permissions/scope is the #1 concern
  for 25 and a strong fit for 51; ledgers #1 for 15; browser/portal agents #1 for 13; Stripe #1 for 4.
- **Buyer moment (triggers):** an enterprise customer's security review ("show us your agent can't
  see other tenants' data"); moving the agent from human-approved to autonomous actions; a model or
  prompt change; an incident that must become a regression test.

## Where it sits (competition and partners)

| Group                            | Examples                                                                                | What they do                                              | Our relation                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Runtime authorisation for agents | Okta Agent SSO, Auth0 for AI Agents, Oso, Permit (MCP gateway), Cerbos, Arcade, Keycard | Enforce permissions while the agent runs                  | **Partners.** RigorRun checks, before release, that their enforcement actually holds in the customer's assembled system.           |
| Red-teaming / eval graders       | Promptfoo (BOLA plugin), LLM-as-judge evals in Braintrust, LangSmith, Galileo           | Grade the agent's reply or trace, usually with a model    | Different evidence: they grade what was said; RigorRun reads what happened. Comparative claims need the Phase 3 measurement first. |
| State-based agent testing        | Veris, Coval (API-state metric), Archal, Arga Labs, Hue, τ²-bench                       | Simulated or real systems, mostly "did the task get done" | Closest. Our edge must be depth on permissions (tenants, roles, reads, leaks), open source, and the evidence format.               |
| Prompt-injection firewalls       | Lakera (Check Point), Invariant (Snyk), Noma                                            | Runtime detection                                         | Not our business. Injection is an _input_ in our cases, judged by state.                                                           |

Sources and dates for the facts above: `docs/product/COMPETITORS.md` and the research notes linked
from [DECISIONS.md](DECISIONS.md) (D-001).

## What RigorRun is not

- Not a runtime guard or policy engine (it gates a change before release).
- Not a production monitor.
- Not an LLM-judge eval harness; a model never decides a verdict.
- Not a certification. A report can support a security review; it is not an audit.

## Packs (systems RigorRun ships a client for)

| Pack                                                                        | Status                | Notes                                                                                                                 |
| --------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Larch Helpdesk (multi-tenant helpdesk over MCP)                             | **Qualified** (0.6.0) | Flagship for reads, writes and leaks, on its twin only. Black-box, `AUTHORITATIVE`. Recorded run at /replay/helpdesk. |
| Stripe refunds                                                              | **Qualified** (0.4.0) | First pack and first proof. Its `other_customer` case is a cross-customer failure. Black-box, state-only, `PARTIAL`.  |
| Your own MCP server (two tenants, permission matrix)                        | Not built (Phase 4)   |                                                                                                                       |
| Postgres/Supabase RLS, ledgers (QuickBooks/NetSuite), browser/portal agents | Not built (Phase 5)   | Started only when a design partner asks.                                                                              |

## Voice and wording rules

- State what was checked and how strongly. Keep `PARTIAL` visible.
- Never: "first", "the only", "novel", "state of the art", "guarantee", "certified".
- Never claim design partners exist until one has agreed. Today: "looking for 3–5 design partners".
- Anything not `QUALIFIED` in [CLAIMS.md](CLAIMS.md) is phrased as "being built" or "next", never
  in the present tense. `node scripts/check-claims.mjs` enforces the most common slips.
- Numbers only from `reports/` artefacts, with the link.
