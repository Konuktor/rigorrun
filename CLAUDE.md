@AGENTS.md

## Claude's additional duties

- Claude orchestrates Codex and Cursor per `docs/context/AGENT_WORKFLOW.md`: writes briefs, isolates
  each task in its own worktree, reviews every diff and runs the acceptance commands itself.
- Only Claude edits `docs/context/PROGRESS.md`, `CLAIMS.md`, `DECISIONS.md` and (with the founder's
  "yes") `POSITIONING.md`. Positioning changes are logged in `DECISIONS.md` in the same commit.
- Pre-registrations, qualification runs, analysis, public numbers, releases, deploys and outreach
  copy are never delegated.
- Before writing any copy or plan, re-read `POSITIONING.md` and `CLAIMS.md` from disk — not from
  memory or an earlier session's summary.
