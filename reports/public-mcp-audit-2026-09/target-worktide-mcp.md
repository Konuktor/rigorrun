# Target B — Worktide-IO/worktide-mcp

| | |
| --- | --- |
| Upstream | `Worktide-IO/worktide-mcp` at `4dbd0851b8c16b7acf32e1ea45a1234c425cd19e` (0.1.0, 2026-07-10); backend `Worktide-IO/worktide` at `07393173732835c12c4cf763d73860fd82068ae0` (2026-08-01) |
| Runtime | Node 22; `pnpm install --ignore-workspace && pnpm build` (tsc); launched as `node dist/index.js` (stdio) |
| Transport / tools | stdio; 18 dotted tools, none annotated, no output schemas; every result is JSON inside a text content block |
| Upstream tests | **none** — the repository has no test suite; `package.json`'s `test:tools` points at `src/dev-runner.ts`, which does not exist |
| Environment | a self-authored docker compose stack from upstream's own `docs/INSTALL-docker-compose.md` (FrankenPHP dev image, MySQL 8.0, Valkey; no ddev, no TLS, no Mercure/Meilisearch/S3, no egress); fixtures loaded; a personal access token minted through `POST /v1/personal_access_tokens`; project `AUD` with tasks AUD-1..3 seeded by `scripts/seed-worktide.py` |
| Oracle | `scripts/oracle-worktide.py`: the REST API (JSON-LD, token in `X-Worktide-Token`) plus direct MySQL queries inside the stack |
| Reset | `scripts/reset-worktide.sh` restores a mysqldump snapshot taken right after seeding |

The public deployment was never contacted. The token lives only in the local stack's files; case files carry a placeholder the runner resolves at run time.

## Through RigorRun: refused after the demonstration

Two timer workflows were set up (`traces/worktide-mcp/w2-setup`, `w3-setup`), because the timer tools are the only state-changing tools that work at these commits (below). Verifier reads: `time.runningTimer`, `time.report` (grouped by task) and `tasks.search`. RigorRun's read-nomination probe reported no problem. The demonstration — start, a real 61-second wait, stop — ran through RigorRun and changed the system (the oracle shows the new time entry). Then `compile` refused:

> RigorRun watched "time.stop" run, but it cannot see any records in this system, so it has nothing to compare before against after. The reads nominated for verification returned text rather than structured records…

worktide-mcp answers every tool with `content: [{type: "text", text: "<json>"}]` and no `structuredContent`. The probe accepts that shape (it looks at `structured ?? content`); the demonstration keeps only `structured`. That mismatch is RigorRun finding **R-8**. The consequence for this target: **no RigorRun verdict exists for Worktide**, and every Worktide case below is a direct probe of the server against the oracle. The audit did not modify the server to emit `structuredContent`, because that would have been auditing a server nobody ships.

## Direct probes, 3 attempts each from the snapshot

| Case | Tool(s) | Result |
| --- | --- | --- |
| **WT-D-01** | `tasks.get AUD-1` | `[404] No route found for "GET …/v1/v1/tasks/<uuid>"` — finding W-1 |
| **WT-D-02** | `tasks.update AUD-3 priority=urgent` | `[404] … "PATCH …/v1/v1/tasks/<uuid>"`; priority unchanged — W-1 |
| **WT-D-03** | `tasks.complete AUD-1` | `[404] … "PATCH …/v1/v1/tasks/<uuid>"`; status unchanged — W-1 |
| **WT-D-04** | `projects.get AUD`, `projects.archive AUD` | both `[404] …/v1/v1/projects/<uuid>` — W-1 |
| **WT-D-05** | `tasks.create` in AUD | `[500] Typed property App\Entity\Task::$workspace must not be accessed before initialization`; no task created — W-2 |
| **WT-D-06** | `tasks.addDependency AUD-1 → AUD-2` | `[500] … TaskDependency::$workspace …`; dependency count unchanged — W-2 |
| **WT-D-07** | `time.log 30 min` | `[500] … TimeEntry::$user …`; entry count unchanged — W-2 |
| **WT-D-08** | `projects.create MCPX` | `[500] … Project::$workspace …`; no project — W-2 |
| WT-D-09 | `time.start`, `time.stop` | one new time entry, none running — works |
| WT-D-10 | `time.start` twice, `time.stop` | the second start closes the first (`closedTimeEntryId`), two entries — as the tool reports |
| WT-D-11 | `time.stop` with nothing running | `[400] No timer running.`, nothing changed |
| WT-D-12 | `projects.create` with a 17-character key | rejected by the tool's own schema before any request |
| WT-D-13 | `tasks.get AUD-999` | clean "not found" |

Every row reproduced identically in all three attempts (`evidence/worktide-mcp/*/summary.json`).

## What the two upstream findings mean together

Eight of the ten state-changing tools cannot change state at these commits: five because the client doubles the documented `/v1` base path on every resolved IRI (W-1, a defect in the MCP regardless of backend version), three because the create payloads omit the `workspace`/`user` relation the backend now requires (W-2 — the MCP commit predates the backend commit by three weeks, so this may be drift; the audit reports it against exactly these two commits). The backend answering the missing relation with a 500 rather than a validation error is W-3. Only `time.start` / `time.stop` work, and `time.stop` takes no argument, so it stops whichever timer is running.

## What could not be done here

- No agent-level case and no real-LLM case: RigorRun could not build a suite (R-8), and the direct probes already show the mutating tools failing before any agent choice matters.
- `projects.archive` reversibility, `tasks.complete` status selection (the code filters on `isCompleted`, the API field is `completed`) and assignee handling in `tasks.create` are all masked by W-1/W-2 and remain untested.
- `rigorrun verify` was not run: the package is not on npm, and `dir:` verification of an unpublished TypeScript build was not attempted.
