# benchmark-v2 — pre-registration

Written and frozen (`freeze.json`) before any benchmark-v2 attempt ran. `run-v2.py` refuses to run without the freeze, and `../scripts/product-under-test.mjs --check` verifies it. **benchmark-v2 decides the release gate; benchmark-v1 (the frozen protocol, unchanged) is run and reported alongside it.**

## Why a second benchmark, and what was already known

The final qualification (`../../final-qualification/`, product `a9edbec`) returned NO_GO. Two of its blockers are benchmark-protocol matters, not product defects. Both amendments below were decided with the user on 2026-09-15, after those results had been seen. They are therefore **disclosed deviations** from the frozen protocol, made before any run of the product they now measure:

- **Blocker 3 (GATES 1, 2, 3, 6).** Since N-1, both GreenMail suites generate a second case (`missing_precondition`). The frozen protocol refuses to score any suite that is not a single `happy_path`, because its oracle judges the world only once, after the whole run. Twelve frozen cases therefore had no verdict.
- **Blocker 4 (GATE 4).** `SQ-LLM-01-llama3.1-8b` ended TIMED_OUT under the strict GATE 4.
  - RigorRun's own record gives `durationMs` 60 004.542 against `budgetMs` 60 000, and "no check failed on what it had done by then".
  - The oracle verified the correct insert.
  - The harness attempt took 69.03 s end to end.

  The record is `../../final-qualification/evidence/frozen-58/run/evidence/sqlite-mcp/SQ-LLM-01-llama3.1-8b/attempt-1/`. Whether a larger budget lets the agent finish has not been measured.

## Amendments to the frozen protocol

1. **Budget for local-model cases.**
   - `SQ-LLM-01-llama3.1-8b`, `SQ-LLM-02-qwen2.5-3b` and `EM-LLM-01-qwen2.5-3b` run with `--case-timeout 90000`.
   - The value comes from `labels.json` (`caseTimeoutMs`) and is never changed after a result is seen.
   - Every other case keeps its suite's own budget (60 000 ms at setup).
   - Rationale, recorded before execution: RigorRun stopped the SQ-LLM-01 agent at its 60 000 ms budget after the oracle-verified correct insert had already happened, so the 60 s budget under-elicited that known-good run.
2. **Full generated suites are scored.** No suite-shape refusal and no filtering: every generated case of every RigorRun-mode suite is run and scored.
3. **One oracle reading per generated case.**
   - `rigorrun run --after-case <program>` runs the audit's own oracle for the case after each generated case has finished (its final state read included) and before the next one starts.
   - Each generated case is judged on its own window: from the previous reading (the reading before the run, for the first case) to its own.
   - The oracle is `../../scripts/run-cases.py` `oracle`, unmodified, taken by a separate process that never goes through RigorRun.
   - A reading that cannot be taken stops the run; no generated case is scored without its reading.
4. **Labels per generated case.**
   - `labels.json` gives every generated case a truth label and an `expect` predicate.
   - A predicate sees `before` and `after`, the window's two readings.
   - GreenMail predicates also see `new` and `removed`: the messages added and taken away, **counted as multisets**. The frozen predicate's `m not in before['messages']` cannot count an identical second message, which matters in accumulate mode.
   - SQLite predicates are the frozen `expect`, unchanged.

Everything else is the committed code of the audit, imported unmodified:
- **From `scripts/run-cases.py`:** resets, oracles, direct probes and the frozen `expect` of cases RigorRun does not run.
- **From `remediation/scripts/run-cases-after.py`:** both classifications and the project mapping.
- **From `remediation/baseline-manifest.json`:** the cases, their order and their attempt counts.

## The product under test and the generated suites

- **Product.** Recorded in `../product-under-test.json`. Its sources equal `94d7230`, the last commit of requalification stage A (`../PLAN.md`).
- **Setup.** `scripts/setup-v2.py` re-created the four projects the frozen RigorRun-mode cases use: `home-email-gm-w1`, `home-email-gm-fault`, `home-sqlite-w1` and `home-sqlite-w1b`.
  - It used `remediation/scripts/setup-after.py` unmodified: same specs, teach steps, answers, review policy and agents.
  - Setting a project up demonstrates the job and generates its suite. It runs no agent case.
- **What the product generated:**

| Suite | Generated cases | Budget |
| --- | --- | --- |
| `home-email-gm-w1`, `home-email-gm-fault` | `case_live__happy_path` (happy_path), `case_live__unknown_id__service` (missing_precondition, work order `service: "Record1-DOES-NOT-EXIST"`) | 60 000 ms |
| `home-sqlite-w1`, `home-sqlite-w1b` | `case_live__happy_path` | 60 000 ms |

- **Integrity of the generated suites:**
  - every case carries the frame check;
  - every case's instruction is identical and carries the precedence sentence;
  - the suites are pinned by `labels.json` → `suites[*].benchmarkSha256`.

## How the labels follow from the agents, before any run

These facts were read from code, not measured:

- **Playbooks ignore the work order's `service`.** Every GreenMail scripted playbook (`scripts/playbooks/gm-*.json`) sends through `service: "default"`. `scripts/agents/scripted-agent.py` fills only `{inputs.X}` placeholders. In `case_live__unknown_id__service`, a playbook that sends therefore delivers mail although its work order names a service that does not exist; a correct agent sends nothing.
- **One connector process per run.** `Service.runAgent` connects once, `Workspace.connect` returns the live connection (`packages/daemon/src/workspace.ts:257-258`), and every case's adapter is built on it.
  - The gm-fault connector is `scripts/fault-proxy.mjs` with `FAULT_DROP_TOOL=send_email FAULT_DROP_NTH=1`. Its drop counter is module-level, so it swallows the response to the first `send_email` of the whole run, which is in `case_live__happy_path`, the first case.
  - The retry playbook then delivers a second message there, and a single undisturbed one in the second case.
- **The model sees both the instruction and the inputs.** `scripts/agents/ollama-agent.py` builds its prompt from both.

| Frozen cases | Agent | happy_path truth | unknown_id__service truth |
| --- | --- | --- | --- |
| EM-GM-01, EM-GMA-01 | gm-correct | EXPECTED_PASS | EXPECTED_FAIL (sends anyway) |
| EM-GM-02, EM-GMA-02 | gm-missing-action | EXPECTED_FAIL | EXPECTED_PASS (sends nothing: declined by omission) |
| EM-GM-03, EM-GMA-03 | gm-duplicate | EXPECTED_FAIL | EXPECTED_FAIL (two messages) |
| EM-GM-04, EM-GMA-04 | gm-wrong-recipient | EXPECTED_FAIL | EXPECTED_FAIL |
| EM-GM-05, EM-GMA-05 | gm-wrong-subject | EXPECTED_FAIL | EXPECTED_FAIL |
| EM-GM-06 | gm-retry-after-lost-response | EXPECTED_FAIL, **injected** | EXPECTED_FAIL, not injected |
| EM-LLM-01 | ollama-qwen2.5-3b | EXPECTED_PASS | EXPECTED_PASS (a correct agent declines) |
| SQ-W1-*, SQ-W1B-*, SQ-LLM-* | as frozen | the frozen label | — (one generated case) |

The oracle, not the truth label, decides known-good and known-bad. A truth label records the behaviour expected of the agent, and `reproduced` records whether the oracle agreed with it. The predicates are:

- **GreenMail, performed:** `len(removed)==0 and len(new)==1 and new[0]['mailbox']=='qa@example.test' and new[0]['subject']=='Audit 17' and 'qa@example.test' in (new[0]['to'] or '')`.
- **GreenMail, declined:** `len(new)==0 and len(removed)==0`.
- **SQLite:** each case's frozen `expect`, verbatim.

## Scoring

- **Unit.** One generated case, on one planned attempt.
- **Classifications.** `classification` (the audit's original rule) and `outcomeClassification` (outcome-aware: ABSTAIN, HARNESS_FAILURE, TIMED_OUT and AGENT_FAILURE are never a verdict). Both come from `run-cases-after.py`, unchanged.
- **Denominators.** Every labelled generated case on every planned attempt is in every denominator. One without an oracle-judged record is NOT_SCORED with its reason. A generated case the run produced without a label is listed as unlabelled.
- **Direct probes** are run and recorded, never scored.
- **Outputs.** `scripts/aggregate-v2.mjs` writes `../results-v2.json`. `scripts/n1-cross-regression-v2.mjs` compares each frozen case's happy_path generated case with AFTER-2.

## Run order and host conditions

- **Order.** Cases run in `remediation/baseline-manifest.json` order, so EM-GM-07 runs immediately before the five accumulate-mode EM-GMA cases.
- **Local-model cases** run one at a time through `scripts/run-local-model-v2.sh`, with the same memory guard and preload as benchmark-v1. A case the host cannot give headroom to is recorded as BLOCKED_BY_HOST_RESOURCES, never skipped silently.
- **Evidence** is never overwritten: `run-v2.py` refuses when an attempt directory exists.

## Release gates (benchmark-v2 decides)

`scripts/release-gate-v2.mjs` computes each gate from generated evidence only. A gate whose evidence is missing FAILS.

The twelve gates are the final qualification's (`../../final-qualification/scripts/release-gate-final.mjs`), with benchmark-v2's inputs. Every path is relative to `requalification/`.

| Gate | Passes when | Evidence |
| --- | --- | --- |
| GATE 1 COMPLETE | all 58 frozen cases ran with their planned attempts; every labelled generated case was judged by the oracle on every planned attempt; no generated case is unlabelled | `results-v2.json` |
| GATE 2 R1 | the 11 R-1 cases ran, every generated case of theirs has a verdict under both rules, and none is a FALSE_POSITIVE or FALSE_NEGATIVE on any attempt | `results-v2.json` → `R1` |
| GATE 3 N1 | EH-WT-03 FAILs on at least 3 attempts and never PASSes; the Worktide v2 held-out gate and side-channel blocks pass; the benchmark-v2 cross-regression has 0 regressions and 0 unmeasured cases; the in-process held-out set is fully as expected. Each was measured on product sources equal to the product under test | `n1/eh-wt-03.json`, `n1/heldout-worktide-v2-results.json`, `evidence/n1-cross-regression-v2.json`, `n1/evidence/heldout-inprocess/results.json` |
| GATE 4 FALSE_POSITIVES (strict) | every known-good generated attempt (oracle PASS) is TRUE_NEGATIVE under both rules; at least one exists; FP = 0 under both rules | `results-v2.json` |
| GATE 5 FALSE_NEGATIVES | no known-bad generated attempt (oracle FAIL) is given PASS; FN = 0 under both rules | `results-v2.json` |
| GATE 6 INJECTED_FAILURES | at least one injected generated attempt is reachable (oracle FAIL), and every reachable one is TRUE_POSITIVE | `results-v2.json` → `INJECTED` |
| GATE 7 INDEPENDENT_ORACLE | the ten gated IO-v1 cases and every gated IO-v2 case match their frozen expectation on every attempt, with the silent-fallback guard holding | `v1/evidence/independent-oracle/results.json`, `io-v2/evidence/results.json` |
| GATE 8 ABSTENTION | no abstention case fails, in IO-v1 or IO-v2; no PASS anywhere with missing evidence | the IO results and `results-v2.json` |
| GATE 9 MCP_COMPAT | preflight at the product under test has 0 FAIL checks; `mcp-compatibility.md` exists; Playwright, GitHub and Filesystem MCP each have a statement, none UNSUPPORTED or UNKNOWN | `mcp/evidence/mcp-preflight/summary.json`, `…/targets.json`, `mcp-compatibility.md` |
| GATE 10 TESTS | the full suite passes with nothing failed or skipped; typecheck, lint and e2e exit 0; e2e has no failure | `evidence/final/{test,typecheck,lint,e2e}.log` |
| GATE 11 BENCHMARK_INTEGRITY | `scripts/product-under-test.mjs --check` passes (frozen 58, Worktide v2 held-out freeze, IO-v1 freeze, benchmark-v2 and IO-v2 freezes); both later freezes were recorded with the product under test; no frozen audit file differs from HEAD | the product check and `scripts/rq_hygiene.py quarantine-check` |
| GATE 12 NO_TARGET_HACKS | no line added to `packages/*/src` or `apps/*/src` since the audited commit names a target, a frozen case, or an IO-v1/IO-v2 fixture | `git diff 07dda8c <product> -- packages apps` |

benchmark-v1 is aggregated and reported beside these gates, and no gate reads it.

## Limits known before running

- **Authorship.** One author wrote the fixes, the labels and this harness. Freezing the labels before any run does not make the case selection independent.
- **Missing-precondition labels** rest on the playbooks' observed code, and on the claim that a correct agent sends nothing when its work order names a service that does not exist.
- **The injected-failure label** on EM-GM-06's happy_path rests on the per-run connector process, read from code.
- **Product residual risks carried in** from stage A are listed in `../PLAN.md`. Most relevant here: `Email` starts every demonstration with no rows, so a change to existing mail abstains rather than fails, and an asynchronous read flag could make a known-good accumulate-mode attempt abstain.
