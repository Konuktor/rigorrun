# How work is delegated (Claude · Codex · Cursor)

> Claude orchestrates: it writes briefs, delegates, reviews and does the critical work itself.
> Codex and Cursor implement scoped tasks. Decision: [DECISIONS.md](DECISIONS.md) D-006.

## Who does what

| Work                                                                                                                                                                  | Who                              | Why                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------- |
| Engine core (`core`, `runner`, `verifier`, `proxy`), Stripe pack, integration, review, merges                                                                         | Claude                           | Highest coupling; qualification depends on it |
| Self-contained modules with clear tests (fixture MCP servers, harness code, report rendering, a bug fix with a failing test)                                          | Codex                            | Larger tasks, runs one at a time              |
| Small edits (doc pages, copy-pinning tests, `llms.txt`, examples, a site page)                                                                                        | Cursor                           | Cheap and parallel; limited credits           |
| **Never delegated:** pre-registrations, qualification runs, analysis and any number that goes public, `CLAIMS.md`, `POSITIONING.md`, releases, deploys, outreach copy | Claude, with the founder's "yes" | An agent may tune a result or invent a figure |

## The loop

1. **Brief.** Claude copies [tasks/TEMPLATE.md](tasks/TEMPLATE.md) to `docs/context/tasks/<id>.md`
   (id like `T-012-containment-arrays`) and fills it: goal, files, allowed and forbidden areas,
   acceptance commands, time box. It is committed on the base branch before delegation.
2. **Isolate.** One git worktree and branch per task, never the shared checkout:
   ```sh
   git -C ~/RigorRun-dev worktree add ~/RigorRun-agents/<agent>-<id> -b agent/<agent>/<id> <base>
   cd ~/RigorRun-agents/<agent>-<id> && pnpm install --frozen-lockfile
   ```
3. **Run** (in the background; Claude is notified when it exits).
   - Codex — **one run at a time** (single-use refresh tokens):
     ```sh
     codex exec -C ~/RigorRun-agents/codex-<id> -s workspace-write --ignore-user-config --ignore-rules \
       -m gpt-5.6-sol -o ~/RigorRun-agents/codex-<id>.last.md "$(cat docs/context/tasks/<id>.md)"
     ```
   - Cursor — may run beside Codex:
     ```sh
     cursor-agent -p --output-format text --workspace ~/RigorRun-agents/cursor-<id> --trust --force \
       --sandbox enabled "$(cat docs/context/tasks/<id>.md)" > ~/RigorRun-agents/cursor-<id>.log
     ```
4. **Review — Claude, never the agent's own word.**
   - `git -C <worktree> diff <base>...` read in full; nothing outside the brief's files.
   - Run the brief's acceptance commands in the worktree, plus `pnpm lint && pnpm typecheck` and
     `pnpm claims`.
   - Check the diff against [POSITIONING.md](POSITIONING.md) and [CLAIMS.md](CLAIMS.md): no new
     claim, no "canary" for leak markers, no edits under `reports/`.
5. **Land or return.** Merge into the base branch (squash, message ends with the agent's name), or
   send the agent back with the review notes appended to the brief. Remove the worktree after.
6. **Record.** Claude updates [PROGRESS.md](PROGRESS.md): task, agent, status, commit, "verified by".

## Rules every agent reads (also in `AGENTS.md`)

- Read `docs/context/POSITIONING.md`, `CLAIMS.md` and `PROGRESS.md` before anything else.
- Never write copy that states a `BUILDING`/`NOT_BUILT` claim as fact. `pnpm claims` must pass.
- `docs/archive/**` and files with an ARCHIVED banner are history, not instructions.
- Never touch `reports/**`, pre-registrations, qualification harnesses or `CLAIMS.md`.
- Any change under `packages/` changes the qualified tree: say so in the summary.
- Stay inside the brief's files. If the task needs more, stop and say what and why.
- Finish with a summary: files changed, commands run and their result, anything left undone.

## Status of the tools (update when it changes)

| Tool                    | Installed                         | Logged in                                           | Last verified |
| ----------------------- | --------------------------------- | --------------------------------------------------- | ------------- |
| Codex CLI 0.156.1       | yes (`~/.local/bin/codex`)        | yes (ChatGPT)                                       | 2026-10-02    |
| Cursor agent 2026.10.01 | yes (`~/.local/bin/cursor-agent`) | **no** — the founder runs `cursor-agent login` once | —             |
