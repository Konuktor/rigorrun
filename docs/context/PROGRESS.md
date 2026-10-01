# RigorRun — progress

> **Only Claude edits this file** (one writer, no conflicts). Status words: `todo`, `doing`,
> `review`, `done`, `blocked`. "Verified" names who ran the acceptance commands, which is never
> the agent that wrote the change. Plan: [PRD.md](PRD.md) · decisions: [DECISIONS.md](DECISIONS.md).

## Now

- **Phase:** Step A (context, guardrails, agents) → Phase 0 (repositioned site and email).
- **Outreach:** paused since 2026-10-02 (D-004). 5 sent on 2026-10-01 (Calltree, Minimal AI, Open,
  Parahelp, Quivr). Resumes after the Phase 0 deploy.
- **Released:** `rigorrun` 0.4.0 (2026-10-01). Qualified tree `aee8fe5`; any change under
  `packages/` needs a re-qualification before the next release.
- **Working branches:** `positioning/permissions` (Phase 0, no `packages/` changes) and
  `engine/0.5.0` (Phase 1; has T-001). Agents work in `~/RigorRun-agents/<agent>-<task>`.

## Phases

| Phase | Goal                                                                                                                                   | Release        | Status      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------- |
| A     | Context files, claims ledger + check, agent instructions, Codex/Cursor wired                                                           | —              | doing       |
| 0     | Site, docs, README and email lead with permissions; only qualified claims as fact; working commands                                    | no npm release | todo        |
| 1     | Engine primitives: events/calls to the verifier, call checks, markers, principal, permission matrix in the report; Stripe re-qualified | 0.5.0          | todo        |
| 2     | Larch Helpdesk flagship: MCP fixture, pack, example agent, qualification, recording, `try`                                             | 0.6.0          | todo        |
| 3     | Pre-registered head-to-head vs answer/trace judges and the Promptfoo BOLA grader                                                       | —              | todo        |
| 4     | Your own MCP server: permission matrix, seeding tenant B, qualification on an unseen fixture                                           | 0.7.0          | todo        |
| 5     | Further packs (RLS, ledgers, portals) — only on a design partner's request                                                             | —              | not started |

## Tasks

| id  | Task                                                                                                                | Phase | Agent          | Status                                       | Commit / branch                       | Verified                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----- | -------------- | -------------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| A-1 | `docs/context/` (POSITIONING, CLAIMS, PRD, PROGRESS, DECISIONS, AGENT_WORKFLOW, tasks/TEMPLATE)                     | A     | claude         | done                                         | 398f198                               | claude: pnpm claims, docs tests                                |
| A-2 | Archive v0.2 positioning (`docs/archive/v0.2/`), banners on GETTING_STARTED, CONNECT_AGENT_10_MINUTES, V1_GAP_AUDIT | A     | claude         | done                                         | 398f198                               | claude: daemon/env-stripe/cli doc tests pass                   |
| A-3 | `scripts/check-claims.mjs` + `pnpm claims` in `verify` and `release:verify`                                         | A     | claude         | done                                         | 398f198, 622652a                      | claude: self-test ok; site, docs and outreach clean            |
| A-4 | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/rigorrun.mdc`                                                              | A     | claude         | done                                         | 398f198                               | —                                                              |
| A-5 | Cursor agent installed; founder logs in (`cursor-agent login`)                                                      | A     | founder        | blocked (login)                              | —                                     | —                                                              |
| A-6 | Canary task for Codex and for Cursor, reviewed by Claude                                                            | A     | codex, cursor  | codex done (T-001); cursor waiting for login | 968a504 on engine/0.5.0               | claude: 600 tests, lint, typecheck, claims                     |
| 0-1 | Home page, docs index and "what it is": permissions-first copy (keep the working commands)                          | 0     | claude         | done                                         | 30dd254                               | claude: build:site, build:docs, 81 public e2e on local preview |
| 0-2 | company / how-it-works / what-is-built pages, `llms.txt`, root README                                               | 0     | codex / cursor | doing (codex T-002)                          | agent/codex/T-002                     | —                                                              |
| 0-3 | Copy-pinning tests (`e2e/smoke.spec.ts:16`, `e2e/site.spec.ts:75,177-178`)                                          | 0     | cursor         | smoke done; rest with T-002                  | 42d07ad                               | claude: smoke + site e2e on local preview                      |
| 0-4 | OG image text (`scripts/build-brand.mjs`), demo video command or hide the video                                     | 0     | claude         | OG done; demo video still shows old command  | this commit                           | claude: viewed og.png                                          |
| 0-5 | Email v2, follow-up, bot prompt, CSV marked sent                                                                    | 0     | claude         | drafted, waiting for founder review          | ~/Documents/rigorrun-outreach/_\_v2._ | claude: pnpm claims on both files                              |
| 0-6 | Deploy site and docs; `release:verify:prod`; resume outreach                                                        | 0     | claude         | todo                                         | —                                     | —                                                              |

## Outreach and pilots (weekly)

| Week of    | Sent | Replies | Calls | Pilots | Design partners |
| ---------- | ---- | ------- | ----- | ------ | --------------- |
| 2026-09-28 | 5    | 0       | 0     | 0      | 0               |

## Log

- **2026-10-02 (later)** — Step A done (context files, claims check, AGENTS/CLAUDE/Cursor rules,
  v0.2 archived). Phase 0 copy on home, docs, OG, footer, access, llms.txt. Codex canary T-001
  (containment finds markers inside records; missing path UNVERIFIABLE): one review round
  (primitive arrays kept exact), verified and kept on `engine/0.5.0`. Gotcha: `codex exec` in the
  background needs `< /dev/null`. Email v2 (templates A/S/B, follow-ups), CSV v2 (template,
  priority; 5 marked sent) and bot prompt v2 written; not sent — waiting for the founder and the
  deploy. Cursor agent installed, not logged in.

- **2026-10-02** — Repositioned to permissions & scope (D-001). Research: per-company mapping of the
  100 targets, market and competitor scan, codebase capability audit. Plan approved: Step A →
  Phase 0 → 0.5.0 → 0.6.0 (Larch Helpdesk) → head-to-head → 0.7.0. Outreach paused (D-004). Step A
  started: context files, claims check, v0.2 positioning archived, Cursor agent installed.
- **2026-10-01** — 0.4.0 released (Stripe pack, black-box CI, flagship recording). First 5 emails
  sent.
