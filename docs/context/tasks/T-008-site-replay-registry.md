# T-008 · Site: replay pages for any flagship recording, and `/replay/helpdesk`

- **Agent:** codex
- **Base branch:** phase2/helpdesk
- **Worktree:** ~/RigorRun-agents/codex-T-008 (branch agent/codex/T-008)
- **Time box:** 60 min

## Read first

`AGENTS.md`, `docs/context/POSITIONING.md`, `docs/context/CLAIMS.md`,
`reports/permissions-demo-2026-10/PREREGISTRATION.md` (read-only: it fixes how the helpdesk
recording is shown — "How it is shown").

## Goal

The site can show a second flagship recording, the Larch Helpdesk one, at `/replay/helpdesk`,
from `fixtures/replays/helpdesk-replay.json` — **when that file exists**. It does not exist yet and
you must not create it: the page is simply not built while it is missing, and everything is tested
with recordings the tests build themselves. `/replay` and the home page keep showing the Stripe
recording exactly as today.

## Files you may change

- `apps/site/src/lib/replay.ts`
- `apps/site/src/pages/replay.astro`
- `apps/site/src/pages/replay/helpdesk.astro` (new), or `apps/site/src/pages/replay/[slug].astro`
  (new) if you prefer one page for both — but the URL `/replay` must stay the Stripe page
- `apps/site/src/components/ClaimReality.astro`, `apps/site/src/components/CaseRow.astro`
- `apps/site/src/components/PermissionMatrix.astro` (new)
- `apps/site/test/replay.test.ts`

## Do not touch

- `reports/**`, `fixtures/**`, `packages/**`, `docs/context/**`, `apps/site/src/pages/index.astro`
- Do not create `fixtures/replays/helpdesk-replay.json` or any other recording file.

## Details

**What a flagship recording file carries** (see `packages/cli/src/replay.ts`, the `Replay`
interface, and `fixtures/replays/stripe-replay.json`):

- `variants`: `{ [name]: { agentId, description, promptSha256, toolsSha256, runId, runResultHash } }`.
  The helpdesk recording's names will be `scoped` and `service`; the Stripe one's are `careful` and
  `minimal`. `description` is the pre-registered sentence for that variant.
- `presentation.headline`: `{ variants: string[], cases: string[], source: string }` — the
  pre-registered rule: the first FAIL of `variants[0]` in `cases` order, else of `variants[1]`, …;
  `source` is the pre-registration's path in the repo.
- `presentation.task`: `{ label, inputs }`; `presentation.next`: command lines.
- `benchmark`: the suite exactly as it ran (`benchmark.cases[].id` in suite order).
- `system`: the system as the recording may name it, e.g. `"the Larch Helpdesk twin (simulated)"`;
  `simulated: true` for a twin. `run.limits` carries a `simulated` limit too.
- Each `run.caseResults[].assertions[]` may carry `dimension`: `tenant | role | tool | sink`.

**Today** `apps/site/src/lib/replay.ts` hard-codes the Stripe recording's variants
(`type Variant = 'careful' | 'minimal'`, `VARIANT_DESCRIPTIONS`, `variantOf` by name match),
its headline rule (`HEADLINE_ORDER`, `pickHeadline`), its case order (`STRIPE_CASE_ORDER`) and its
twin name (`'The local Stripe twin'` in `caseView`, `'a local Stripe twin'` in `siteReplay`).

**Required change**

1. A variant is any string. A case's variant is the `variants` entry whose `agentId` equals the
   case's `agentId` (fall back to today's name match only for a file without `variants`, i.e. the
   Northstar demo replay). Descriptions come from `variants[name].description`.
2. The headline is picked by the file's own `presentation.headline` rule (same semantics as today's
   `pickHeadline`: earliest attempt, FAIL only). A file without `presentation` has no headline.
   Keep `HEADLINE_ORDER`/`STRIPE_CASE_ORDER` exported only if something still needs them; the
   Stripe page must show the same headline and the same case order as today (its file carries
   the same rule — assert this in a test against the real `stripe-replay.json`).
3. Case order on a replay page: the order of `benchmark.cases` when the file has `benchmark`, else
   today's order.
4. The twin's name: a simulated recording is named by its own `system` text with any trailing
   `" (simulated)"` removed, plus the page's simulated label — never by a Stripe-specific string.
   The Stripe page must still read as it does today (`stripe-replay.json` has `simulated: false`,
   so nothing changes there; keep a test that a simulated Stripe-shaped file is still called a twin).
5. A registry: `flagshipReplays` keyed by slug — `stripe` → `fixtures/replays/stripe-replay.json`,
   `helpdesk` → `fixtures/replays/helpdesk-replay.json` — each loaded with `import.meta.glob(…,
{ eager: true })` so a missing file is simply absent, and each verified with `verifyReplay`
   (hash) exactly as today. Keep the exports `stripeReplay`, `demoReplay`, `replay` working as
   today. Add `helpdeskReplay: SiteReplay | null`. Add `RIGORRUN_HELPDESK_REPLAY_FILE`, which
   works for the helpdesk slot exactly as `RIGORRUN_REPLAY_FILE` works for the Stripe slot (loud
   warning, hash-checked) — it lets Claude preview a pilot without copying it into `fixtures/`.
6. `/replay/helpdesk`: built only when `helpdeskReplay` exists (with a dynamic route return no
   paths; with a static page, use `getStaticPaths` or move it to `[slug].astro`). It shows, all read
   from the recording: the model, provider, temperature, recording date, commit, the system and the
   simulated label; a short lead saying a support agent worked the Larch Helpdesk pack's tickets
   for Alder Outdoor, twice — once per token — and that after each ticket RigorRun read the twin
   (its access log, its tables, its outbox) and the verdict comes from that read, not from what the
   agent said; the per-variant outcome table; the headline (`ClaimReality`) if the rule finds one,
   or a plain sentence that neither variant failed any case; **every case of both variants** with
   verdict, the agent's own sentence and the twin's lines (`CaseRow`); the permission matrix
   (below); the variants' descriptions; a link to the pre-registration (`presentation.headline.source`
   on GitHub, as `replay.astro` builds its link today) and the `presentation.next` commands.
   Copy must stay inside `CLAIMS.md`: say "on the Larch Helpdesk twin", never imply a live helpdesk,
   no "first/only/novel/guarantee". Reuse the existing components and Tailwind tokens; the page must
   work at phone width.
7. `PermissionMatrix.astro`: rows are the boundaries that appear in the run, labelled as in
   `packages/report/src/render.ts` (`PERMISSION_BOUNDARIES`: tenant → "Another tenant's data", role
   → "Outside its role", tool → "A tool it must not use", sink → "Data leaving"); columns are the
   variants; a cell counts that variant's checks on that boundary — failed (FAIL or ERROR), held
   (PASS), not checked (UNVERIFIABLE or INAPPLICABLE). Put the counting in `lib/replay.ts` as a pure
   function (`permissionMatrix(file|run)`) so it is unit-tested; the site must not import
   `@rigorrun/report`. Show the matrix on `/replay/helpdesk`; on `/replay` only if the Stripe run has
   dimensions (it may not — then nothing changes there).

**Tests** (`apps/site/test/replay.test.ts`, extend; keep every existing test passing):

- a synthetic helpdesk-shaped recording (build it in the test from a minimal `RunResult`, hash it
  with `hashRun`): variants `scoped`/`service` resolved by `agentId`; headline by its presentation
  rule (service's first FAIL in order; falls back to scoped; none when neither fails); cases in
  `benchmark.cases` order; twin named from `system`; matrix counts per variant and boundary;
- the real `stripe-replay.json` still gives today's headline case and agent order;
- an edited file (hash mismatch) is refused, as today.

## Acceptance (run these; all must pass)

```sh
pnpm vitest run apps/site/test
pnpm -F @rigorrun/site build      # /replay/helpdesk is absent from apps/site/dist (no recording yet)
pnpm lint && pnpm typecheck
pnpm claims
```

You cannot bind loopback ports in your sandbox; nothing here needs them. If `astro build` fails
for a sandbox reason, say so and show the error — do not work around it by changing other files.

## Report back

Files changed, each command above with its result, anything not done and why. Say whether anything
under `packages/` changed (it must not).
