# T-XXX · <short title>

- **Agent:** codex | cursor
- **Base branch:** <branch>
- **Worktree:** ~/RigorRun-agents/<agent>-T-XXX (branch agent/<agent>/T-XXX)
- **Time box:** <e.g. 45 min>

## Read first

`AGENTS.md`, `docs/context/POSITIONING.md`, `docs/context/CLAIMS.md`.

## Goal

<one paragraph: what is true when this is done, in user-visible terms>

## Files you may change

- <path>
- <path>

## Do not touch

- `reports/**`, `docs/context/CLAIMS.md`, `docs/context/POSITIONING.md`
- <anything else specific>

## Details

<the facts the agent needs: current behaviour with file:line, the required change, edge cases>

## Acceptance (run these; all must pass)

```sh
<pnpm vitest run packages/… >
pnpm lint && pnpm typecheck
pnpm claims
```

## Report back

Files changed, each command above with its result, anything not done and why. Say whether anything
under `packages/` changed.
