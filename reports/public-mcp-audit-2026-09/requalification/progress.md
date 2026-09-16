# Requalification progress

This is a running record. Every number is read from the log or evidence file named beside it. Times are UTC, 2026-09-15.

**Product under test:** `7209dca` (`product-under-test.json`). Every step below ran after `product-under-test.mjs --check` passed.

**Pre-registration:** commit `28853d1`. The IO-v2 and benchmark-v2 freezes were written before either ran.

## Stage C, step 1: final verification (02:20–02:22)

Command: `scripts/final-verification.sh all`. Logs: `evidence/final/`.

| Check | Result | Log |
| --- | --- | --- |
| Full suite | 99 files passed, 1089/1089 tests | `test.log` |
| Typecheck | exit 0 | `typecheck.log` |
| Lint | 94 files, exit 0 | `lint.log` |
| e2e | 56 passed | `e2e.log` |

**Order deviation (found 02:31, after the run).** This step ran first, as the plan's C1. At that time the GreenMail, MailHog and Worktide stacks were up. `n1/README.md` instead puts final verification last with no stack up, to keep the suite and e2e away from stack load. The step passed. It will be run again at the end with no stack up. `final-verification.sh` keeps both sets of logs.

## Stage C, step 2: MCP preflight

Command: `mcp/mcp-preflight.ts`. Evidence: `mcp/evidence/mcp-preflight/`.

- **Totals:** 14 PASS, 5 LIMIT, 0 FAIL (`summary.json`). Every check has the same status as in the final qualification.
- **What changed since `a9edbec`:** nothing in `packages/mcp`. In the result normaliser's files, only a comment in `packages/connector/src/rows.ts`.
- **Target statements:** written afterwards from this evidence, in `mcp/evidence/mcp-preflight/targets.json` and `mcp-compatibility.md`.
  - The client facts and Filesystem MCP 2026.8.31 (the installed copy) were measured again.
  - The GitHub MCP and Playwright MCP statements are carried unchanged from the final qualification (`a011a64`), where they were read from package sources. Those sources are not on this host, and they were not re-read.

## Stage C, step 3: in-process held-out set

Command: `n1/run-heldout-inprocess-rq.sh`. Results: `n1/evidence/heldout-inprocess/results.json`.

- **Totals:** 23 cases, 23 matching expected, 0 known-good incorrectly failed, 0 known-bad incorrectly passed, 0 undecidable given a verdict, 0 not finished given a verdict, 6 abstentions.
- **Cleanup:** the temporary test copy was removed.

## Stage C, step 4: IO-v1 (02:24–02:25)

Command: `scripts/rq_io_v1.py setup`, `run`, `aggregate`. Log: `evidence/stage-c/io-v1.log`. Results: `v1/evidence/independent-oracle/results.json`.

- **Gated cases:** all 10 match their frozen expectation on 3 of 3 attempts. The silent-fallback guard has 0 violations.
- **The two evaluator defects behind the NO_GO:**
  - IO-5: FAIL, INDEPENDENT, on 3 of 3 attempts. The oracle says FAIL.
  - IO-7-mixed-a: FAIL, SELF_REPORTED, on 3 of 3 attempts. The oracle says FAIL.
- **Abstention cases** (IO-6a, IO-6b, IO-6c): 0 failing.
- **IO-7-self** (not gated): PASS, SELF_REPORTED, on 3 of 3 attempts, against an oracle FAIL. This is the documented limit of a project with no verifier, and the label discloses it.

## Stage C, step 5: IO-v2 (02:25–02:26)

Command: `io-v2/run-io-v2.py setup`, `run`, `aggregate`. Log: `evidence/stage-c/io-v2.log`. Results: `io-v2/evidence/results.json`.

- **Setup:** all 5 projects set up.
  - Four had a predicted suite shape; each came out as predicted.
  - `replace` had no prediction. Its suite is `[happy_path]`.
  - `mixed` reported `readsIgnored: [list_tasks]`.
- **Gated cases:** all 9 match their frozen expectation on 3 of 3 attempts. The silent-fallback guard has 0 violations. There are no abstention cases.

| Case | RigorRun | Label | Oracle |
| --- | --- | --- | --- |
| IO2-1 create, correct | PASS | INDEPENDENT | PASS |
| IO2-2 create + note edit | FAIL | INDEPENDENT | FAIL |
| IO2-3 update, correct | PASS | INDEPENDENT | PASS |
| IO2-4 update + note create | FAIL | INDEPENDENT | FAIL |
| IO2-5 replace, correct | PASS | INDEPENDENT | PASS |
| IO2-6 replace + note edit | FAIL | INDEPENDENT | FAIL |
| IO2-7 selfread, correct | PASS | SELF_REPORTED | PASS |
| IO2-8 selfread + note edit | FAIL | SELF_REPORTED | FAIL |
| IO2-9 mixed, verifier empty, connector lies | FAIL | SELF_REPORTED | FAIL |

### Finding: the ungated diagnostic did not hold for IO2-7 and IO2-8

- **Predicted.** `Note.seen` would be proven volatile by the two starting reads.
- **Observed.** `readStability.volatileFields` is `{}` on every attempt. The frame checks came out as predicted: PASS on IO2-7, FAIL on IO2-8 for Note 1's body.
- **Cause, read from `cases/IO2-7/attempt-1/attempt.json`.**
  - RigorRun made 10 connector reads. The first two are `list_tasks` and `list_notes`, before both double reads.
  - This matches `Service.runAgent`: `registerFor` reads the world once before any case (`packages/daemon/src/service.ts:1079`).
  - With `--mark-seen-on-read`, that read sets `seen = 1` on every note. Both starting reads and both final reads then agree, and the oracle shows `seen` 0 before the attempt and 1 after.
- **Consequence.** IO-v2 did not exercise the proof that a field is changed by reads at run time. Only unit tests exercise it (`packages/runner/test/frame.test.ts`, `packages/environment/test/frame.test.ts`). The gated verdicts are unaffected. This stays a finding and is not a harness change: the frozen files are unchanged.

## Stage C, step 6: benchmark-v1 frozen 58

Logs: `v1/evidence/frozen-58/logs/`.

- **`init` (02:27:37):** `run-info.json` written for `7209dca`.
- **`stacks` (02:27:38–02:30:13):** teardown, then recreation from the pinned checkouts. The oracles read the starting state:
  - sqlite: tasks 3, audit_log 1;
  - mailhog: total 0;
  - greenmail: total 0;
  - worktide: tasks 3, running timers 0, time entries 10.
- **`setup` (from 02:30:13, exit 3, as in the final qualification).**
  - These projects set up, each with a single `happy_path` case and a 60 000 ms budget: sqlite `w1` and `w1b`, worktide `w2` and `w3`.
  - `email-mcp/gm-w1` and `gm-fault` set up with 2 cases each (`happy_path`, `missing_precondition`). The frozen protocol refuses to score them, so the 12 GreenMail RigorRun cases stay unrun under benchmark-v1. That includes EM-LLM-01.
  - `email-mcp/w1` (MailHog) did not compile: "The recording performed "send_email" but nothing in the system changed". The final qualification's `setup.log` shows the same error. The MailHog cases are direct probes, and none of them uses this project.
- **Batches (from 02:34:27, `chain-2.log`), in the final qualification's order:** sq-rr, sq-d, wt, mh, then EM-GM-07 alone. After them, `SQ-LLM-02-qwen2.5-3b` (3000 MiB) and `SQ-LLM-01-llama3.1-8b` (5000 MiB), each alone behind `run-local-model-v1.sh`.
- **sq-rr (02:34:27–02:34:51, exit 0):** 11 of 12 cases classified as in the final qualification, 6 TRUE_NEGATIVE and 27 TRUE_POSITIVE attempts. `SQ-W1B-04-wrong-value` was NOT_RUN on 3 of 3 attempts; the final qualification had TRUE_POSITIVE on 3 of 3.

- **sq-d (02:34:51–02:35:12, exit 0) and wt (02:35:12–02:41:28, exit 0):** direct probes, which RigorRun does not score. Compared attempt by attempt with the final qualification's `run-cases.sq-d.log` and `run-cases.wt.log`:
  - sq-d: 10 cases, 30 attempts;
  - wt: 13 cases, 39 attempts;
  - 0 oracle-verdict or classification differences in either batch.

- **mh (02:41:28–02:42:03, exit 0) and gm-direct (02:42:03–02:42:26, exit 0):** direct probes again, compared attempt by attempt with the final qualification: MailHog 8 cases, 24 attempts; `EM-GM-07-retry-direct` 3 attempts. 0 differences in either.
- **Interruption (02:42:26).** The chain was killed by the host while starting the first local-model case, `SQ-LLM-02-qwen2.5-3b`. It had written only `v1/evidence/local-model/SQ-LLM-02-qwen2.5-3b/preflight.txt`; no case, attempt or log file was written, and no verdict was produced. The host was then restarted, which stopped the GreenMail, MailHog and Worktide containers. The two local-model cases were re-run afterwards, with the product check passing again first. Neither depends on those containers: both use the local SQLite database file.

### Finding: SQ-W1B-04 did not run because v1 setup failed to register one agent (harness, not product)

- **When it was found:** after the sq-rr batch, while the later v1 batches were running.
- **What RigorRun said:** on every attempt it refused to start, with `error No agent "sq-w1-wrong-value" on sqlite W1b insert a task` (`run/evidence/sqlite-mcp/SQ-W1B-04-wrong-value/attempt-*/attempt.json`). No verdict was given.
- **Cause, from `run/journeys.json`:**
  - The setup's `journey.mjs add-agent` call for that agent failed with `EADDRINUSE` on `127.0.0.1:42878`. journey.mjs starts its server on a random port in 41000–42999, and that one was taken.
  - `setup-after.py` recorded `ok: false`. Its summary line counts attempted registrations, so `setup.log` still printed `agents=8`.
  - The stored project has 7 agents.
- **Scope checks:**
  - No other agent registration in the v1 or benchmark-v2 setups failed. The v2 w1b project has all 8 agents.
  - The final qualification's registration of the same agent succeeded.
- **Recovery (decided before the re-run; after the v1 chain, because the local-model cases use the same project):** `v1/scripts/rq_readd_agent_v1.py`.
  1. It moves the three NOT_RUN attempts to `run/evidence-not-run-agent-unregistered/`. They are kept, not overwritten.
  2. It registers the agent with the setup script's own `add-agent` command, arguments and environment.
  3. It records the outcome in `run/agent-reregistration.json`.

  SQ-W1B-04 is then re-run alone. No attempt had a RigorRun verdict, so the re-run does not depend on any outcome. The final report will show both records.
