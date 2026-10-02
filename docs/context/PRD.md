# RigorRun — product requirements (permissions & scope)

> Derived from [POSITIONING.md](POSITIONING.md). What may be _said_ about each requirement is in
> [CLAIMS.md](CLAIMS.md); where the work stands is in [PROGRESS.md](PROGRESS.md). Version 1,
> 2026-10-02.

## 1. Problem

An AI agent acts for many customers through one set of tools and credentials. Teams test it by
reading transcripts or by having a model grade the reply. Neither shows what the agent actually
read, changed or sent. The failures that hurt are the quiet ones: the right words, the wrong
customer. RigorRun's flagship recording shows one: the agent said "Refunded $30.00" while Stripe
holds $0.30 refunded on another customer's charge (R-FLAGSHIP).

## 2. Users

| User                                       | Job to be done                                                                 | Trigger                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Founder / CTO of a YC-stage agent company  | "Show me, before we ship, that the agent can't touch another customer's data." | Enterprise security review; going autonomous; model or prompt change; an incident |
| The engineer who owns the agent            | "Turn our permission rules into tests that fail the build."                    | Every pull request that touches prompts, tools or models                          |
| The enterprise buyer's reviewer (indirect) | "Give me evidence, not a promise."                                             | Vendor review                                                                     |

## 3. Principles (non-negotiable)

1. **The system decides, not the transcript.** A model never produces a verdict. What the agent
   said is shown, labelled, and never scored — except that a marker string found in its reply can
   fail a case (B-LEAKS), never pass one.
2. **State the strength.** Every verdict carries what was read and how strongly (`PARTIAL`,
   state-only vs calls-and-state). No silent PASS: unverifiable is shown as unverifiable.
3. **Qualified before claimed.** A capability is advertised only after a pre-registered
   qualification with 0 false pass and 0 false fail.
4. **Local and open.** Runs on the user's machine, MIT, no account; keys stay in the OS secret store.
5. **Test systems only.** Live/production credentials are refused.

## 4. Scope by release

### 0.4.0 — shipped 2026-10-01

- Stripe refunds pack: local twin and Stripe test mode, 7 tickets + $1.00 canary, black-box agents,
  `gate` exit codes 0–3, HTML report, GitHub Action. Qualified (Q-STRIPE-*, Q-BLACKBOX).

### Phase 0 — site, docs and email repositioned (no npm release)

- **R0.1** Every public surface leads with permissions & scope and states only qualified claims as
  fact. _Acceptance:_ `pnpm claims` passes on the site, docs, READMEs and the email templates.
- **R0.2** The commands shown on the home page and in the demo work exactly as typed in an empty
  directory. _Acceptance:_ manual run of `npx rigorrun demo`, `stripe twin`, `stripe init --twin --yes`.
- **R0.3** A visitor can ask for a hand-run pilot from the hero. _Acceptance:_ contact link present.

### 0.5.0 — engine primitives

- **R1.1** Observed events and the agent's calls reach the verifier (fixes `events: []`).
- **R1.2** Check kinds `tool_not_called`, `tool_args_in_scope`, `no_refused_call`, `marker_absent`.
  _Acceptance:_ unit tests for each, incl. "agentReport can only fail".
- **R1.3** `contains`/`not_contains` find a marker inside record arrays; an unresolved path is
  `UNVERIFIABLE`. _Acceptance:_ regression tests.
- **R1.4** `task.principal {tenant, user?, role?}` on every agent path (optional field; protocol
  `rigorrun/task/1` unchanged).
- **R1.5** Permission matrix section in the HTML report; published mode strips identifiers.
- **R1.6** Stripe pack re-qualified at the release tree (Stage T and L), 0/0.

### 0.6.0 — Larch Helpdesk flagship

- **R2.1** A multi-tenant helpdesk MCP server (fixture, in-memory, no keys): orgs, customers,
  orders, tickets, refunds, outbox, access log; an org-scoped token and a service-role token.
- **R2.2** `packages/env-helpdesk` pack with 8 cases covering reads, writes, leaks, injection,
  out-of-role. _Acceptance:_ qualification with an independent oracle, both black-box and proxied
  branches, 0 false pass / 0 false fail / 0 abstain.
- **R2.3** `rigorrun helpdesk try` and `rigorrun stripe try`: one command to a first verdict.
  _Acceptance:_ a first verdict in under 60 s on a clean machine with no keys.
- **R2.4** A pre-registered recording with a real model, published whatever it shows.

### Phase 3 — head-to-head (no release)

- **R3.1** Pre-registered comparison on the same runs: judge on the answer, judge on the trace,
  trajectory match, Promptfoo BOLA grader, RigorRun; ground truth from independent oracles.
  _Acceptance:_ numbers on the site reproduce from raw files; reviewed before publication.

### 0.7.0 — your own system

- **R4.1** A permission matrix (YAML): tenant field, tenants, roles, allowed tools and argument
  scopes, sinks, marker fields; an LLM may draft it, a person must confirm it before it can block.
- **R4.2** `rigorrun permissions init --mcp <cmd|url> --tenant-field … --as A=… --other B=…`
  seeds tenant B through the server's own tools and compiles cases from the matrix.
  _Acceptance:_ qualification on an unseen fixture.

### Later — only on a design partner's request

Postgres/Supabase RLS, ledgers (QuickBooks, NetSuite), browser/portal agents.

## 5. Non-goals

Runtime enforcement or a policy engine; production monitoring; LLM-judge scoring; certification;
hosting a SaaS; zero-decimal currencies in the Stripe pack (until asked).

## 6. Success metrics

| Metric                                               | Target                                           | Where tracked                 |
| ---------------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| Replies to outreach                                  | ≥ 5 % of sent                                    | PROGRESS.md, weekly           |
| Design partners (staging access or a hand-run pilot) | 3–5 by end of October                            | PROGRESS.md                   |
| First verdict on a stranger's machine                | < 10 min to their own agent; < 60 s for `try`    | `docs/TTFRV_PROTOCOL.md` runs |
| Qualification gates                                  | 0 false pass, 0 false fail on every claimed pack | `reports/`                    |
| Real bugs found in a partner's agent                 | ≥ 1 before asking for a SAFE                     | pilot reports                 |

## 7. Risks

- **A state-based competitor adds permissions** (Veris, Coval, Archal). Answer: depth on
  permissions, open source, evidence format, speed.
- **Models behave in the recording** (no failure to show). Publish anyway; the qualification, not
  the recording, is the proof.
- **Tenant models in the wild don't fit the matrix.** Freeze the schema only after hand-run pilots.
- **Free-tier model limits** (Groq) slow recordings and the head-to-head; plan days, not hours.
