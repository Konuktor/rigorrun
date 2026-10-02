# RigorRun — progress

> **Only Claude edits this file** (one writer, no conflicts). Status words: `todo`, `doing`,
> `review`, `done`, `blocked`. "Verified" names who ran the acceptance commands, which is never
> the agent that wrote the change. Plan: [PRD.md](PRD.md) · decisions: [DECISIONS.md](DECISIONS.md).

## Now

- **Phase:** 0 and 1 done and released. Next: Phase 2 (Larch Helpdesk pack, flagship permissions demo).
- **Outreach:** the site is live, so the pause (D-004) can end: email v2 is in
  `~/Documents/rigorrun-outreach/*_v2.*`, waiting for the founder to read it and send the bot "GO v2".
- **Released:** `rigorrun` **0.5.0** on 2026-10-02 (npm `latest`, provenance; tag `v0.5.0`, master
  `7562967`, PR #6). Qualified tree `27d40a8`; released tree `c247c72` differs only by version
  strings (`reports/stripe-requal-0.5.0/RELEASE-TREE.md`). rigorrun.xyz and the docs deployed the
  same day; `release:verify --prod` all 17 gates pass.
- **Working branch:** `phase2/helpdesk` (from master). Agents work in `~/RigorRun-agents/<agent>-<task>`.

## Phases

| Phase | Goal                                                                                                                                   | Release        | Status                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------- |
| A     | Context files, claims ledger + check, agent instructions, Codex/Cursor wired                                                           | —              | done                       |
| 0     | Site, docs, README and email lead with permissions; only qualified claims as fact; working commands                                    | no npm release | done (deployed 2026-10-02) |
| 1     | Engine primitives: events/calls to the verifier, call checks, markers, principal, permission matrix in the report; Stripe re-qualified | 0.5.0          | released                   |
| 2     | Larch Helpdesk flagship: MCP fixture, pack, example agent, qualification, recording, `try`                                             | 0.6.0          | todo                       |
| 3     | Pre-registered head-to-head vs answer/trace judges and the Promptfoo BOLA grader                                                       | —              | todo                       |
| 4     | Your own MCP server: permission matrix, seeding tenant B, qualification on an unseen fixture                                           | 0.7.0          | todo                       |
| 5     | Further packs (RLS, ledgers, portals) — only on a design partner's request                                                             | —              | not started                |

## Tasks

| id   | Task                                                                                                                | Phase | Agent          | Status                                                                                                                                                | Commit / branch                       | Verified                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ----- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A-1  | `docs/context/` (POSITIONING, CLAIMS, PRD, PROGRESS, DECISIONS, AGENT_WORKFLOW, tasks/TEMPLATE)                     | A     | claude         | done                                                                                                                                                  | 398f198                               | claude: pnpm claims, docs tests                                                                                            |
| A-2  | Archive v0.2 positioning (`docs/archive/v0.2/`), banners on GETTING_STARTED, CONNECT_AGENT_10_MINUTES, V1_GAP_AUDIT | A     | claude         | done                                                                                                                                                  | 398f198                               | claude: daemon/env-stripe/cli doc tests pass                                                                               |
| A-3  | `scripts/check-claims.mjs` + `pnpm claims` in `verify` and `release:verify`                                         | A     | claude         | done                                                                                                                                                  | 398f198, 622652a                      | claude: self-test ok; site, docs and outreach clean                                                                        |
| A-4  | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/rigorrun.mdc`                                                              | A     | claude         | done                                                                                                                                                  | 398f198                               | —                                                                                                                          |
| A-5  | Cursor agent installed; founder logs in (`cursor-agent login`)                                                      | A     | founder        | blocked (login)                                                                                                                                       | —                                     | —                                                                                                                          |
| A-6  | Canary task for Codex and for Cursor, reviewed by Claude                                                            | A     | codex, cursor  | codex done (T-001); cursor waiting for login                                                                                                          | 968a504 on engine/0.5.0               | claude: 600 tests, lint, typecheck, claims                                                                                 |
| 0-1  | Home page, docs index and "what it is": permissions-first copy (keep the working commands)                          | 0     | claude         | done                                                                                                                                                  | 30dd254                               | claude: build:site, build:docs, 81 public e2e on local preview                                                             |
| 0-2  | company / how-it-works / what-is-built pages, `llms.txt`, root README                                               | 0     | codex / cursor | done (codex T-002 + claude review edits)                                                                                                              | 00a235c                               | claude: claims, build:site, 81 public e2e, daemon docs 20/20                                                               |
| 0-3  | Copy-pinning tests (`e2e/smoke.spec.ts:16`, `e2e/site.spec.ts:75,177-178`)                                          | 0     | cursor         | done                                                                                                                                                  | 42d07ad                               | claude: smoke + site e2e on local preview                                                                                  |
| 0-4  | OG image text (`scripts/build-brand.mjs`), demo video command or hide the video                                     | 0     | claude         | done: OG, video re-recorded, replay Next lines                                                                                                        | 87fa9d6, e1d1a07                      | claude: viewed og.png and the video closing frame                                                                          |
| 0-5  | Email v2, follow-up, bot prompt, CSV marked sent                                                                    | 0     | claude         | drafted, waiting for founder review                                                                                                                   | ~/Documents/rigorrun-outreach/_\_v2._ | claude: pnpm claims on both files                                                                                          |
| 0-6  | Deploy site and docs; `release:verify:prod`; resume outreach                                                        | 0     | claude         | done                                                                                                                                                  | master 7562967                        | claude: release:verify --prod, 17/17                                                                                       |
| 1-1  | Runner hands the verifier the events (`events: []` bug)                                                             | 1     | claude         | done                                                                                                                                                  | dfbb436 on engine/0.5.0               | claude: regression test fails without the fix; 1797 passed                                                                 |
| 1-2  | `contains`/`not_contains` find markers inside records; missing path UNVERIFIABLE (T-001)                            | 1     | codex          | done                                                                                                                                                  | 968a504                               | claude: 600 tests, lint, typecheck                                                                                         |
| 1-3  | Check kinds `tool_not_called`, `tool_args_in_scope`, `no_refused_call`, `marker_absent`; `Observation.calls`        | 1     | claude         | done                                                                                                                                                  | 9e93f0e                               | claude: 13 new tests; 1804 passed                                                                                          |
| 1-4  | Proxy refusals recorded as evidence (`ProxyChannel.refused`)                                                        | 1     | claude         | done                                                                                                                                                  | 762e2c7                               | claude: 1806 passed                                                                                                        |
| 1-5  | `task.principal` in every agent envelope                                                                            | 1     | claude         | done                                                                                                                                                  | 5f9e1e1                               | claude: 1808 passed                                                                                                        |
| 1-6  | `dimension` on checks and results                                                                                   | 1     | claude         | done                                                                                                                                                  | 481e749                               | claude: verifier tests                                                                                                     |
| 1-7  | Permission matrix in the HTML report; report footer (T-004)                                                         | 1     | codex          | done (codex T-004 + claude review: published reports keep the boundary)                                                                               | ad9fbf3                               | claude: report 43/43; rendered the flagship run with tags                                                                  |
| 1-8  | Stripe suite: tools, principal, scope checks on `other_customer`; goldens                                           | 1     | claude         | done, narrowed: Stripe checks tagged with their boundary; no principal or new kinds in the Stripe suite (would change what black-box agents are sent) | d1e7c26                               | claude: suite tests; full suite                                                                                            |
| 1-9  | CLI copy (help, npm description, CLI README, replay end line)                                                       | 1     | cursor/claude  | done                                                                                                                                                  | c8b5b75                               | claude: pnpm verify (lint, typecheck, domain, claims, 1813 tests, build)                                                   |
| 1-10 | Pre-registered Stripe re-qualification at the 0.5.0 tree (T then L)                                                 | 1     | claude         | done: GO_TWIN and GO_LIVE (168 + 168, TP 39 / TN 129, FP 0, FN 0)                                                                                     | 1771d2a on engine/0.5.0               | claude: aggregate per pre-registration; tag diagnostic 0 mismatches                                                        |
| 2-1  | Larch Helpdesk MCP fixture (T-003)                                                                                  | 2     | codex          | done                                                                                                                                                  | d92c813 on engine/0.5.0               | claude: fixture tests 12/12, external-imports, lint                                                                        |
| —    | Allow-list enforcement in the runner                                                                                | 1     | claude         | dropped                                                                                                                                               | —                                     | it broke a careful agent that reads before retrying (runner/test/retry.test.ts); scope tests use `tool_not_called` instead |

## Outreach and pilots (weekly)

| Week of    | Sent | Replies | Calls | Pilots | Design partners |
| ---------- | ---- | ------- | ----- | ------ | --------------- |
| 2026-09-28 | 5    | 0       | 0     | 0      | 0               |

## Log

- **2026-10-02 (morning)** — **0.5.0 released** (founder's "yes"): PR #6 merged after CI (one new
  CodeQL alert — a polynomial regex in the helpdesk fixture's bearer parsing — fixed first), tag
  `v0.5.0`, published by `release.yml` with provenance; a clean `npx rigorrun@latest` runs help,
  demo, `stripe twin` and `stripe init --twin --yes`. rigorrun.xyz and docs deployed;
  `release:verify --prod` 17/17. Follow-up: npm warns it normalises `bin` (`./bin/…`) on publish,
  as it did for 0.4.0 — harmless, to be cleaned in the next release.

- **2026-10-02 (early morning)** — 0.5.0 candidate re-qualified (`reports/stripe-requal-0.5.0`):
  Stage T GO_TWIN and Stage L GO_LIVE, 168 cells each, TP 39 / TN 129, no false pass or fail, no
  re-runs; boundary-tag diagnostic clean. Not released: needs the founder's "yes".

- **2026-10-02 (night)** — Phase 0 complete on `positioning/permissions` (site, docs, README, OG,
  video, llms.txt, emails v2 drafted); not deployed — waiting for the founder. Phase 1 engine on
  `engine/0.5.0`: events bug fixed, four call/marker check kinds, proxy refusals as evidence,
  `task.principal`, `dimension`. Codex delivered T-002 (site pages), T-003 (Larch Helpdesk
  fixture) and is on T-004 (report matrix). Allow-list enforcement dropped (see tasks).

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
