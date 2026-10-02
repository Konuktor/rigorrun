# T-005 · env-helpdesk: the twin inside the product, and the pack around it (no cases yet)

- **Agent:** codex
- **Base branch:** phase2/helpdesk (the package skeleton and wiring are committed: `cc6bd8c`)
- **Worktree:** ~/RigorRun-agents/codex-T-005 (branch agent/codex/T-005)
- **Time box:** 150 min
- **Phase:** 2. Changes `packages/` (a new package) — covered by the 0.6.0 qualification.

## Read first

`AGENTS.md`; `docs/context/tasks/PHASE-2-DESIGN.md` (D1–D3 are the decisions this implements);
`packages/environment/src/pack.ts` (the pack contract — note `PackSession.isolation` and
`completeRead`, added in `c7c5030`); `packages/env-stripe/src/` as the template (`conventions.ts`,
`schema.ts`, `session.ts`, `pack.ts`, `cli/index.ts`, `cli/twin.ts`, `index.ts`); the current twin in
`fixtures/external/mcp-helpdesk/` (README and `src/*.ts`).

## Goal

`packages/env-helpdesk` is a registered pack whose session replaces the twin's whole world before
each case and reads it all back, and `rigorrun helpdesk twin` starts the Larch Helpdesk twin from
the CLI. The cases, rules and suite are **not** in this task.

## Files you may change

- everything under `packages/env-helpdesk/` (the package.json is already there; do not change its
  dependencies — they are installed)
- `packages/cli/src/packs.ts` — import and register the pack in `BUILT_IN`, like Stripe
- `scripts/check-domain-leak.mjs` — add `'helpdesk'` and `'larch'` to the domain terms, next to
  `'stripe'`

## Do not touch

`packages/*` other than the two above, `fixtures/**` (copy from the fixture, do not delete it —
Claude removes it after review), `reports/**`, `docs/**`, `pnpm-lock.yaml`. Do not run
`pnpm install`.

## Details

1. **The twin** → `packages/env-helpdesk/src/twin/`: copy `db.ts`, `seed.ts`, `server.ts`,
   `http.ts`, `stdio.ts` from the fixture. Keep the rule that **nothing under `twin/` imports from
   `@rigorrun/*`** (add a test that reads every file in `twin/` and fails on such an import).
   `http.ts` exports `startTwin({ host?: '127.0.0.1', port?: number }) => Promise<{ url, port,
close() }>` serving `/mcp` and the loopback-only `/_twin/seed`, `/_twin/dump`, `/_twin/reset`
   (always on — the pack needs them). Port 0 picks a free port.
2. **`conventions.ts`:** `HELPDESK_PACK_ID = 'helpdesk'`, `TWIN_HOST = '127.0.0.1'`,
   `TWIN_PORT = 12113`, `TWIN_URL`, `ALDER = 'alder'`, `BIRCH = 'birch'`, the seeded token names
   (`tok_alder_support`, `tok_birch_support`, `tok_service`).
3. **`schema.ts`:** an `EnvironmentSchema` that `validateSchema` accepts, entities `Org`, `Customer`,
   `Order`, `Ticket`, `Refund`, `Outbox`, `AccessLog`, fields as in `twin/seed.ts`. `org_id` on every
   row. `AccessLog` is append-only with id field `id` (the read maps `seq` to `log_<seq>`, keeping
   `seq`). Relations: Order→Customer, Ticket→Customer, Refund→Order (fk on the many side).
   `Customer.notes`, `Ticket.body`, `Outbox.body` are untrusted free text. `Ticket.notes` (a list in
   the twin) is read as one string, the notes joined with `\n`. Look at env-stripe's field helpers and
   `validateSchema` (`packages/environment/src/schema.ts:214-347`) for the roles and units.
4. **`client.ts`:** `seed(state)`, `dump()`, `reset()` over HTTP to a loopback base URL only (refuse
   any other host). Errors carry the status and body.
5. **`recipe.ts`:** a strict zod `RecipeSchema`: `{ world?: 'default', add?: { customers?, orders?,
tickets? } (rows in the twin's own shape), bind: Record<string, { table, id, field }> }`.
   `buildWorld(recipe)` = the default seed with `add` appended (ids must not collide — throw if they
   do), `access_log` and `outbox` empty. `bindingsFor(world, recipe.bind)` returns each named field
   as a string, throwing on a missing row or field.
6. **`materialize.ts`:** `recipe → buildWorld → client.seed(world) → client.dump()`, and throw unless
   the dump equals what was seeded (this proves the reset happened; it does not change the label).
   Return `{ bindings, scope: { description: "the whole Larch Helpdesk twin, replaced with this
case's world before the agent started", data: null } }`.
7. **`read.ts`:** `dump → CanonicalState` (`setOwn`/`emptyState` from `@rigorrun/environment`):
   every table except `tokens`, keyed by id; `access_log` rows as `AccessLog` with
   `id: 'log_<seq>'`; throw `StateReadError` on any failure. Never read through MCP (it would write
   access-log rows).
8. **`reality.ts`:** `describeHelpdeskReality(seed, final)` — plain lines: rows of another org that
   were read or written (from new `AccessLog` rows whose `row_org_id` differs from `principal_org`,
   or any row read by a service token, grouped by org and table), refunds created, customers deleted,
   emails sent (recipient and subject). Never scored.
9. **`session.ts`:** `openHelpdeskSession({ mode, baseUrl, safety })` — twin mode only (live is
   refused with a clear message), `system: 'Larch Helpdesk (twin)'`, `safety` default `'local'`,
   `simulated: true`, `isolation: 'replaced-world'`, `completeRead: true`, `actions()` `[]`,
   `execute` refuses (agents in this pack are black boxes), `materialize`/`read`/`reality` as above,
   `close()` no-op.
10. **`pack.ts`:** `helpdeskPack: PackDefinition` (presentation like `STRIPE_PRESENTATION`, with
    tables for Customer, Order, Ticket, Refund, Outbox, AccessLog), `describeAction`,
    `registerHelpdeskPack()`; `cli` lazily imports `./cli/index.ts`; no `suite` yet.
11. **`cli/index.ts`, `cli/twin.ts`:** `rigorrun helpdesk twin [--port <n>]` runs the twin in the
    foreground and prints its MCP URL alone on the first line (as `stripe twin` does), then a short
    usage block naming the two tokens. `rigorrun helpdesk --help` lists `twin` (and says `init` and
    `try` are coming — they are not part of this task).
12. **`index.ts`:** re-export what tests and the CLI need.

## Tests (vitest, `packages/env-helpdesk/test/`)

Move the fixture's `node:test` suites into vitest form (`twin.server.test.ts`, `twin.http.test.ts`),
plus: `twin.imports.test.ts` (no `@rigorrun` import under `twin/`); `schema.test.ts` (valid);
`recipe.test.ts` (default world, additions, id collision, bindings, missing binding);
`client.materialize.read.test.ts` (start a twin on port 0, materialize a recipe, read it back, an
agent-side MCP call with `tok_service` reading a birch customer appears as an `AccessLog` row with
`row_org_id: 'birch'`); `session.test.ts` (through `PackEnvironment`: capabilities
`stateRead: 'full'`, `reset: 'endpoint'`, isolation `DECLARED`, verification `AUTHORITATIVE`);
`pack.test.ts` (registers; `describeAction`).

## Acceptance (run these in the worktree; all must pass)

```sh
pnpm vitest run packages/env-helpdesk packages/cli/test/packs.test.ts
pnpm lint && pnpm typecheck
node scripts/check-domain-leak.mjs
pnpm claims
```

## Report back

Files created or changed, each command above with its result, anything not done and why; confirm
`fixtures/` and `pnpm-lock.yaml` are untouched.
