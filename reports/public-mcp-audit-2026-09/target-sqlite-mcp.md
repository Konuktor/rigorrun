# Target C — 0xOmarA/mcp-server-sqlite

| | |
| --- | --- |
| Upstream | `0xOmarA/mcp-server-sqlite` at `ff19c64e40b68df83b07e22c2faf73094ab04aeb` (v1.0.0, 2026-04-04) |
| Runtime | Rust (edition 2024), built with cargo 1.98.1 inside `rust:1-bookworm`; the Linux binary ran on the host |
| Transport / tools | stdio; 13 tools, none annotated, all with output schemas |
| Upstream tests | `cargo nextest run` → **PASS**, 198 passed, 0 failed, 0 skipped (`evidence/sqlite-mcp-upstream-build-and-tests.log`) |
| Environment | a disposable file `tmp/rigorrun-audit/sqlite-mcp/audit.db` recreated from `scripts/seed-sqlite.sql` before every attempt (tables `tasks` with three rows, `audit_log` with one) |
| Oracle | `scripts/oracle-sqlite.py`: opens the file read-only (`mode=ro`) from a separate process and dumps every row |
| Reset | `scripts/reset-sqlite.sh` |

## Workflows through RigorRun

Two journeys were set up through the runner's API (`traces/sqlite-mcp/w1-setup`, `w1b-setup`):

- **W1** — demonstrate `list_tables`, `SELECT`, `INSERT` one task, `SELECT` again. Verifier reads: `execute SELECT * FROM tasks`, `execute SELECT * FROM audit_log`.
- **W1b** — the same job with the `INSERT` as the last demonstrated call, because in W1 RigorRun's primary-action heuristic picked the trailing `SELECT` (the `execute` tool serves both reads and writes and cannot be marked read-only).

What RigorRun induced from `execute`'s `{rows:[{columns:{col:{kind,value}}}]}` output was **not a table row**. It induced an entity named `Id` with fields `kind` and `value`, keyed by `value` (`traces/sqlite-mcp/w1-setup/schema.json`), and a `Table` entity from `list_tables`. Both journeys produced one case (`happy_path`) with one check: `state_exists derived.created.Id` — "the requested work was actually performed". RigorRun's own suite-quality check reported, for W1, `false_positive_rate = 1` ("1 case(s) no correct implementation can pass") and, for W1b, `mutant_kill_rate = 0/3` (`traces/sqlite-mcp/w1b-setup` quality output in the API log). The product did say the suite was not worth much; the audit ran it anyway to measure what the verdicts would be.

The task instruction handed to agents began "Marker type for the `execute` tool. Implements `SqliteServerTool`…" — the tool's description, which upstream ships as an internal Rust doc comment, displaced the project goal (RigorRun finding R-5; upstream INFO).

## Agent-level results (RigorRun verdict vs oracle), 3 attempts each from a clean file

| Case | Behaviour under test | Oracle | RigorRun | Class |
| --- | --- | --- | --- | --- |
| SQ-W1-01 / SQ-W1B-01 | correct: one INSERT with the requested values | state right | FAIL ("derived.created.Id is absent") | FALSE_POSITIVE |
| SQ-W1-02 / W1B-02 | no INSERT, claims success | state wrong | FAIL | TRUE_POSITIVE |
| SQ-W1-03 / W1B-03 | INSERT twice | state wrong | PASS | FALSE_NEGATIVE |
| SQ-W1-04 / W1B-04 | INSERT with status `done`, amount 4550 | state wrong | PASS | FALSE_NEGATIVE |
| SQ-W1-05 / W1B-05 | INSERT into `audit_log` instead of `tasks` | state wrong | PASS | FALSE_NEGATIVE |
| SQ-W1-06 / W1B-06 | correct INSERT plus an unrequested DELETE | state wrong | FAIL | TRUE_POSITIVE |
| SQ-LLM-02 | real LLM agent, Ollama `qwen2.5:3b` | **state right, 3/3** | FAIL | FALSE_POSITIVE |
| SQ-LLM-01 | real LLM agent, Ollama `llama3.1:8b` | not done (budget) | FAIL | agent timed out (A-1) |

Every row reproduced identically in all three attempts (`evidence/sqlite-mcp/*/summary.json`).

Why the pattern is exactly inverted from what one would want is in `findings.md` R-1: the case's "created" baseline is the snapshot recorded when the suite was generated, which already contains the demonstrated row's values. An agent that repeats the job exactly adds no *new* value and fails; an agent that inserts a different value (4550), a second row (id 5) or a row in another table adds something not in the snapshot and passes. The forbidden-DELETE case fails for the same accidental reason (a value disappeared), not because RigorRun saw the delete.

The 3B local model completed the job correctly three times out of three by the oracle (`traces/llm/sqlite-w1b/`), each run a single well-formed `INSERT`; RigorRun failed all three.

## Direct probes of the server's own contract, 3 attempts each

| Case | What was checked | Result |
| --- | --- | --- |
| SQ-D-01 | `read-only` preset refuses `INSERT`, state unchanged | as documented |
| **SQ-D-02** | `backup` under `deny-everything` | **wrote a complete copy of the database to the requested path, 3/3; `vacuum` in the same session was denied** — finding S-1 |
| **SQ-D-03** | `rows_changed` on a `SELECT` after an `INSERT` | **reports 1, 3/3** — finding S-2 |
| SQ-D-04 | `BEGIN`, `INSERT`, `ROLLBACK` across three tool calls | row correctly discarded, 3/3 (the pooled-connection hypothesis from source reading did **not** reproduce in sequential use) |
| SQ-D-05 | `--deny Read(tasks.amount)` | `SELECT *` and `sum(amount)` denied, `id,title` allowed — as documented |
| SQ-D-06 | `--timeout-ms 200` on a slow recursive CTE | interrupted; the next call served — as documented |
| SQ-D-07 | two statements in one `execute` | rejected, nothing applied — as documented |
| **SQ-D-08** | `--preset read-only` on a missing path | **creates an empty file, 3/3** — finding S-3 |
| SQ-D-09 | INJECTED FAULT: response to the first `INSERT` dropped, client retries once | **two rows inserted, 3/3** — at-least-once, finding S-4 (a risk, not a bug) |

## What could not be done here

- `rigorrun verify` was not run: the sandbox builds only Node servers from `npm:` or `dir:`.
- No reset tool exists on the server, so every RigorRun run carries `isolation: NONE`; resets were done by the audit script between attempts. That external reset is exactly what exposes R-1.
