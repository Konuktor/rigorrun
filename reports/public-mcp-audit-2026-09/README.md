# Public MCP reliability audit — September 2026

**Question.** Can RigorRun find real, reproducible failures in external, state-changing MCP/agent workflows?

**Short answer.** The audit found real, reproducible upstream failures — <!-- n:totals.confirmed_upstream_findings -->10<!-- /n --> confirmed findings across the three servers, all 3/3 from a clean reset, all with an independent oracle — but RigorRun itself found almost none of them. Where RigorRun could reach a verdict, its verdicts were systematically inverted by one defect in how it baselines "what changed", and for one of the three servers it could not reach a verdict at all. The strongest results of this audit are about RigorRun.

| | |
| --- | --- |
| RigorRun | 0.2.0, repository sources at `07dda8c738d6daada161ffcf2bfc046b3c874ac5` |
| Targets | `sandraschi/email-mcp` `fef2a06`, `Worktide-IO/worktide-mcp` `4dbd085` (+ backend `0739317`), `0xOmarA/mcp-server-sqlite` `ff19c64` |
| Cases | <!-- n:totals.cases_total -->58<!-- /n --> cases, each run three times from a clean reset; <!-- n:totals.rigorrun_scored_cases -->26<!-- /n --> of them scored RigorRun's verdict against an independent oracle |
| RigorRun's score | TP <!-- n:totals.true_positives -->10<!-- /n -->, TN <!-- n:totals.true_negatives -->0<!-- /n -->, FP <!-- n:totals.false_positives -->6<!-- /n -->, FN <!-- n:totals.false_negatives -->10<!-- /n --> |
| Injected faults | <!-- n:totals.injected_failures -->3<!-- /n -->, of which the oracle detected <!-- n:totals.injected_failures_detected_by_oracle -->2<!-- /n --> and RigorRun detected <!-- n:totals.injected_failures_detected_by_rigorrun -->0<!-- /n --> (the third died at RigorRun's case budget before the retry) |
| Findings | <!-- n:totals.findings_total -->21<!-- /n --> in total: <!-- n:totals.confirmed_upstream_findings -->10<!-- /n --> about the targets, <!-- n:totals.confirmed_rigorrun_findings -->8<!-- /n --> about RigorRun, the rest "no issue" and agent-level notes |

Every number above is generated from the artefacts by `scripts/aggregate-results.mjs` and checked against this text by `node scripts/aggregate-results.mjs --check`.

## Read in this order

1. `executive-summary.md` — what was found, what it means, what it does not mean.
2. `findings.md` — every finding in the evidence format, with case ids, root causes and reproduction rates. `findings.json` is the same list, machine-readable.
3. `target-email-mcp.md`, `target-worktide-mcp.md`, `target-sqlite-mcp.md` — per-target reports.
4. `methodology.md` — how the audit worked, how RigorRun was driven headlessly, how RigorRun was scored, and the two deviations.
5. `public-case-study.md` — the write-up.
6. `results.json` — the machine-readable results.
7. `disclosure/` — draft issues for the maintainers, **not submitted**.
8. `evidence/` — per-case before/after snapshots and traces (`<target>/<case>/attempt-N/`), the final clean-state re-run of every confirmed case (`final-pass/`), upstream test logs, and RigorRun's own test runs before and after the audit.

## Reproducing

```bash
# from the RigorRun repository root, with Docker, Node 22, pnpm, uv and Ollama available
git clone https://github.com/sandraschi/email-mcp tmp/rigorrun-audit/email-mcp && git -C tmp/rigorrun-audit/email-mcp checkout fef2a06e9313aa69e7fd1572e18c53ccfc082bcc
git clone https://github.com/Worktide-IO/worktide-mcp tmp/rigorrun-audit/worktide-mcp && git -C tmp/rigorrun-audit/worktide-mcp checkout 4dbd0851b8c16b7acf32e1ea45a1234c425cd19e
git clone https://github.com/Worktide-IO/worktide tmp/rigorrun-audit/worktide && git -C tmp/rigorrun-audit/worktide checkout 07393173732835c12c4cf763d73860fd82068ae0
git clone https://github.com/0xOmarA/mcp-server-sqlite tmp/rigorrun-audit/sqlite-mcp && git -C tmp/rigorrun-audit/sqlite-mcp checkout ff19c64e40b68df83b07e22c2faf73094ab04aeb
# build/install per upstream (see evidence/environment.md); Worktide: tmp/rigorrun-audit/worktide/compose.audit.yaml is described in methodology.md
R=reports/public-mcp-audit-2026-09
bash $R/scripts/reset-sqlite.sh && python3 $R/scripts/run-cases.py $R/cases/sqlite-mcp/SQ-D-02-backup-under-deny-everything.json --repeat 3
node $R/scripts/journey.mjs setup $R/scripts/specs-sqlite-w1b.json --home tmp/rigorrun-audit/home-sqlite-w1b --out $R/traces/sqlite-mcp/w1b-setup
node $R/scripts/aggregate-results.mjs --check
```

Case files under `cases/` state the exact server command, calls or agent, and the `expect` predicate; `{REPO}` in them is the RigorRun checkout. The Worktide token and workspace id are read from files in the local stack and never appear in the tree.

## What is deliberately not here

Credentials, real addresses, real mail, machine-specific paths, and anything from a system that was not created for this audit. The upstream clones are git-ignored under `tmp/`.
