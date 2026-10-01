# Instructions for coding agents (Codex, Cursor, Claude, any other)

## Read these first, every time

1. `docs/context/POSITIONING.md` — what RigorRun is and how it is described. **The only source.**
2. `docs/context/CLAIMS.md` — what may be stated as fact (`QUALIFIED`/`RECORDED`) and what may not.
3. `docs/context/PROGRESS.md` — where the work stands.
4. Your task brief in `docs/context/tasks/`, if you were given one.

RigorRun is positioned as **pre-deployment permission & scope tests for AI agents**. The Stripe
refunds pack is the first qualified pack, not the product's whole scope. Anything in
`docs/archive/**`, or under an "ARCHIVED" / "Describes the v0.2 path" banner, is history — never
use it as a source for copy, plans or answers about the product.

## Hard rules

- **Claims.** Never state as fact anything `CLAIMS.md` lists as `BUILDING` or `NOT_BUILT`; phrase it
  as "being built" or "next". `pnpm claims` must pass. Never write "first", "the only", "novel",
  "state of the art", "guarantee", "certified". Never call leak markers "canaries" (the canary is
  the $1.00 Stripe refund).
- **Numbers.** Only from artefacts in `reports/`, with the path. Never estimate or round up a result.
- **Do not edit** `reports/**`, pre-registrations, qualification harnesses, `docs/context/CLAIMS.md`
  or `docs/context/POSITIONING.md`. Those are Claude's, with the founder's approval.
- **Qualified tree.** Any change under `packages/` changes the code the qualification ran on. Say
  so in your summary; never claim a qualification covers changed code.
- **Scope.** Stay inside the files your brief names. If the task needs more, stop and explain.
- **Tests.** Run the acceptance commands in your brief, plus `pnpm lint && pnpm typecheck`. Report
  each command and its result truthfully; a failing test is reported, not hidden.
- **Secrets.** Keys live in the OS secret store or `~/.config/rigorrun/keys.env`; never print,
  copy or commit them. Stripe keys here are test-mode only; model-provider keys (Groq, Gemini)
  are free-tier and rate-limited.

## Repository map (short)

- `packages/` — the engine (core, runner, verifier, proxy, connector, report, cli, …) and packs
  (`env-stripe`). `apps/site` — rigorrun.xyz. `apps/docs` — docs.rigorrun.xyz.
- `examples/` — reference agents. `fixtures/` — recorded runs and external test systems.
- `reports/` — pre-registrations and qualification evidence (read-only for agents).
- Checks: `pnpm verify` (lint, typecheck, domain, claims, tests, build); `pnpm release:verify`.

## How work is handed out

See `docs/context/AGENT_WORKFLOW.md`. Finish every task with: files changed, commands run and their
results, what is left undone, and whether `packages/` changed.
