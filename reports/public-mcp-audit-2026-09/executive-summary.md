# Executive summary

Three third-party MCP servers with real state-changing tools were run locally, unmodified, and audited with RigorRun 0.2.0 driven through its own product path. Every case had its ground truth written before the run and judged by an oracle that reads the system outside the MCP process. Every reported finding reproduced three times from a clean reset.

## What broke upstream (<!-- n:totals.confirmed_upstream_findings -->10<!-- /n --> confirmed findings)

- **email-mcp.** The two reads that the documented local-testing setup depends on (`check_inbox`, `search_emails` against MailHog/Mailpit) crash with a `TypeError` — a signature that was widened on the base class but not on the local service (E-1). Thirteen advertised tools — the whole auto-response and watcher feature — fail with `ModuleNotFoundError` because their modules were never committed (E-2). The upstream suite passes 220 tests and covers neither.
- **worktide-mcp.** With the base URL the README documents, every tool that resolves an item by id doubles the `/v1` prefix and gets a 404: `tasks.get`, `tasks.update`, `tasks.complete`, `projects.get`, `projects.archive` (W-1). `tasks.create`, `tasks.addDependency`, `projects.create` and `time.log` answer 500 against the current backend because the payloads carry no workspace or user (W-2); the backend's 500 in place of a validation error is W-3. Only the timer tools change state.
- **mcp-server-sqlite.** The access-control model is enforced by SQLite's authorizer, which `backup` never passes through: under `deny-everything`, or under a column-denied read-only policy, a caller can write a complete copy of the database, denied columns included, to any path (S-1 — disclose privately first). `rows_changed` leaks across statements (S-2) and a read-only server creates a missing file (S-3). Everything else — presets, column denies, timeouts, single-statement enforcement, sequential transactions — behaved exactly as documented.
- **All three** deliver twice when a response is lost and the client retries once (E-3, S-4). That was an INJECTED FAULT, reported as a risk: none of them promises exactly-once.

## What RigorRun did and did not find

RigorRun reached a verdict on <!-- n:totals.rigorrun_scored_cases -->26<!-- /n --> cases (sqlite and the email supplement). Against the oracle it scored TP <!-- n:totals.true_positives -->10<!-- /n -->, TN <!-- n:totals.true_negatives -->0<!-- /n -->, FP <!-- n:totals.false_positives -->6<!-- /n -->, FN <!-- n:totals.false_negatives -->10<!-- /n -->. Every correct agent — including a real local model that did the sqlite job right three times out of three — was failed, and duplicate, wrong-value and wrong-entity agents were passed. One defect explains the pattern (R-1): for a connector that cannot seed a world, the "created" baseline is the snapshot recorded when the suite was generated, which already contains the demonstrated record, rather than a fresh read at case start. RigorRun's own suite-quality gate did warn in every journey that the suite could not separate a good agent from a bad one; the audit ran the suites anyway to measure what the verdicts would say.

For Worktide RigorRun never reached a verdict: its read-nomination probe accepts JSON-in-a-text-block, its demonstration capture does not, and compile refused after the job had been demonstrated (R-8). For email-mcp on MailHog it refused correctly — the only read that could have shown the change is the one that crashes upstream — and a labelled GreenMail supplement was needed to measure it on email at all.

Structurally, RigorRun has no independent oracle (R-2), no headless setup (R-6), a fixed 15-second case budget shorter than its own 20-second tool timeout (R-4), and cannot induce rows from a column-cell result shape (R-3).

## Strength of the evidence

- Verification strength, as RigorRun labelled its own runs: `PARTIAL` everywhere it ran, `isolation: NONE` (none of the servers publishes a reset; resets were external).
- The oracle's evidence is authoritative for every case: MailHog's HTTP API, GreenMail over IMAPS, SQLite opened read-only from another process, Worktide's REST API cross-checked against MySQL.
- Reproduction: 3/3 for every confirmed finding; RigorRun's structural findings are backed by the cited source lines and the journey traces.

## What this does not establish

Nothing about the MCP-server population: three young, small servers on one machine on one day. Nothing about RigorRun's bundled demo path, which was not under test. And the upstream findings are stated against the pinned commits only; W-2 in particular may be version drift between two repositories rather than an original defect.

## Recommendations

For RigorRun: read the live state at case start for `seed: none` connectors, or refuse to grade until a reset exists; parse JSON-in-text results in the demonstration path exactly as the probe does; make the case budget configurable and larger than the tool timeout; and let a project attach a second read-only connector as an independent oracle. For the maintainers: the disclosure drafts under `disclosure/`, with the sqlite one going privately first.

## Addendum, 2026-10-01: fixed in 0.3.0

This section was added after publication. Nothing above it has changed.

- **The defect behind the pattern (R-1) and the ones found with it are fixed.** Re-run against the same frozen benchmark, labels and oracles, RigorRun scored TP 19, TN 4, FP 0, FN 0 on the 23 cases that reached a verdict; 3 cases did not reach one and are counted as not passing (`remediation/before-after.md`, `remediation/after-results.json`).
- **A pre-registered requalification returned GO on all 12 gates** at product commit `28e8ec3`, with an independent oracle on every attempt: TP 59, TN 13, FP 0, FN 0 over 72 generated attempts (`requalification-v3/README.md`, `release-gate.json`, `results-v2.json`). The first attempt, v2, returned NO_GO and is kept as it was (`requalification/README.md`).
- **0.3.0 is that commit** plus its version strings and one hardening fix, record ids from data never touching an object prototype (`2321161`, `e4ba6aa`). It is published with npm provenance.
- **0.2.0 should not be used on real systems.** Use 0.3.0 or later.

The upstream findings above are unaffected: they are statements about the three servers, not about RigorRun.
