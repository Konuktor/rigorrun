# Requalification: N-1, held-out sets and MCP preflight wrappers

These wrappers re-run measurements from the remediation and the final qualification at the requalification's product under test (`../product-under-test.json`). Each one either imports a committed script from its own file and replaces only the module-level names that say where records, evidence, traces and homes go, or, for the shell and TypeScript cases, is a copy whose every difference is listed. Nothing under `../../remediation/`, `../../final-qualification/`, `../../cases/` or `../../scripts/` is edited or written.

Every wrapper runs `requalification/scripts/product-under-test.mjs --check` first and refuses on a non-zero exit. The final qualification's check pins `a9edbec` and is not used.

## Order

Run from the repository root, one command at a time: nothing here may overlap (see "Why this order" below). `A=reports/public-mcp-audit-2026-09`.

1. `node $A/requalification/scripts/product-under-test.mjs --check`
2. `bash $A/requalification/n1/run-heldout-inprocess-rq.sh` (no stack needed)
3. `node_modules/.bin/tsx $A/requalification/mcp/mcp-preflight.ts` (no stack needed). The per-target statements (`targets.json`) and `mcp-compatibility.md` are written after this run, from its evidence; the copy does not write them.
4. `bash $A/remediation/n1/scripts/worktide-stack.sh up` (committed; it starts the Worktide stack and restores the seeded snapshot, and writes nothing in the report tree)
5. `python3 $A/requalification/n1/run-eh-wt-03-rq.py setup`
6. `python3 $A/requalification/n1/run-eh-wt-03-rq.py run`
7. `python3 $A/requalification/n1/run-heldout-worktide-v2-rq.py`
8. `bash $A/remediation/n1/scripts/worktide-stack.sh down`
9. `bash $A/requalification/scripts/final-verification.sh all`
10. `python3 $A/requalification/scripts/rq_hygiene.py redact --check` and `... scrub --check` over the new evidence, before it is committed

**Why this order:**
- The in-process run puts a temporary test file in `packages/runner/test/`. While it exists, product sources differ from HEAD, so no other product check may run.
- Final verification runs the whole suite and e2e, so it runs last, with no stack up.
- The remediation's run notes record a host out of memory stretching target calls, so the Worktide runs are never run concurrently.

## `run-eh-wt-03-rq.py`: EH-WT-03 after the N-1 fix

**Wraps** `remediation/n1/scripts/setup-w2.py` (which loads `remediation/scripts/setup-after.py`) and `remediation/n1/scripts/run-eh-wt-03.py` (which loads the frozen `remediation/heldout/external/run-heldout-external.py` and, through it, `scripts/run-cases.py`). All are imported unmodified.

**`setup`.** `setup-w2.py` spells its output paths inside its `__main__` block, so that block does not run. The same names are set on the loaded `setup-after` module, and its `main()` gets the same argv (`--fresh --only home-worktide-w2`).

| Replaced | Value |
| --- | --- |
| `setup.AFTER` | `requalification/n1/evidence/w2-setup` |
| `setup.HOMES` | `tmp/rigorrun-audit/rq-n1-homes` (git-ignored) |
| `setup.FAULT_LOG` | `requalification/n1/evidence/w2-setup/traces/email-mcp/fault-proxy.unused.jsonl` (only its directory is created) |
| `setup.JOURNEYS` | the same tuples, with the gm-fault override pointed at the new `FAULT_LOG`, as `rq_paths.setup_module` does. `--only` never reaches that journey. |

**`run [--attempts ...] [--also-sanity] [--rebuild]`.** These are the original's options. The default is the committed one: EH-WT-03 attempts 1, 2 and 3.

| Replaced | Value |
| --- | --- |
| `N1` | `requalification/n1`. `results_path()`, `evidence_root()`, `project()` and `main()`'s fault-log path all derive from it. |
| `TRACES` | `requalification/n1/evidence/agent-traces`. It is computed from `N1` at import, so it is replaced separately. |
| argv | always `--measurement eh-wt-03 --setup evidence/w2-setup`. The wrapper does not accept either option. |

Before `main()` runs, the wrapper checks that `results_path()` and `evidence_root()` resolve to the paths below.

**Writes:**
- `requalification/n1/eh-wt-03.json`
- `requalification/n1/evidence/eh-wt-03/measurement.json` and `attempt-<n>/<case>/` (`before.json`, `after.json`, `rigorrun-run.json`, `rigorrun-run.stdout.txt`)
- `requalification/n1/evidence/agent-traces/<caseId>.json`, written by the scripted agents
- `requalification/n1/evidence/w2-setup/` (`projects.json`, `journeys.json`, `traces/worktide-mcp/w2-setup/`)
- the project home under `tmp/rigorrun-audit/rq-n1-homes/`

## `run-heldout-worktide-v2-rq.py`: the Worktide v2 held-out set

**Wraps** `remediation/heldout-worktide-v2/run-heldout-v2.py`, imported unmodified. Its own `main()` runs, so `verify_freeze()` and the product-sources refusal both stay. Options are the original's: `[--only V2-T-01 ...] [--fresh-setup]`.

| Replaced | Value |
| --- | --- |
| `HOMES` | `tmp/rigorrun-audit/rq-heldout-v2-homes`: journey homes, their `v2-project.json` markers, and `expanded_playbook()`'s playbooks under `playbooks/` |
| `EVIDENCE` | `requalification/n1/evidence/heldout-worktide-v2`: `setup/<journey>/`, and `<case>/` via `heldout.EVIDENCE`, which `main()` sets from it |
| `TRACES` | `requalification/n1/evidence/heldout-worktide-v2/agent-traces` |
| `RESULTS` | `requalification/n1/heldout-worktide-v2-results.json` |

`HERE` is not replaced: the frozen files are read and hashed there.

## `run-heldout-inprocess-rq.sh`: the in-process held-out set

This uses the same method as `final-qualification/scripts/run-heldout-inprocess.sh`:
- The frozen `remediation/heldout/inprocess/heldout.inprocess.test.ts` is copied to `packages/runner/test/zz_heldout_rq.test.ts`.
- Only its `RESULTS` line is replaced, and the script refuses unless that line occurs exactly once.
- The copy is removed by an `EXIT` trap and again after vitest.
- `HELDOUT_COMMIT` is `productCommit` from `requalification/product-under-test.json`.

**Writes** `requalification/n1/evidence/heldout-inprocess/run.log` (ending `exit N`) and `results.json`. While the run lasts, it also writes the temporary test copy.

## `../mcp/`: MCP compatibility preflight

These are copies of `final-qualification/scripts/mcp/{mcp-preflight.ts,preflight_server.py,modern_only_server.py}`. Each file's header lists every line that differs from the original and gives the `diff` command that shows it.

In `mcp-preflight.ts`, six lines change:
- the usage path in the doc comment;
- the two `packages/...` imports, from five `../` to four;
- `FQ = resolve(HERE, '..')`, so the unchanged `REPO` line still names the repository;
- `OUT = join(HERE, 'evidence', 'mcp-preflight')`;
- the `generatedBy` string.

The helper servers are started through `join(HERE, ...)`, so those lines are unchanged. Both servers are byte-identical below a comment header inserted after the shebang.

**Writes** `requalification/mcp/evidence/mcp-preflight/<check>.json` and `summary.json`, plus temporary directories under the OS temp directory, which it removes.

## `../scripts/final-verification.sh`

This is `final-qualification/scripts/final-verification.sh` with three differences:
- Logs go to `requalification/evidence/final/`.
- The product check is the requalification's.
- The lint list covers:
  - TypeScript changed since `07dda8c` under `packages/` and `apps/`;
  - every `.ts` and `.mjs` file in `requalification/`, whether committed or not (git-ignored files and anything under an `evidence/` directory are excluded).

Every log still ends with `exit N`.

## Guards and recorded fields

**Write guard.** Both Python wrappers record the size and modification time of every file under `remediation/`, `final-qualification/`, `cases/` and `scripts/` before they start. When they end they compare again, print any file that was created, removed or rewritten, and exit 1. A concurrent writer in those trees also trips the guard, by design.

**Names deliberately not replaced**, because nothing these wrappers call writes through them:
- the held-out runner's own `TRACES`, `RESULTS` and `HOMES`, used only by its `main()`, `setup()` and `worktide_project()`, which are never called;
- `setup-after`'s `ORIGINAL_TRACES`, a prefix it matches against, not a destination.

Nothing else in those scripts writes anywhere, as checked:
- no EH-WT or v2 case has a `pre` step;
- the W2 and v2 specs register no agents, and neither does the original W2 home;
- `journey.mjs` writes only to `--home` and `--out`;
- `scripted-agent.py` writes only to its trace directory;
- `rest-side-channel.py`, `reset-worktide.sh` and `oracle-worktide.py` write no files.

**Fields the committed code records as it always has:**
- `generatedBy` names the committed script that produced the record, for example `remediation/n1/scripts/run-eh-wt-03.py`.
- `rigorrunCommit` in both results files, and `productSourcesOf` in `measurement.json`, are `git rev-parse HEAD` at run time, which can be later than the product commit. That the product sources equal `productCommit` is shown by the product check, which runs before each measurement.
