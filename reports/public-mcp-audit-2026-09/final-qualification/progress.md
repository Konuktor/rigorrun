# Final qualification — progress log

Append-only. Each entry records what was run, at which product commit, and what it showed. Nothing above an entry is edited after it is written; a correction is a new entry.

The plan, with the gate definitions decided with the user before any run, is summarised in `README.md`.

## 2026-09-14 — Phase 0: current state

- **Tree at start:** branch `redesign/brand-site-product`, HEAD `a9edbec98ea9056bf1b6a3773cc3fa9ba2692d01`, clean; 46 commits ahead of origin, never pushed. Package version 0.2.0. Raw captures: `evidence/env/phase0/`.
- **Pre-registered before any run (decided with the user):**
  1. GATE 4 is strict. A known-good frozen case must be TRUE_NEGATIVE under both rules on every attempt; a TIMED_OUT, ABSTAIN or HARNESS_FAILURE there fails the gate.
  2. IO-5 counts as observable, because the unrelated change is visible in the verifier's reads. The expected verdict is FAIL; a PASS fails GATE 7.
  3. IO-7 in the mixed-nomination configuration is gated. Both read orders must be FAIL; a PASS fails GATE 7.
  4. Evidence is committed locally at milestones. Nothing is pushed or published.
- **Full suite, first run (`evidence/phase0/test.log`):** 91 of 92 files passed; 1007 tests passed and 10 were skipped, of 1017.
  - **Failed file:** `packages/sandbox/test/adversarial.test.ts`. Its `beforeAll` stages a fixture with a host `npm install --ignore-scripts --prefix <temp tree>`, and that install did not finish inside the 600 s limit. Its 10 tests were skipped.
  - **Cause, from the install's npm debug log:** registry requests from this host timed out or were reset (`jose`, `hono`, `cross-spawn`, `pkce-challenge`, `eventsource`, `content-type`: ETIMEDOUT / ECONNRESET). Retries succeeded after 20–136 s each. While it hung, four TLS connections to the registry held unacknowledged data in the send queue.
  - **No damage:** the install wrote only to its temporary prefix. The repository has no new files and `node_modules` is unchanged.
  - **Previous durations of this file:** 23.4 s in `remediation/n1/evidence/full-test.log` and 20.8 s in `remediation/evidence/final-test.log`.
  - This is a host network condition, not a code change. The file is re-run once the registry answers normally; both runs are kept.
- **Typecheck (`evidence/phase0/typecheck.log`):** exit 0.
- **ESLint (`evidence/phase0/lint.log`):** exit 0 on the 74 TypeScript files under `packages/` and `apps/` changed since `07dda8c`.

## 2026-09-14 — Phase 1: product under test frozen

- **Record:** `product-under-test.json`, written by `scripts/product-under-test.mjs`, which also verifies it (`--check`).
- **Product commit:** `a9edbec98ea9056bf1b6a3773cc3fa9ba2692d01`.
  - The last commit that touched product sources is `69e6c33`.
  - Product sources are identical to `54f6e79`, where EH-WT-03 and Worktide v2 were measured.
  - They are not identical to AFTER-2's `0abf8ef`, so the frozen 58 must be re-run.
- **Product pathspec:** `packages apps fixtures package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json vitest.config.ts`. Evidence commits under `reports/` do not change it.
- **N-1 commits:** `0099670 f1ad841 69e6c33`, and the tests `bbb5f9e 8336fd3`, are all ancestors of the product commit.
- **Benchmark integrity:**
  - `freeze-baseline.mjs --check` reports "baseline manifest verified: 58 cases, 108 frozen files".
  - The manifest plans 152 attempts.
  - All 21 files hashed in `heldout-worktide-v2/freeze.json` verify.
- **Pinned targets:** all four clones are at their manifest commits (email-mcp, worktide-mcp, worktide backend, sqlite-mcp).
  - The email-mcp clone has a modified `src/drafts.json`. That is the server's own runtime draft store, and it was already modified in AFTER-2's recreate log.
  - The file is recorded and left untouched.
- **Scoring rules:**
  - `scripts/run-cases.py`, `remediation/scripts/run-cases-after.py`, `setup-after.py` and `recreate-stacks.sh` are committed, unmodified, and unchanged since AFTER-2.
  - `aggregate-after.mjs` changed after AFTER-2, through N-1's appended fields. It is not used to score this run: `scripts/aggregate-final.mjs` reads the classifications `run-cases-after.py` writes.

## 2026-09-14 — Phase 0: the failed file re-run

- **Registry check:** once the npm registry answered normally again, the six packages that had stalled (`jose`, `hono`, `eventsource`, `content-type`, `cross-spawn`, `pkce-challenge`) each returned HTTP 200 in under 0.7 s.
- **Re-run:** `packages/sandbox/test/adversarial.test.ts` was re-run alone (`evidence/phase0/test-rerun-adversarial.log`). 1 file passed, 10 of 10 tests, in 20.9 s, in line with its earlier durations.
- **Suite at the product commit:** 1017 of 1017 tests passed across the two runs. The first run's failure is kept in `evidence/phase0/test.log` and is not counted as a pass. The full suite is run again, in one piece, in Phase 8.

## 2026-09-14 — Phase 6 preparation: independent-oracle cases frozen before any ran

- **Fixture:** `scripts/io/`, Python standard library only; nothing is added to the product.
  - `taskdesk_server.py` is the connector the agent acts through: a read-write SQLite task store with fault switches.
  - `taskdesk_oracle_server.py` is the verifier: a separate process that opens the same file `mode=ro`.
  - `reset-taskdesk.sh` resets the store, and six scripted-agent playbooks drive the agent.
  - Four spec templates cover the independent, mixed-a, mixed-b and self-reported projects.
- **Smoke test before the freeze (servers only, no RigorRun, no case):**
  - both servers negotiate `2025-11-25` and list their tools;
  - `write_wrong_title` makes the connector report `Quarterly report` while the oracle reads `Quarterly repotr`;
  - `ack_without_write` reports success and adds no row;
  - the empty flag gives `{"tasks": []}`;
  - the down flag makes the oracle exit at startup, or on its next call without answering;
  - an unknown id gives `isError`.
- **Frozen:** `scripts/io/freeze.json` hashes the 15 files that define the cases (cases, expectations, playbooks, spec templates, servers, reset, runner), at HEAD `a9edbec`, before any case ran. `run-io.py` refuses to run when one differs.

## 2026-09-14 — Phase 2: the frozen protocol refuses both GreenMail suites (N-1 consequence)

- **Stacks recreated (17:24Z), from the frozen state:** sqlite 3 tasks and 1 audit_log row; MailHog 0; GreenMail 0; Worktide 3 tasks, 0 running timers, 10 time entries. Log: `evidence/frozen-58/logs/recreate-stacks.log`.
- **Projects re-created (17:27Z), from the same specs** (`evidence/frozen-58/logs/setup.log`). Six journeys compiled and built a suite. MailHog W1 was refused at compile ("The recording performed send_email but nothing in the system changed"), as in AFTER-2.
- **Suite-shape check refused to score** (exit 3). Both GreenMail suites now contain two cases: `happy_path`, and `missing_precondition` "service names a record that does not exist". At AFTER-2 each was one `happy_path` case. The sqlite W1, sqlite W1b, Worktide W2 and Worktide W3 suites are unchanged: one `happy_path` case each.
- **Cause, read from the setup artefacts:** N-1's identity change.
  - The GreenMail inbox read's record (`Record1`) was keyed by its message `count` at AFTER-2. That value changes when mail arrives. It is now keyed by `service`, and `count` is a quantity.
  - `Record2` now references it through `service`, a relationship absent at AFTER-2.
  - `send_email`'s `service` parameter therefore names an existing record, and the generator's `invalidate_identifier` mutation (`packages/generator/src/mutations.ts`) emits the precondition case.
  - The inferred rule "every email must be recorded in a record1" is gone.
- **Why this is not a defect in the new case:** the change is the intended consequence of identity no longer being a changing value.
- **Why it still cannot be scored:** under the frozen protocol, a second case runs the agent again before the oracle reads the mailbox, and the GreenMail playbooks send with `service: "default"` written literally.
- **Decision (asked and answered before any affected case ran):**
  - The release gates use the strict frozen protocol. The 12 affected cases are NOT_RUN with reason `SUITE_SHAPE_REFUSED` (`evidence/frozen-58/not-run.json`): `EM-GM-01`…`06`, `EM-GMA-01`…`05` and `EM-LLM-01`. Five of them are R-1 cases.
  - Separately, a happy-path-only diagnostic runs them from a throwaway copy of each GreenMail home, whose suite keeps only the unchanged `happy_path` case. It is labelled as a deviation and never merged into gate metrics.

## 2026-09-14 — Phase 6: independent-oracle cases run (3 attempts each, product commit a9edbec)

- **Setup:** four projects, each built by `rigorrun setup`. Each has one `Task` entity keyed by `id` and one `happy_path` case at 60 s.
  - The contract: focus `Task`, scope `created`, expected delta 1, deleted 0, `title` bound to the argument.
  - Checks: `success__performed`, `success__exactly_as_demonstrated`, `success__nothing_else_deleted`.
- **Results** (`evidence/independent-oracle-run.log`, `evidence/independent-oracle/results.json`):
  - **Every attempt matched:**
    - IO-1: PASS, INDEPENDENT;
    - IO-2, IO-3, IO-4 and IO-7: FAIL, INDEPENDENT;
    - IO-6a: ABSTAIN with `final_state_unavailable`;
    - IO-6b: exit 2, no verdict;
    - IO-7-mixed-b: FAIL;
    - IO-6c (diagnostic): FAIL, not PASS.
  - **IO-5 did not match on any of 3 attempts.** RigorRun said PASS, INDEPENDENT, while the oracle said FAIL. The agent created the right task and also changed task 2's status. The generated suite has no check that other records stay unchanged.
  - **IO-7-mixed-a did not match on any of 3 attempts.** RigorRun said PASS, labelled SELF_REPORTED, while the oracle said FAIL. With the verifier read nominated first and the connector's lying read second, the later read's rows replace the verifier's.
  - **IO-7-self (control, no verifier):** PASS, SELF_REPORTED, against oracle FAIL. This is what a self-reported project says about the same wrong state.
  - **Silent-fallback guard:** held on every attempt. Every PASS on the independent project had 3 answered verifier reads inside its attempt, and no agent step reached a `verifier:` tool.
- **Consequence:** GATE 7 fails on IO-5 and IO-7-mixed-a, so the final status is NO_GO whatever the remaining phases show. The remaining phases still run, so every objective is measured.

## 2026-09-14 — Phase 7: MCP preflight run through RigorRun's own client and normaliser

- **Script:** `scripts/mcp/mcp-preflight.ts`, with evidence in `evidence/mcp-preflight/`. Each check goes through `McpConnection` and `normalizeCallResult` unchanged, and a raw JSON-RPC client written for the preflight is the reference.
- **First run (`run-1-before-corrections.log`):** it ended after the stderr-flood check, with exit 0 and no summary. Three causes, and one misjudged expectation:
  - **Hung close:** `close()` on the flooded connection did not settle, and Node exited with the promise still pending.
  - **SDK regex:** the pattern for `LATEST_PROTOCOL_VERSION` did not match the SDK's quoting, so it recorded nothing.
  - **Wrong expectation:** `filesystem-call` was marked FAIL because I expected a prose (`text`) result. The 2026.8.31 filesystem server returns `structuredContent`, so `structured` is the correct normalisation.

  I fixed all three in the preflight script (the product was not changed): `close()` is raced against a timer, the regex accepts either quote, and the filesystem expectation follows the result's own shape.
- **Second run (`run.log`):** 14 PASS, 5 LIMIT, 0 FAIL.
  - **PASS:**
    - Filesystem MCP 2026.8.31: connect, tools/list (the same count as the raw paged list), a structured result, an out-of-roots refusal read as an error, and teardown.
    - Memory MCP: structured results and teardown.
    - Normalisation: structured, JSON inside text, and prose never read as records.
    - `isError` and JSON-RPC errors are both errors; a 20 s timeout is an error.
    - `close()` settles after a blocked call.
    - A server that speaks only `2026-07-28` is refused at connect, visibly: "initialize is not supported: this server speaks MCP 2026-07-28 only". Nothing reaches a case.
  - **LIMIT:**
    1. The installed SDK 1.30.0 negotiates `2024-10-07`…`2025-11-25` only; `2026-07-28` is absent.
    2. For stdio servers, discovery records the literal `negotiated` instead of the version (the raw handshake shows `2025-11-25`).
    3. `tools/list` ignores `nextCursor`: a second-page tool was invisible.
    4. A result that is only a `resource_link` or only an image normalises to `empty`.
    5. A server that writes 200 KB to stderr stalls: both calls timed out, because stderr is piped and never read.

## 2026-09-14 — Phase 6: why IO-5 and IO-7-mixed-a passed (read from the run files)

- **Evidence completeness:** every attempt record has the initial database state, the task, the agent trace, the tool-reported state, the independent database state, the expected final state, both verdicts, the evidence label, the verification strength and the server call log.
- **IO-5 (attempt 1, `cases/IO-5/attempt-1/rigorrun-run.json`):**
  - **What RigorRun observed:** its final state, read through the verifier, shows task 2 `Book venue` as `done`. It was `open` at case start.
  - **Checks:** `success__performed` (a `Quarterly report` task was created), `success__exactly_as_demonstrated` (one Task created) and `success__nothing_else_deleted` (no Task deleted). All three passed.
  - **Result:** no generated check compares records that already existed. The unrelated change was observed and not judged, and the verdict was PASS.
- **IO-7-mixed-a (attempt 1):**
  - **Recorded final state:** Task 4 titled `Quarterly report`, which is the connector's lying `list_tasks` row. The verifier returned `Quarterly repotr` for the same id; the database holds that value.
  - **Mechanism:** the verifier read is nominated first and the connector read second, and when two reads return the same record key, the later reading stands.
  - **Result:** `success__performed` passed and the verdict was PASS. The label was SELF_REPORTED.
- **IO-7-mixed-b** has the reverse order: the verifier's `Quarterly repotr` stands and the case FAILs. The outcome of a mixed-nomination project depends on the order the reads are listed in.

## 2026-09-14 — Phase 2 and 3: frozen cases the suite-shape refusal does not affect (17:34–17:49Z)

- **Run:** one sequential chain (`evidence/frozen-58/logs/chain-1.log`) through `run-frozen-58.sh batch`, which runs the committed `run-cases-after.py`. Each batch started only after `product-under-test.mjs --check` verified the product sources.
  1. sqlite RigorRun cases: 12 cases, 36 attempts.
  2. sqlite direct probes: 10 cases, 30 attempts. Their timings and oracle verdicts matched AFTER-2 attempt for attempt.
  3. Worktide direct probes: 13 cases, 39 attempts.
  4. MailHog direct probes: 8 cases, 24 attempts.
  5. `EM-GM-07` direct probe: 3 attempts.
- **Local-model cases.** Each ran alone behind `run-local-model.sh`: every Ollama model was unloaded, the thresholds were AFTER-2's (3 GB for qwen2.5:3b, 5 GB for llama3.1:8b), and only the case's own model was preloaded. Model, agent, prompt, the 60 s case budget and attempt counts were unchanged.
  - **`SQ-LLM-02-qwen2.5-3b`:**
    - Host: 7254 MiB available; preloaded in 3.49 s; model `357c53fb659c`, 100% on the GPU.
    - 3 of 3 attempts TRUE_NEGATIVE under both rules: oracle PASS, RigorRun PASS, in 20.5 s, 15.2 s and 15.2 s.
    - This is the R-1 case AFTER-2 could not start.
  - **`SQ-LLM-01-llama3.1-8b`:**
    - Host: 7345 MiB available; preloaded in 9.44 s; model `46e0c10c039e`, split 43% CPU / 57% GPU.
    - 1 of 1 attempt: the oracle said PASS, because the model did the job. RigorRun said TIMED_OUT at 69.03 s against the 60 s budget. That classifies as TIMED_OUT (outcome-aware rule) and FALSE_POSITIVE (original rule).
    - AFTER-1 measured the same case at 68.33 s with the same outcome.
    - Host memory did not block it. Under the strict GATE 4 recorded before the run, a known-good case not graded TRUE_NEGATIVE fails the gate.
- **Not started:** the `EM-LLM-01` local-model case is one of the 12 GreenMail cases the frozen protocol refused.

## 2026-09-14 — GreenMail happy-path-only diagnostic, first pass (a deviation, not a gate input)

- **Prepared:** throwaway copies of `home-email-gm-w1` and `home-email-gm-fault` under `tmp/rigorrun-audit/fq-homes-diagnostic/`. In each copy, `benchmark.json` keeps only the `happy_path` case, and that case was checked to be identical to the generated one. Agent trace paths and the fault log point at the diagnostic's own directory. Record: `evidence/greenmail-happy-path-diagnostic/deviation.json`.
- **First pass** (`logs/run-cases.order-1.log`, 16 attempts over 11 cases): 15 attempts matched AFTER-2's classification.
- **EM-GMA-01-correct attempt 1 did not match.** The oracle said FAIL, RigorRun said PASS, which would be a FALSE_NEGATIVE; AFTER-2 had TRUE_NEGATIVE.
- **Cause, read from `before.json` and `after.json`:**
  - The EM-GMA cases are the manifest's only `noReset` cases ("accumulate mode"), so each starts from the mailbox the previous case left.
  - The frozen `expect` counts a message as new only if its content differs from every earlier message.
  - **At AFTER-2:** EM-GM-07 (a direct probe) ran just before EM-GMA-01, as it does in manifest order. It left two messages whose body differs from the agent's.
  - **In this first pass:** EM-GM-07 had already run in the strict chain, so the leftover messages came from EM-GM-06. Their content is identical to the agent's message.
  - **Effect:** the mailbox went from 2 to 3 messages, with exactly one sent, to qa@example.test, subject Audit 17. The oracle could not tell the new message apart and said FAIL.
  - **Conclusion:** the oracle's verdict here reflects the run order, not the agent or RigorRun. The same confound applies to EM-GMA-02…05.
- **Strict run unaffected:** every case it ran resets its own target, and the five order-dependent cases are all among the 12 it refused.
- **Correction:** the five first-pass EM-GMA attempts are kept, moved to `run/evidence-gma-order-confounded/`. EM-GM-07 and then EM-GMA-01…05 are re-run in manifest order in the diagnostic, reproducing AFTER-2's starting mailbox. The re-run's EM-GM-07 attempts only set up the mailbox and are not reported as diagnostic results.
- **Finding for the tooling:** `remediation/scripts/rerun.sh` says "Every attempt resets its own target … so the order changes nothing a case sees". That holds for every frozen case except the five `noReset` EM-GMA cases, which depend on EM-GM-07 running first.

## 2026-09-14 — GreenMail diagnostic: EM-GMA cases re-run in manifest order

- **Re-run** (`logs/run-cases.gma-manifest-order.log`): EM-GM-07 ran first, only to reproduce AFTER-2's starting mailbox. EM-GMA-01…05 followed, each for its manifest attempt count of 1.
- **Results:**

  | Case | Oracle | RigorRun | Classification (both rules) |
  | --- | --- | --- | --- |
  | EM-GMA-01-correct | PASS | PASS | TRUE_NEGATIVE |
  | EM-GMA-02 | FAIL | FAIL | TRUE_POSITIVE |
  | EM-GMA-03 | FAIL | FAIL | TRUE_POSITIVE |
  | EM-GMA-04 | FAIL | FAIL | TRUE_POSITIVE |
  | EM-GMA-05 | FAIL | FAIL | TRUE_POSITIVE |

- **Against AFTER-2:** all five classifications are the same.
- **Conclusion:** the first pass's EM-GMA-01 FALSE_NEGATIVE came from the run order, as diagnosed. It stays on record in `run/evidence-gma-order-confounded/`.
- **Next:** EM-LLM-01, run alone behind the same memory guard and model preload as the other local-model cases, into the diagnostic directory.

## 2026-09-14 — GreenMail diagnostic EM-LLM-01, and the in-process held-out set at the product commit

- **EM-LLM-01-qwen2.5-3b** (diagnostic, not counted by any gate; `evidence/greenmail-happy-path-diagnostic/local-model/`):
  - Setup: run alone; 10862 MiB available; preloaded in 4.88 s.
  - Result, on all 3 attempts: TIMED_OUT at 75.2 s, 74.7 s and 74.6 s, against the 60 s budget.
  - The oracle said FAIL on every attempt: the model did not complete the job. That classifies as TIMED_OUT under the outcome-aware rule and TRUE_POSITIVE under the original rule. AFTER-1 recorded the same.
- **In-process held-out set** (`scripts/run-heldout-inprocess.sh`, `evidence/heldout-inprocess/`):
  - Method: the frozen test, run from a temporary copy that changes only its results path. The copy was removed afterwards, and product sources are clean.
  - At `a9edbec`: 23 of 23 cases matched their expectation; 0 known-good failed; 0 known-bad passed; 6 abstentions.
  - This replaces the stale measurement at `ed7a743`.

## 2026-09-14/15 — Phase 8: full verification at the product commit, and evidence hygiene

- **Checks** (`scripts/final-verification.sh all`, logs in `evidence/final/`; product sources verified before each step):

  | Check | Result |
  | --- | --- |
  | `pnpm test` | 92 of 92 files, 1017 of 1017 tests, exit 0 |
  | `pnpm typecheck` | exit 0 |
  | ESLint, 76 files (TypeScript changed since `07dda8c` plus the committed final-qualification scripts) | exit 0 |
  | ESLint, all 5 final-qualification TypeScript/JavaScript scripts, committed or not (`lint-final-qualification.log`) | exit 0 |
  | `pnpm e2e` | 56 passed, 0 failed, 0 flaky, exit 0 |

- **Hygiene** (the remediation's own scripts, pointed at final-qualification):
  - **Machine paths:** scrubbed in 128 files; 0 remain.
  - **Credentials:** the local mail stack's password, copied into six EM-GM-07 direct-probe attempt records (three strict, three diagnostic), is redacted; 0 files carry a stored credential value.
  - **Frozen traces:** the fault proxy appended to two of them. 48 lines from `traces/email-mcp/fault-proxy-direct.jsonl`, which include the diagnostic's EM-GM-07 attempts, and 24 lines from `traces/sqlite-mcp/fault-proxy-direct.jsonl` were moved to `evidence/frozen-58/baseline-writes/`, and both originals were restored. The check then shows 0 frozen audit files differing from HEAD.
- **Final aggregation:** `results.json` and `evidence/n1-cross-regression.{json,md}` were regenerated from the complete evidence. All 98 README markers match `results.json`.

## 2026-09-15 — Phase 9: release gate — NO_GO

- **Gate** (`release-gate.json`, from `scripts/release-gate-final.mjs`): GATES 5, 8, 9, 10, 11 and 12 PASS; GATES 1, 2, 3, 4, 6 and 7 FAIL.
- **GATE 3's reason text:** the gate script's first reason for GATE 3 read "missing evidence", which was inaccurate. It now names the actual cause:
  - 0 measured regressions;
  - 11 frozen cases that were correct at AFTER-2 have no verdict under the strict protocol.

  Its pass or fail condition was not changed.
- **GATE 3 components that pass:**
  - EH-WT-03 FAIL on 3 of 3 attempts, measured at `54f6e79`, whose product sources are identical to the product commit;
  - the Worktide v2 gate and side-channel blocks;
  - the in-process held-out set, 23 of 23 at `a9edbec`.
- **Blockers:**
  1. GATE 7: IO-5 and IO-7-mixed-a are known-bad and observable by the verifier, yet RigorRun graded them PASS.
  2. GATES 1, 2, 3 and 6: under the frozen protocol, 12 GreenMail cases cannot be scored at the product commit.
  3. GATE 4: SQ-LLM-01 did the job but reached its 60 s budget, so it is TIMED_OUT, not TRUE_NEGATIVE.
- **`public-audit-build.json`:** not created.
