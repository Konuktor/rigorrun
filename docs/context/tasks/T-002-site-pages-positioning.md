# T-002 · Site pages and README lead with permissions & scope

- **Agent:** codex
- **Base branch:** positioning/permissions
- **Worktree:** ~/RigorRun-agents/codex-T-002 (branch agent/codex/T-002)
- **Time box:** 60 min
- **Phase:** 0. Nothing under `packages/` may change.

## Read first

`AGENTS.md`, `docs/context/POSITIONING.md`, `docs/context/CLAIMS.md`. The home page
(`apps/site/src/pages/index.astro`) has already been rewritten; match its voice.

## Goal

The four site pages below and the root README describe RigorRun as permission & scope tests for AI
agents, with Stripe refunds as the first qualified pack, and state as fact only what `CLAIMS.md`
lists as `QUALIFIED`/`RECORDED`. The v0.2 "do the job once" flow stays available, labelled as the
path for a system with no pack, never as the product's headline.

## Files you may change

- `apps/site/src/pages/how-it-works.astro`
- `apps/site/src/pages/company.astro`
- `apps/site/src/pages/what-is-built.astro`
- `apps/site/src/pages/evidence.astro`
- `README.md` (root) — only the block from the top down to the first `---` or the first `##` heading

## Do not touch

`packages/**`, `reports/**`, `docs/context/**`, `apps/site/src/pages/index.astro`, `start.astro`,
`access.astro`, components, data JSON files, `e2e/**`.

## Details

Use this copy verbatim where given; write the rest in the same voice (plain, specific, no hype).

1. **README.md** (top block):
   - H2-weight line: **Your agent acts for one customer at a time. You check it stays there by
     reading the transcript.**
   - Lead: "RigorRun sends your agent tickets that tempt it across that line — somebody else's
     order, a decision that is not its to make, an instruction hidden in the customer's message —
     then reads the system itself and shows what actually happened beside what the agent said it
     did. The first system it reads is Stripe: your test mode, or a local twin with no keys. Open
     source, runs on your machine, no account."
   - Keep the links row. Keep everything below the top block unchanged.
   - The README must still contain the exact text `npx rigorrun` followed by a newline somewhere,
     `pnpm install && pnpm start`, and a phrase matching `/no (change to (your agent's|its) code|code changes)/i`
     (checked by `packages/daemon/test/docs.test.ts`). Do not add "unchanged" near "agent".
2. **how-it-works.astro.** Lead with the permission flow for the Stripe pack, in three steps:
   (1) set up the pack — `npx rigorrun stripe twin` then `npx rigorrun stripe init --twin --yes`;
   (2) point it at your agent — `npx rigorrun agent add --project <id> --name my-agent --black-box <url> --claim-path message`,
   no code changes, each ticket names the customer's email and a charge id;
   (3) gate every change — `npx rigorrun gate --project <id> --report report.html`, exit 1 stops
   the build. Then a short "What is being built next" section: checks on what the agent read and
   what it sent (tool calls, the system's access log, marker strings in another customer's data),
   first on a multi-tenant helpdesk, then on your own system — every sentence there must carry
   "being built" or "next" on the same line. Then keep the existing demonstration steps under a
   heading "For a system with no pack" with one sentence saying it is the general path from v0.2.
   Update the page's `title`/`description` props accordingly.
3. **company.astro.** Rewrite the lead paragraphs (currently about "watch a person do the job once")
   so they say what the company is building now: permission and scope tests for agents that act
   for many customers, decided from the real system; Stripe is the first pack; the founder is
   looking for 3–5 design partners. In the "verified against" part, add the Stripe qualification
   (168 cells on the twin and 168 on Stripe test mode, no false pass or fail; black-box 36 cells) as
   the first item, linking `https://github.com/Konuktor/rigorrun/tree/master/reports/stripe-pack-2026-10`.
4. **what-is-built.astro.** Add rows at the top of whatever list/table it renders:
   "Stripe refunds pack — working, qualified before 0.4.0 (168 + 168 cells, no false pass or fail)";
   "Checks on reads and outbound data (tool calls, access log, marker strings) — being built";
   "Permission tests on your own system — not built yet". Keep existing rows.
5. **evidence.astro.** Add a section above the existing content titled "The Stripe pack's
   qualification" with the numbers from item 3 and links to `reports/stripe-pack-2026-10` and
   `reports/blackbox-qualification-2026-10` on GitHub. Keep the existing H1 (it must still contain
   "did not write") and all existing text: `e2e/site.spec.ts` and `e2e/smoke.spec.ts` assert
   "of 37", "What this does not establish", "Our own scan is not a user", "What the harness itself
   cannot do" and "does not claim to prevent a container escape".

Never write "first"/"the only"/"novel"/"guarantee"/"certified", never "canary" for markers, never
"design partners" as if any exist.

## Acceptance (run these in the worktree; all must pass)

```sh
pnpm claims
pnpm build:site
pnpm vitest run packages/daemon/test/docs.test.ts
pnpm exec prettier --check README.md
```

## Report back

Files changed, each command above with its result, and confirm nothing under `packages/` changed.
