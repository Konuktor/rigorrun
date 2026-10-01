# T-004 · A permission matrix in the HTML report

- **Agent:** codex
- **Base branch:** engine/0.5.0
- **Worktree:** ~/RigorRun-agents/codex-T-004 (branch agent/codex/T-004)
- **Time box:** 60 min
- **Phase:** 1 (release 0.5.0). Changes `packages/report` only — the qualified tree changes; that is
  expected and covered by the 0.5.0 re-qualification.

## Read first

`AGENTS.md`, `docs/context/POSITIONING.md`, `docs/context/CLAIMS.md` (B-MATRIX is the claim this
builds toward — do not change any public copy outside the report), `docs/BENCHMARK_FORMAT.md`
section "Checks on the agent's calls and on planted markers".

## Goal

When a run's checks name a permission boundary (`AssertionResult.dimension` is `tenant`, `role`,
`tool` or `sink` — added in `packages/core/src/assertion.ts` on this branch), the HTML report shows a
**Permission matrix** right after the case matrix: one row per boundary, one column per agent, and
in each cell how that agent's checks on that boundary ended across all cases and attempts.

## Files you may change

- `packages/report/src/render.ts`
- `packages/report/src/styles.ts` (or wherever `REPORT_CSS` lives) — only if a style is needed
- `packages/report/test/report.test.ts`

## Do not touch

`packages/core/**`, `packages/verifier/**`, `packages/runner/**`, `reports/**`, `docs/**`, `apps/**`.

## Details

1. Add `permissionMatrix(run: RunResult): string` next to `caseMatrix` (`render.ts`, around line 135) and call it right after `${caseMatrix(data)}` in `renderReportHtml`.
2. Collect every `assertion` of every `caseResult` that has a `dimension`. If there are none,
   return `''` — reports of runs without permission checks must not change at all.
3. Rows, in this order and with these labels: `tenant` → "Another customer's data",
   `role` → "Outside its role", `tool` → "A tool it must not use", `sink` → "Data leaving".
   Only rows that have at least one check.
4. Each cell (boundary × agent): counts of `PASS`, `FAIL` (FAIL or ERROR), and "not checked"
   (UNVERIFIABLE or INAPPLICABLE). Render as e.g. `✕ 2 failed · ✓ 5 held · ? 1 not checked`, with
   the cell class `cell fail` when any failed, `cell pass` when all checked ones held and at least
   one was checked, otherwise `cell undecided`. Escape everything with the existing `esc()`.
5. Under the table, one line: "Each cell counts that agent's checks on that boundary across every
   case and attempt. Not checked means the evidence did not exist — for example, a black-box
   agent's calls are never seen — and is never counted as held."
6. Published mode (`mode === 'published'`) must show the same matrix — it carries only the boundary
   labels and counts, no identifiers — and must not add any case id, tenant id or marker string.
7. Footer: change `Acceptance testing for tool-using AI agents.` to
   `Permission and scope tests for AI agents.` and update the one test that pins the old text
   (`report.test.ts`, around line 101).

## Tests (add to `packages/report/test/report.test.ts`)

- A run with no `dimension` on any result → the HTML has no "Permission matrix".
- A run where one agent has a `tenant` check FAIL in one case and PASS in another, and a `sink` check
  UNVERIFIABLE → the matrix shows the right counts for that agent and the right cell classes.
- Published mode: the matrix is present; no marker string or tenant id from the fixture's
  `observed`/`message` appears inside the matrix section.

Build the fixtures by cloning an existing `RunResult` used in the test file and adding
`dimension` to some of its assertion results.

## Acceptance (run these in the worktree; all must pass)

```sh
pnpm vitest run packages/report
pnpm lint && pnpm typecheck
pnpm claims
```

## Report back

Files changed, each command above with its result, and confirm only `packages/report` changed.
