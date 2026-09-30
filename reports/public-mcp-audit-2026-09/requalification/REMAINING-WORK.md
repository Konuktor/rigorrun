# Finishing the requalification — analysis and plan

Written 2026-09-16, after the stage C runs were interrupted by a host restart. Every number below was read from the evidence file or log named beside it; nothing here is from memory.

- **Product under test:** `7209dca`. `scripts/product-under-test.mjs --check` passes.
- **Pre-registration:** commit `28853d1`. The IO-v2 freeze (19 files) and the benchmark-v2 freeze (10 files) were both written before either ran.
- **Where the verdict stands:** there is none yet. benchmark-v2 decides GO/NO_GO, and benchmark-v2 has not run a single case.

---

## 1. What this project is doing

The final qualification at `a9edbec` returned **NO_GO** on four blockers: two real evaluator defects (IO-5, IO-7-mixed-a), one protocol refusal (the GreenMail suites now generate a second case), and one budget failure (SQ-LLM-01 against 60 s).

The requalification fixes the two defects generically, pre-registers a benchmark-v2 that addresses the other two, and re-runs everything at the new product commit. **benchmark-v2 decides the release gates; benchmark-v1 is re-run and reported beside it.**

## 2. State of the work

| Stage | What it is | State |
| --- | --- | --- |
| A | Product fixes, test-first | **Done**, committed `2cc8980`…`94d7230`, plus `89fd4c1` |
| B | Pre-registration and freezes | **Done**, committed `28853d1` |
| C | Runs at the new product commit | **5 of 8 steps done; benchmark-v2 not started** |
| D | Aggregation, gate, report | **Not started** |

## 3. What is proven so far

| Measurement | Result | Evidence |
| --- | --- | --- |
| Full suite, typecheck, lint, e2e | 1089/1089; exit 0; 94 files; 56 passed | `evidence/final/` |
| MCP preflight | 14 PASS, 5 LIMIT, 0 FAIL — every check as before | `mcp/evidence/mcp-preflight/summary.json` |
| In-process held-out set | 23 cases, 23 as expected, 6 abstentions | `n1/evidence/heldout-inprocess/results.json` |
| **IO-v1** | **all 10 gated cases as frozen, 3/3 attempts; guard 0 violations** | `v1/evidence/independent-oracle/results.json` |
| **IO-v2** | **all 9 gated cases as frozen, 3/3 attempts; guard 0 violations** | `io-v2/evidence/results.json` |
| benchmark-v1 | 44 of 58 cases have all planned attempts; 132 attempts written | `v1/evidence/frozen-58/run/evidence/` |

**The headline result:** IO-5 now FAILs 3/3 (INDEPENDENT) and IO-7-mixed-a now FAILs 3/3 (SELF_REPORTED). The two evaluator defects that caused the NO_GO are closed, measured by the fixture that caught them.

## 4. What is missing

| Missing | Why it matters |
| --- | --- |
| **benchmark-v2: 0 of 58 cases** | It decides every gate. Nothing else can substitute for it. |
| benchmark-v1: `SQ-LLM-01`, `SQ-LLM-02` | Not run; the chain was killed mid-case. GATE 1 counts v1 only as a report, but the record must be complete. |
| benchmark-v1: `SQ-W1B-04-wrong-value` | Ran as NOT_RUN 3/3 because its agent was never registered (see §5.1). |
| `n1/eh-wt-03.json` | GATE 3 input. |
| `n1/heldout-worktide-v2-results.json` | GATE 3 input. |
| `evidence/n1-cross-regression-v2.json` | GATE 3 input. |
| `results-v2.json`, `release-gate.json` | The verdict itself. |
| `results-v1.json` | The reported-beside benchmark. |
| `README.md` | The report. |

## 5. Open problems to handle while finishing

### 5.1 `SQ-W1B-04` never ran — a harness bug, not a product regression

- **What happened:** the v1 setup's `journey.mjs add-agent` call for `sq-w1-wrong-value` failed with `EADDRINUSE` on `127.0.0.1:42878`. journey.mjs picks a random port in 41000–42999.
- **How it hid:** `setup-after.py`'s summary line counts *attempted* registrations, so `setup.log` still printed `agents=8`. The stored project has 7.
- **Scope:** no other registration failed, in v1 or in v2. The v2 w1b project has all 8 agents, so benchmark-v2 is unaffected.
- **Fix, already written, not yet run:** `v1/scripts/rq_readd_agent_v1.py`. It keeps the three NOT_RUN attempts, re-registers the agent with the setup script's own command and environment, and records the outcome in `run/agent-reregistration.json`.
- **Why the re-run is legitimate:** no attempt produced a RigorRun verdict, so nothing is being re-rolled after seeing a result.

### 5.2 The interrupted local-model run

The chain was killed by the host while starting `SQ-LLM-02`. It had written only `v1/evidence/local-model/SQ-LLM-02-qwen2.5-3b/preflight.txt`; no case, attempt or log file exists, and no verdict was produced. The host then restarted, stopping every audit container. Both local-model cases use the local SQLite file and need no container.

### 5.3 Two frozen audit traces now differ from HEAD

The v1 direct probes append to `traces/email-mcp/fault-proxy-direct.jsonl` and `traces/sqlite-mcp/fault-proxy-direct.jsonl`. `rq_hygiene.py quarantine-check` currently exits 1 on both. **GATE 11 reads this**, so `quarantine` must run — but only **after every run**, because benchmark-v2's direct probes will append again.

### 5.4 Final verification ran in the wrong place in the order

It ran first, with the stacks up. `n1/README.md` puts it last with no stack up. It passed, but it must be run once more at the end; `final-verification.sh` keeps both sets of logs.

### 5.5 An IO-v2 finding that is reported, not fixed

IO-v2 never exercised the run-time proof that a field is changed by reading it: RigorRun's pre-case fixture read had already flipped `Note.seen` before the case's own double reads. Gated verdicts are unaffected. The frozen fixture is not to be touched. It is written up in `progress.md`.

### 5.6 Host memory

The previous kill happened at ~5.6 GB available. There is ~9.8 GB now. The local-model guards need 3000 MiB (qwen2.5:3b) and 5000 MiB (llama3.1:8b). Run local-model cases one at a time, and close heavy desktop applications before the llama3.1:8b cases.

---

## 6. The plan, in order

`A=reports/public-mcp-audit-2026-09` throughout. Run from the repository root, one step at a time. **No command line may contain the CLI entry-point path**, because the audit's `teardown.sh` kills every process whose command line matches it.

### Step 0 — preconditions (2 min)

```bash
node $A/requalification/scripts/product-under-test.mjs --check
free -m | awk '/^Mem:/ {print "available MiB:", $7}'
```

Stop if the product check is non-zero. Expect ≥ 6000 MiB before continuing.

### Step 1 — the two benchmark-v1 local-model cases (~15 min)

```bash
bash $A/requalification/v1/scripts/run-local-model-v1.sh SQ-LLM-02-qwen2.5-3b qwen2.5:3b 3000
bash $A/requalification/v1/scripts/run-local-model-v1.sh SQ-LLM-01-llama3.1-8b llama3.1:8b 5000
```

One at a time; the second only after the first returns. Each unloads every Ollama model, waits for headroom, preloads its own model and records host conditions.

- **Writes:** `v1/evidence/frozen-58/run/evidence/sqlite-mcp/<case>/attempt-*/`, `v1/evidence/local-model/<case>/run.json`, `v1/evidence/frozen-58/logs/run-cases.llm-<case>.log`.
- **Expected:** SQ-LLM-02 TRUE_NEGATIVE 3/3. SQ-LLM-01 TIMED_OUT against its 60 s v1 budget — that is the frozen protocol's known result and is exactly what benchmark-v2's 90 s budget was pre-registered to address.
- **If blocked:** `blocked.json` records BLOCKED_BY_HOST_RESOURCES and the case stays unrun. Free memory and re-run; do not lower the threshold.

### Step 2 — recover `SQ-W1B-04` and re-run it (~3 min)

Only after step 1: the local-model cases use the same project.

```bash
python3 $A/requalification/v1/scripts/rq_readd_agent_v1.py
bash $A/requalification/v1/scripts/run-v1.sh batch sq-w1b-04-rerun SQ-W1B-04-wrong-value
```

- **Expect:** `add-agent` exit 0 and 8 registered agents, then TRUE_POSITIVE on 3/3 attempts (the final qualification's result).
- **Writes:** `run/agent-reregistration.json`, and the kept attempts under `run/evidence-not-run-agent-unregistered/`.

### Step 3 — recreate every audit stack (~4 min)

```bash
bash $A/remediation/scripts/recreate-stacks.sh
```

- **Expect:** the tail reads `recreate done`, and the oracles read sqlite tasks 3 / audit_log 1, mailhog 0, greenmail 0, worktide tasks 3 with 0 running timers.
- **Note:** GreenMail credentials are static and stored in the v2 homes, so recreating the container does not invalidate the v2 projects. Worktide's token is regenerated, and only direct probes use it — they read it at run time.

### Step 4 — benchmark-v2, the deciding run (~45–75 min)

Manifest order is mandatory: `EM-GM-07` must run immediately before the five accumulate-mode `EM-GMA` cases. The three local-model cases run at their manifest positions, alone.

Write the driver **outside** the frozen `v2/` directory — any new file under `v2/` breaks its freeze:

```bash
cat > $A/requalification/scripts/run-v2-chain.sh <<'SH'
#!/usr/bin/env bash
# benchmark-v2 in remediation/baseline-manifest.json order (v2/PREREGISTRATION.md, "Run order").
set -u
cd "$(dirname "$0")/../v2/scripts" || exit 1
LOGS=../evidence/logs; mkdir -p "$LOGS"
batch() { local label=$1; shift
  echo "== $label ($# cases) $(date -u +%T); avail MiB $(free -m | awk '/^Mem:/ {print $7}')" | tee -a "$LOGS/steps.log"
  python3 run-v2.py --only "$@" >> "$LOGS/run-v2.$label.log" 2>&1
  echo "exit $? $(date -u +%T)" | tee -a "$LOGS/steps.log"; }
local_model() { echo "== local $1 $(date -u +%T)" | tee -a "$LOGS/steps.log"
  bash run-local-model-v2.sh "$1" "$2" "$3" > /dev/null 2>&1
  echo "exit $? $(date -u +%T)" | tee -a "$LOGS/steps.log"; }
batch em-gm EM-GM-01-correct EM-GM-02-missing-action-false-claim EM-GM-03-duplicate EM-GM-04-wrong-recipient EM-GM-05-wrong-subject EM-GM-06-retry-after-lost-response EM-GM-07-retry-direct EM-GMA-01-correct EM-GMA-02-missing-action-false-claim EM-GMA-03-duplicate EM-GMA-04-wrong-recipient EM-GMA-05-wrong-subject
local_model EM-LLM-01-qwen2.5-3b qwen2.5:3b 3000
batch mh-wt-sqd EM-MH-01-send-one EM-MH-02-check-inbox-crashes EM-MH-03-search-emails-crashes EM-MH-04-auto-rule-modules-missing EM-MH-05-to-as-list-and-comma EM-MH-06-empty-recipient EM-MH-07-unknown-service EM-MH-08-service-not-persisted-across-restart WT-D-01-tasks-get-doubled-prefix WT-D-02-tasks-update-doubled-prefix WT-D-03-tasks-complete-doubled-prefix WT-D-04-projects-get-archive-doubled-prefix WT-D-05-tasks-create-500 WT-D-06-add-dependency-500 WT-D-07-time-log-500 WT-D-08-projects-create-500 WT-D-09-timer-start-stop WT-D-10-double-start-closes-first WT-D-11-stop-with-nothing-running WT-D-12-key-too-long-rejected WT-D-13-nonexistent-task SQ-D-01-readonly-denies-insert SQ-D-02-backup-under-deny-everything SQ-D-03-rows-changed-leak SQ-D-04-transaction-across-calls SQ-D-05-column-deny-blocks-aggregate SQ-D-06-timeout-interrupts SQ-D-07-multi-statement-rejected SQ-D-08-readonly-creates-missing-file SQ-D-09-retry-direct SQ-D-10-backup-under-column-deny
local_model SQ-LLM-01-llama3.1-8b llama3.1:8b 5000
local_model SQ-LLM-02-qwen2.5-3b qwen2.5:3b 3000
batch sq-w1 SQ-W1-01-correct SQ-W1-02-missing-action-false-claim SQ-W1-03-duplicate SQ-W1-04-wrong-value SQ-W1-05-wrong-entity SQ-W1-06-forbidden-extra-delete SQ-W1B-01-correct SQ-W1B-02-missing-action-false-claim SQ-W1B-03-duplicate SQ-W1B-04-wrong-value SQ-W1B-05-wrong-entity SQ-W1B-06-forbidden-extra-delete
echo "== done $(date -u +%T)" | tee -a "$LOGS/steps.log"
SH
python3 - <<'PY'
import json, shlex
m = [c["id"] for c in json.load(open("reports/public-mcp-audit-2026-09/remediation/baseline-manifest.json"))["cases"]]
order = []
for line in open("reports/public-mcp-audit-2026-09/requalification/scripts/run-v2-chain.sh"):
    p = shlex.split(line) if not line.lstrip().startswith("#") else []
    if p[:1] == ["batch"]: order += p[2:]
    elif p[:1] == ["local_model"]: order.append(p[1])
print("covers", len(order), "ids; equals manifest order:", order == m)
PY
bash $A/requalification/scripts/run-v2-chain.sh
```

**Verify the order check prints `True` before running the chain.**

- **Writes:** `v2/evidence/run/evidence/<target>/<case>/attempt-*/` (including `readings/after-case-*.json` per generated case), `v2/evidence/logs/`.
- **Watch for:** `run-v2.py` refuses if an attempt directory already exists — that is the "evidence is never overwritten" rule. If a batch dies part-way, do not re-run the whole batch; re-run only the cases with no evidence.
- **Expected shape:** GreenMail suites score 2 generated cases each; SQLite suites 1. Every generated case must have a pre-registered label, or the run refuses.

### Step 5 — the three N-1 re-measurements (~20 min)

```bash
bash $A/remediation/n1/scripts/worktide-stack.sh up
python3 $A/requalification/n1/run-eh-wt-03-rq.py setup
python3 $A/requalification/n1/run-eh-wt-03-rq.py run
python3 $A/requalification/n1/run-heldout-worktide-v2-rq.py
bash $A/remediation/n1/scripts/worktide-stack.sh down
```

Never run these concurrently with anything else.

- **Writes:** `n1/eh-wt-03.json`, `n1/heldout-worktide-v2-results.json`.
- **GATE 3 expects:** EH-WT-03 FAILs on at least 3 attempts and never PASSes; the Worktide v2 held-out gate and side-channel blocks pass.

### Step 6 — aggregation (~3 min)

```bash
node $A/requalification/v2/scripts/aggregate-v2.mjs
node $A/requalification/v2/scripts/n1-cross-regression-v2.mjs
node $A/requalification/v2/scripts/aggregate-v2.mjs      # again: the cross-regression is an input
node $A/requalification/v1/scripts/aggregate-v1.mjs
```

- **Writes:** `results-v2.json`, `evidence/n1-cross-regression-v2.json`, `results-v1.json`.
- The double aggregate mirrors the final qualification's order, where the cross-regression is generated between the two passes.

### Step 7 — the release gate (~1 min)

```bash
node $A/requalification/v2/scripts/release-gate-v2.mjs
```

- **Writes:** `release-gate.json` with all 12 gates. **This is the verdict.** A gate whose evidence is missing FAILS, by design.
- Read every failing gate's `blocker` before doing anything else. Do not re-run anything to change a gate outcome.

### Step 8 — final verification again, with no stack up (~5 min)

```bash
bash $A/requalification/scripts/final-verification.sh all
```

Keeps both sets of logs. GATE 10 reads `evidence/final/`.

### Step 9 — evidence hygiene, then the product check (~3 min)

Only now, after every run:

```bash
python3 $A/requalification/scripts/rq_hygiene.py quarantine
python3 $A/requalification/scripts/rq_hygiene.py quarantine-check
python3 $A/requalification/scripts/rq_hygiene.py redact --check
python3 $A/requalification/scripts/rq_hygiene.py scrub
python3 $A/requalification/scripts/rq_hygiene.py scrub --check
node $A/requalification/scripts/product-under-test.mjs --check
```

All must exit 0. `redact --check` must report 0 files carrying a credential — EM-GM-07 attempt records copy the local mail password, so run `redact` (without `--check`) first if it reports any.

**If `quarantine` changed anything, re-run the release gate:** GATE 11 reads `quarantine-check`.

### Step 10 — the report and the commit

1. Finish `progress.md`: the steps above, each with its numbers and its evidence path, plus the findings in §5.
2. Write `README.md`: the verdict, the twelve gates with their evidence, benchmark-v2's numbers, benchmark-v1 reported beside them, the IO-v1/IO-v2 results, and every disclosed deviation with its timing.
3. `node $A/requalification/v1/scripts/aggregate-v1.mjs --check` to verify every `<!-- v1:… -->` marker in the prose.
4. Commit locally. **Nothing is pushed.**

---

## 7. Definition of done

- [ ] All 58 benchmark-v2 cases ran with their planned attempts; every generated case has a pre-registered label and an oracle verdict.
- [ ] benchmark-v1's record is complete: every case either has its attempts or a recorded reason (12 SUITE_SHAPE_REFUSED).
- [ ] `n1/eh-wt-03.json`, `n1/heldout-worktide-v2-results.json` and `evidence/n1-cross-regression-v2.json` exist.
- [ ] `results-v2.json`, `results-v1.json` and `release-gate.json` exist, and the gate was computed from evidence alone.
- [ ] `product-under-test.mjs --check`, `quarantine-check`, `redact --check` and `scrub --check` all exit 0.
- [ ] `progress.md` and `README.md` record every deviation with its timing, including the four in §5.
- [ ] Every number in prose is checked against a results file by a `--check` run.
- [ ] Commits are local; nothing pushed.

## 8. Risks

| Risk | Handling |
| --- | --- |
| Another host kill during the long v2 run | Run the chain in batches; `run-v2.py` refuses to overwrite, so recovery means re-running only the cases with no evidence. Close heavy applications first. |
| A local-model case blocked on memory | `blocked.json` records BLOCKED_BY_HOST_RESOURCES. Free memory and re-run; never lower the pre-registered threshold. |
| The gate returns NO_GO again | That is a legitimate outcome, not a failure of the process. Read the blockers, record them, and do not re-run to change a result. |
| A suite shape differs from the pre-registration | It is recorded as a fact. The pre-registered labels and budgets are never edited after a result is seen. |
| Editing anything under `v2/` or `io-v2/` | Breaks the freeze and `product-under-test --check`. New harness files go in `requalification/scripts/`. |
