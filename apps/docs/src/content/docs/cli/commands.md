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

| Command                                               | What it does                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rigorrun projects`                                   | Every project on this machine, including broken ones.                                                                                                                                                                                                                                                              |
| `rigorrun run --project <id>`                         | Run the project's suite against its agent.                                                                                                                                                                                                                                                                         |
| `rigorrun gate --project <id>`                        | The same, with a non-zero exit if the bar is missed. `--agent <name>` is needed only when the project has more than one agent; with several and none named, the gate refuses rather than picking one.                                                                                                              |
| `run` · `gate` `--project <id> --case <case-id>`      | Only the named cases, in the suite's order; repeat `--case` for more. An id the suite does not have stops the run before it starts. The result says which cases it covered, and such a run never becomes the baseline. `gate` over some of the cases is never a release PASS: it exits 3 unless one of them fails. |
| `rigorrun agent add --project <id> --black-box <url>` | Connect an agent that answers on an address and does each case's work itself. Probed before it counts as connected. `--allow-host` names a remote host (https only); `--header Name=secret` takes a secret's name, never its value; `--body-template`, `--completion`, `--claim-path`, `--settle`.                 |
| `rigorrun agent list --project <id>`                  | The project's agents, and whether each one answers.                                                                                                                                                                                                                                                                |
| `rigorrun compare-runs --project <id> <runId>`        | Diff a run against the baseline.                                                                                                                                                                                                                                                                                   |
| `rigorrun report <runId>`                             | A self-contained HTML report.                                                                                                                                                                                                                                                                                      |

## Packs

A pack is a system RigorRun ships its own client for. Its setup commands are its own, named by the
pack's id as the first word — `rigorrun <pack> --help` lists them, and `rigorrun --help` ends with
the packs in your build.

## Inspecting

| Command                            | What it does                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `rigorrun doctor`                  | Machine and per-project diagnostics. Exit `2` if something it needs is missing. |
| `rigorrun verify <ref>`            | [Verify a published MCP server](/cli/verify/) in a container.                   |
| `rigorrun privacy inspect <trace>` | Field by field, what a recording captured.                                      |
| `rigorrun feedback export`         | A sanitised bundle for a bug report. Written to a file; nothing is uploaded.    |

## Credentials and moving work

| Command                                                              | What it does                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `rigorrun secrets list` · `secrets set NAME` · `secrets remove NAME` | Credential names and values. `set` prompts without echo; in CI, `RIGORRUN_SECRET__<NAME>`. No command prints a secret. |
| `rigorrun backup` · `restore <dir>`                                  | The whole workspace. Never credentials.                                                                                |
| `rigorrun export-project <id>` · `import-project <file>`             | One project as a file.                                                                                                 |
| `rigorrun trust <id>`                                                | Show and approve what an imported connector would run.                                                                 |

## The bundled example

| Command                                                      | What it does                                                                                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rigorrun demo`                                              | A real recorded run, replayed offline: what the model said beside what the system held. `--live` runs the bundled example end to end now; `--report <file>` writes every case to a page. |
| `rigorrun compile <trace.json>` · `generate <contract.json>` | The pipeline stages, individually.                                                                                                                                                       |

## Thresholds

```bash
--min-success 0.95      --min-policy 1
--max-policy-violations 0   --max-unsafe 0
--max-undetermined 0    --min-exercised 1
--strict                --allow-reference
```

See [exit codes](/cli/exit-codes/).
