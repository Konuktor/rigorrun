# T-001 · `contains` / `not_contains` find a marker inside records; a missing path is unverifiable

- **Agent:** codex
- **Base branch:** positioning/permissions
- **Worktree:** ~/RigorRun-agents/codex-T-001 (branch agent/codex/T-001)
- **Time box:** 45 min
- **Phase:** 1 (engine primitives, release 0.5.0). Changes `packages/` — the qualified tree changes;
  that is expected and handled by the 0.5.0 re-qualification, not by this task.

## Read first

`AGENTS.md`, `docs/context/POSITIONING.md`, `docs/context/CLAIMS.md` (B-LEAKS is the claim this
work leads toward; do not change any copy).

## Goal

A check `not_contains` on a list of records must fail when a marker string sits inside any record,
and a check whose target path does not resolve must not pass silently. This is the base for leak
detection with marker strings (a marker planted in tenant B's data that must never appear in an
outbound list or the agent's reply).

## Files you may change

- `packages/verifier/src/evaluate.ts` — only the `containment()` function (around lines 422–444)
- `packages/verifier/test/evaluate.test.ts` — add tests

## Do not touch

- Anything else, in particular `reports/**`, `docs/**`, `packages/core/**`, other verifier files.

## Details

Current behaviour (`packages/verifier/src/evaluate.ts`, `containment()`):

- string target + string expected → substring test (keep).
- **array target → `value.some((entry) => deepEqual(entry, expected))`**. A string marker inside an
  array of row objects is never found, so `not_contains` on `derived.created.X` always passes. Bug.
- non-null other value → `JSON.stringify(value).includes(String(expected))` (keep).
- **unresolved path** (`resolvePath(...).found === false`) → `value` is `undefined`, `contains` is
  false, so `not_contains` PASSes. Bug: nothing was checked.

Required behaviour:

1. Array target: keep the `deepEqual` match on entries (an array of primitives containing the
   expected value must still match exactly as today). Additionally, when `expected` is a string,
   the array contains it if `JSON.stringify(entry)` of any entry includes the string. A non-string
   `expected` keeps the deepEqual-only behaviour.
2. If `resolution.found` is false, return
   `{ status: 'UNVERIFIABLE', observed: null, message: \`not checked: ${target} was not found\` }`
   for both kinds. Look at how other functions in the same file build UNVERIFIABLE outcomes and match
   their style.
3. Messages otherwise unchanged.

No product suite emits `contains`/`not_contains` today (checked with grep), so no shipped verdict
moves.

## Acceptance (run these in the worktree; all must pass)

```sh
pnpm vitest run packages/verifier
pnpm lint && pnpm typecheck
pnpm claims
```

New tests (in `packages/verifier/test/evaluate.test.ts`, next to the existing contains tests):

- `not_contains` on an array of row objects, one of which has a field containing the marker → FAIL.
- `not_contains` on the same array without the marker → PASS.
- `contains` on an array of primitives `['a','b']` with expected `'a'` → PASS (unchanged).
- `not_contains` with a target path that does not exist → UNVERIFIABLE (and `contains` too).

## Report back

Files changed, each command above with its result, anything not done and why, and confirm that
`packages/` changed (verifier only).
