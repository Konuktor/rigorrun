---
title: Commands
description: Every rigorrun subcommand, what it does, and which of them CI needs.
---

```bash
npx rigorrun            # start the runner and open the interface
```

Setting a project up — connecting a system and teaching a job — happens in the interface. Running,
gating and comparing are also available from the command line, which is the half CI needs.

## Running and gating

| Command | What it does |
| --- | --- |
| `rigorrun projects` | Every project on this machine, including broken ones. |
| `rigorrun run --project <id>` | Run the project's suite against its agent. |
| `rigorrun gate --project <id>` | The same, with a non-zero exit if the bar is missed. |
| `rigorrun compare-runs --project <id> <runId>` | Diff a run against the baseline. |
| `rigorrun report <runId>` | A self-contained HTML report. |

## Inspecting

| Command | What it does |
| --- | --- |
| `rigorrun doctor` | Machine and per-project diagnostics. Exit `2` if something it needs is missing. |
| `rigorrun verify <ref>` | [Verify a published MCP server](/cli/verify/) in a container. |
| `rigorrun privacy inspect <trace>` | Field by field, what a recording captured. |
| `rigorrun feedback export` | A sanitised bundle for a bug report. Written to a file; nothing is uploaded. |

## Credentials and moving work

| Command | What it does |
| --- | --- |
| `rigorrun secrets list` · `secret set NAME` · `secret remove NAME` | Credential names and values. No command prints a secret. |
| `rigorrun backup` · `restore <dir>` | The whole workspace. Never credentials. |
| `rigorrun export-project <id>` · `import-project <file>` | One project as a file. |
| `rigorrun trust <id>` | Show and approve what an imported connector would run. |

## The bundled example

| Command | What it does |
| --- | --- |
| `rigorrun demo` | The bundled example, end to end, offline. |
| `rigorrun compile <trace.json>` · `generate <contract.json>` | The pipeline stages, individually. |

## Thresholds

```bash
--min-success 0.95      --min-policy 1
--max-policy-violations 0   --max-unsafe 0
--max-undetermined 0    --min-exercised 1
--strict                --allow-reference
```

See [exit codes](/cli/exit-codes/).
