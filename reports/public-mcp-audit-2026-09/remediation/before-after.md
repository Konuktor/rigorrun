# RigorRun before and after: the frozen three-server benchmark

This report is rendered by `scripts/render-before-after.py` from `scripts/before-after.template.md`. Every number in it is a marker read from a generated file:

- **`n:` markers** come from `after-results.json`, the final run (AFTER-2). That file also carries the baseline totals and counts copied from `baseline-manifest.json`, the held-out totals and the final test run.
- **`n-after-1:` markers** come from `after-1-results.json`, the first full re-run.

To verify every marker against those files:

```
node remediation/scripts/aggregate-after.mjs --check
AFTER_RUN=after-1 node remediation/scripts/aggregate-after.mjs --check
```

The labels, `expect` predicates, oracles and attempt counts are the frozen ones (`freeze-baseline.mjs --check`). No case was relabelled or excluded; `benchmark-validity-exceptions.md` is empty.

## Runs

| Run | RigorRun commit measured | Cases with a recorded attempt |
| --- | --- | --- |
| BEFORE | `07dda8c` (0.2.0) | <!-- n:baseline.counts.cases -->58<!-- /n --> of <!-- n:baseline.totals.cases_total -->58<!-- /n --> |
| AFTER-1 | <!-- n-after-1:rigorrun_commit -->f4145bb17020fd63a25fc2b00e64c4c41d7b5cd1<!-- /n-after-1 --> | <!-- n-after-1:CASES_RUN -->58<!-- /n-after-1 --> of <!-- n-after-1:TOTAL_CASES -->58<!-- /n-after-1 --> |
| AFTER-2 (final) | <!-- n:rigorrun_commit -->0abf8ef5bb5466ff4bba75156836e3cd628a7841<!-- /n --> (product sources of `26d1e6a`) | <!-- n:CASES_RUN -->55<!-- /n --> of <!-- n:TOTAL_CASES -->58<!-- /n --> |

AFTER-2 cases without a recorded attempt: `EM-LLM-01-qwen2.5-3b`, `SQ-LLM-01-llama3.1-8b`, `SQ-LLM-02-qwen2.5-3b`. They are counted as not reaching a verdict and never as a pass. The reason is under "Remaining failures and risks" below.

## BEFORE and AFTER-2

| | BEFORE | AFTER-2, outcome-aware (headline) | AFTER-2, original rule |
| --- | --- | --- | --- |
| RigorRun-mode cases run | <!-- n:baseline.counts.rigorrunMode -->26<!-- /n --> | <!-- n:RIGORRUN_MODE_CASES_RUN -->23<!-- /n --> of <!-- n:RIGORRUN_MODE_CASES -->26<!-- /n --> | |
| Reaching a PASS or FAIL verdict | <!-- n:baseline.totals.rigorrun_scored_cases -->26<!-- /n --> | <!-- n:SCORED_CASES -->23<!-- /n --> | |
| True positives | <!-- n:baseline.totals.true_positives -->10<!-- /n --> | <!-- n:TRUE_POSITIVES -->19<!-- /n --> | <!-- n:ORIGINAL_RULE.TRUE_POSITIVES -->19<!-- /n --> |
| True negatives | <!-- n:baseline.totals.true_negatives -->0<!-- /n --> | <!-- n:TRUE_NEGATIVES -->4<!-- /n --> | <!-- n:ORIGINAL_RULE.TRUE_NEGATIVES -->4<!-- /n --> |
| False positives | <!-- n:baseline.totals.false_positives -->6<!-- /n --> | <!-- n:FALSE_POSITIVES -->0<!-- /n --> | <!-- n:ORIGINAL_RULE.FALSE_POSITIVES -->0<!-- /n --> |
| False negatives | <!-- n:baseline.totals.false_negatives -->10<!-- /n --> | <!-- n:FALSE_NEGATIVES -->0<!-- /n --> | <!-- n:ORIGINAL_RULE.FALSE_NEGATIVES -->0<!-- /n --> |
| Not reaching a verdict (abstained, timed out, harness failure, not run) | none; every graded case was forced into PASS or FAIL | <!-- n:NOT_REACHING_VERDICT -->3<!-- /n --> | |
| Of which abstentions or cases not run | none | <!-- n:ABSTENTIONS -->3<!-- /n --> | |
| Known-good cases graded correctly (among cases run) | <!-- n:KNOWN_GOOD_CORRECT_BEFORE -->0<!-- /n --> of <!-- n:KNOWN_GOOD_BEFORE -->6<!-- /n --> | <!-- n:KNOWN_GOOD_CORRECTLY_GRADED -->4<!-- /n --> of <!-- n:KNOWN_GOOD_TOTAL -->4<!-- /n --> | |
| Injected failures the oracle observed | <!-- n:baseline.totals.injected_failures_detected_by_oracle -->2<!-- /n --> of <!-- n:baseline.totals.injected_failures -->3<!-- /n --> | <!-- n:INJECTED_FAILURES_OBSERVED_BY_ORACLE -->3<!-- /n --> of <!-- n:INJECTED_FAILURES_TOTAL -->3<!-- /n --> | |
| Injected failures detected by RigorRun | <!-- n:baseline.totals.injected_failures_detected_by_rigorrun -->0<!-- /n --> of <!-- n:baseline.totals.injected_failures -->3<!-- /n --> | <!-- n:INJECTED_FAILURES_DETECTED -->1<!-- /n --> of <!-- n:INJECTED_FAILURES_REACHED -->1<!-- /n --> (the injected failures RigorRun grades) | |
| R-1 reproductions | <!-- n:R1_REPRODUCTIONS_BEFORE -->11<!-- /n --> of <!-- n:R1_CASES -->11<!-- /n --> | <!-- n:R1_REPRODUCTIONS -->0<!-- /n --> of the <!-- n:R1_CASES_RUN -->10<!-- /n --> R-1 cases run | <!-- n:R1_REPRODUCTIONS_ORIGINAL_RULE -->0<!-- /n --> |
| Verification strength on graded cases | PARTIAL everywhere | PARTIAL on <!-- n:VERIFICATION_STRENGTH_BREAKDOWN.PARTIAL -->23<!-- /n --> | |
| Evidence independence | not labelled | SELF_REPORTED on <!-- n:EVIDENCE_INDEPENDENCE_BREAKDOWN.SELF_REPORTED -->23<!-- /n --> | |
| Baseline a case is compared with | the generation-time snapshot | observed at case start on <!-- n:BASELINE_SOURCE_BREAKDOWN.OBSERVED_AT_START -->23<!-- /n --> | |
| RigorRun findings | <!-- n:baseline.totals.confirmed_rigorrun_findings -->8<!-- /n --> open | <!-- n:RIGORRUN_FINDINGS_FIXED -->7<!-- /n --> fixed, <!-- n:RIGORRUN_FINDINGS_PARTIAL -->1<!-- /n --> partial, <!-- n:RIGORRUN_FINDINGS_UNRESOLVED -->0<!-- /n --> unresolved | |

Two of the three injected failures are direct probes (`EM-GM-07`, `SQ-D-09`) that call the server without RigorRun, as they did at the baseline. RigorRun can only detect the third, `EM-GM-06`.

R-8, Worktide: at the baseline both journeys were refused at compile. In AFTER-2 the setup records read: W2 compiled = <!-- n:JOURNEYS.worktide-mcp/w2.compiled -->true<!-- /n -->, suite built = <!-- n:JOURNEYS.worktide-mcp/w2.suiteBuilt -->true<!-- /n -->; W3 compiled = <!-- n:JOURNEYS.worktide-mcp/w3.compiled -->true<!-- /n -->, suite built = <!-- n:JOURNEYS.worktide-mcp/w3.suiteBuilt -->true<!-- /n -->. Each suite's own quality check reports a false-positive rate of <!-- n:JOURNEYS.worktide-mcp/w2.quality.false_positive_rate -->1<!-- /n --> (W2) and <!-- n:JOURNEYS.worktide-mcp/w3.quality.false_positive_rate -->1<!-- /n --> (W3). That is the open defect N-1 below.

## Every RigorRun-mode case

| Case | Oracle (AFTER-2) | BEFORE | AFTER-1 | AFTER-2 outcome-aware | AFTER-2 original rule |
| --- | --- | --- | --- | --- | --- |
| `EM-GM-01-correct` | PASS | FALSE_POSITIVE | TRUE_NEGATIVE | TRUE_NEGATIVE | TRUE_NEGATIVE |
| `EM-GM-02-missing-action-false-claim` | FAIL | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `EM-GM-03-duplicate` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `EM-GM-04-wrong-recipient` | FAIL | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `EM-GM-05-wrong-subject` | FAIL | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `EM-GM-06-retry-after-lost-response` | FAIL | FALSE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `EM-GMA-01-correct` | PASS | FALSE_POSITIVE | TRUE_NEGATIVE | TRUE_NEGATIVE | TRUE_NEGATIVE |
| `EM-GMA-02-missing-action-false-claim` | FAIL | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `EM-GMA-03-duplicate` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `EM-GMA-04-wrong-recipient` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `EM-GMA-05-wrong-subject` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `EM-LLM-01-qwen2.5-3b` | not run | TRUE_POSITIVE | TIMED_OUT | NOT_RUN | NOT_RUN |
| `SQ-LLM-01-llama3.1-8b` | not run | TRUE_POSITIVE | TIMED_OUT | NOT_RUN | NOT_RUN |
| `SQ-LLM-02-qwen2.5-3b` | not run | FALSE_POSITIVE | TRUE_NEGATIVE | NOT_RUN | NOT_RUN |
| `SQ-W1-01-correct` | PASS | FALSE_POSITIVE | TRUE_NEGATIVE | TRUE_NEGATIVE | TRUE_NEGATIVE |
| `SQ-W1-02-missing-action-false-claim` | FAIL | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `SQ-W1-03-duplicate` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `SQ-W1-04-wrong-value` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `SQ-W1-05-wrong-entity` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `SQ-W1-06-forbidden-extra-delete` | FAIL | TRUE_POSITIVE | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `SQ-W1B-01-correct` | PASS | FALSE_POSITIVE | TRUE_NEGATIVE | TRUE_NEGATIVE | TRUE_NEGATIVE |
| `SQ-W1B-02-missing-action-false-claim` | FAIL | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `SQ-W1B-03-duplicate` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `SQ-W1B-04-wrong-value` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `SQ-W1B-05-wrong-entity` | FAIL | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE | TRUE_POSITIVE |
| `SQ-W1B-06-forbidden-extra-delete` | FAIL | TRUE_POSITIVE | FALSE_NEGATIVE | TRUE_POSITIVE | TRUE_POSITIVE |

## Test suite

- **BEFORE.** <!-- n:baseline.tests.passed -->847<!-- /n --> of <!-- n:baseline.tests.tests -->847<!-- /n --> tests passed in <!-- n:baseline.tests.files -->73<!-- /n --> files, at the audited commit (`../evidence/rigorrun-test-remediation-baseline.log`).
- **AFTER.** <!-- n:TESTS.testsPassed -->969<!-- /n --> of <!-- n:TESTS.tests -->969<!-- /n --> tests passed in <!-- n:TESTS.filesPassed -->89<!-- /n --> of <!-- n:TESTS.files -->89<!-- /n --> files. Any failure recorded: <!-- n:TESTS.failed -->false<!-- /n -->. This was the full suite at the final commit (`evidence/final-test.log`).

## Held-out validation, reported separately

Both sets were built after the fixes, their expectations committed before the first run, and neither is merged into the numbers above. P8 (`65bbaed`) changed product code after the in-process set's first run; a commit shown below that predates `65bbaed` means that set has not been re-run since.

- **In-process set (commit <!-- n:HELDOUT.inprocess.rigorrunCommit -->d4ba04deff13c5f242a923ab789c8c391ae937be<!-- /n -->).**
  - <!-- n:HELDOUT.inprocess.matchingExpected -->23<!-- /n --> of <!-- n:HELDOUT.inprocess.cases -->23<!-- /n --> cases matched their expectation.
  - Known-good cases failed: <!-- n:HELDOUT.inprocess.knownGoodIncorrectlyFailed -->0<!-- /n -->. Known-bad cases passed: <!-- n:HELDOUT.inprocess.knownBadIncorrectlyPassed -->0<!-- /n -->.
  - Undecidable cases given a verdict: <!-- n:HELDOUT.inprocess.undecidableGivenAVerdict -->0<!-- /n -->. Unfinished cases given a verdict: <!-- n:HELDOUT.inprocess.notFinishedGivenAVerdict -->0<!-- /n -->.
  - Abstentions: <!-- n:HELDOUT.inprocess.abstentions -->6<!-- /n -->.
- **External set on the real servers (commit <!-- n:HELDOUT.external.rigorrunCommit -->d87abca7dc182f73873f8a30d594786f4888ecd1<!-- /n -->).**
  - <!-- n:HELDOUT.external.run -->16<!-- /n --> of the 16 defined cases ran, and <!-- n:HELDOUT.external.matchingExpected -->15<!-- /n --> of the <!-- n:HELDOUT.external.cases -->16<!-- /n --> recorded matched their expectation.
  - Known-good cases failed: <!-- n:HELDOUT.external.knownGoodIncorrectlyFailed -->0<!-- /n -->. Known-bad cases passed: <!-- n:HELDOUT.external.knownBadIncorrectlyPassed -->1<!-- /n -->.
  - Against the oracle: <!-- n:HELDOUT.external.falsePositivesAgainstOracle -->0<!-- /n --> false positives and <!-- n:HELDOUT.external.falseNegativesAgainstOracle -->1<!-- /n --> false negatives.
  - Timed out: <!-- n:HELDOUT.external.timedOut -->1<!-- /n -->. Oracle contradicting a truth label: <!-- n:HELDOUT.external.oracleDisagreesWithTruthLabel -->0<!-- /n -->. Fault not landing as intended: <!-- n:HELDOUT.external.faultNotAsIntended -->0<!-- /n -->.
  - Cases with no recorded run: none.

Per-case results: `heldout/results-inprocess.json`, `heldout/results-external.json`.

## How the AFTER numbers are scored

Every number below is read from `after-results.json`, which `scripts/aggregate-after.mjs` generates from the attempt records. `aggregate-after.mjs --check` regenerates the file and compares every marked number in this document against it.

Two classifications are carried for every RigorRun-mode case:

- **Original rule.** This is the audit's own rule, applied unchanged. A RigorRun FAIL is a detection whatever caused it, so a timeout or a crash counts as FAIL. BEFORE and AFTER are directly comparable under this rule.
- **Outcome-aware rule (headline).** This rule uses the outcome RigorRun now reports.
  - PASS and FAIL are verdicts.
  - ABSTAIN and HARNESS_FAILURE are not verdicts and are never counted as a pass.
  - TIMED_OUT and AGENT_FAILURE are reported on their own and are never counted as a detection.

A case that did not run is counted as not reaching a verdict. It is never dropped.

## What changed in RigorRun

- **R-1 (runtime baseline).** A case against a system that cannot be seeded is compared with the world RigorRun reads at case start, not with the snapshot taken when the suite was generated.
- **R-1 (expected delta).** The generated checks require exactly the demonstrated number of new or changed records, with the requested values. A changed record must also carry the requested identifier. Since P8, deletions of that kind of record must also match the demonstration, which usually means none.
- **R-3.** Typed cells (`{kind, value}`) are read as values, and wrapped rows keep their table's name. The sqlite rows are now one entity keyed by `id`.
- **R-4.** The case budget is 60 s, above the 20 s tool timeout with a 5 s margin, and it is configurable. A timeout, an agent crash, a harness failure and missing evidence are separate outcomes.
- **R-5.** The goal comes from the project. The job's arguments come from the call that changed state.
- **R-8.** One normalisation layer interprets every tool result. JSON inside a text block is data. Prose is never read as state.
- **R-2, R-6, R-7.** A project can verify through a second connection, and a project can be set up headlessly. `verify --needs-credential` is wired, but the sandbox is still Node-only.

## AFTER-1: the first full re-run, kept because it found a regression

AFTER-1 measured commit `f4145bb` on <!-- n-after-1:CASES_RUN -->58<!-- /n-after-1 --> of the <!-- n-after-1:TOTAL_CASES -->58<!-- /n-after-1 --> frozen cases. Its numbers are read from `after-1-results.json`, and `AFTER_RUN=after-1 node scripts/aggregate-after.mjs --check` verifies every number in this section.

| AFTER-1 | Outcome-aware rule | Original rule |
| --- | --- | --- |
| True positives | <!-- n-after-1:TRUE_POSITIVES -->17<!-- /n-after-1 --> | <!-- n-after-1:ORIGINAL_RULE.TRUE_POSITIVES -->18<!-- /n-after-1 --> |
| True negatives | <!-- n-after-1:TRUE_NEGATIVES -->5<!-- /n-after-1 --> | <!-- n-after-1:ORIGINAL_RULE.TRUE_NEGATIVES -->5<!-- /n-after-1 --> |
| False positives | <!-- n-after-1:FALSE_POSITIVES -->0<!-- /n-after-1 --> | <!-- n-after-1:ORIGINAL_RULE.FALSE_POSITIVES -->1<!-- /n-after-1 --> |
| False negatives | <!-- n-after-1:FALSE_NEGATIVES -->2<!-- /n-after-1 --> | <!-- n-after-1:ORIGINAL_RULE.FALSE_NEGATIVES -->2<!-- /n-after-1 --> |
| R-1 reproductions | <!-- n-after-1:R1_REPRODUCTIONS -->0<!-- /n-after-1 --> | <!-- n-after-1:R1_REPRODUCTIONS_ORIGINAL_RULE -->0<!-- /n-after-1 --> |
| Known-good cases graded correctly | <!-- n-after-1:KNOWN_GOOD_CORRECTLY_GRADED -->5<!-- /n-after-1 --> of <!-- n-after-1:KNOWN_GOOD_TOTAL -->6<!-- /n-after-1 --> | |

Both false negatives were new, and both were serious.

- **The cases.** `SQ-W1-06` and `SQ-W1B-06` insert the requested row and then delete another one.
- **At the baseline.** They counted as detections only because of R-1: the stale baseline made the demonstrated row look absent.
- **After R-1 was fixed.** The checks covered what was created and nothing covered what was deleted.

P8 fixed this. AFTER-2, reported in the tables above, re-ran the whole benchmark at the fixed commit, and the release gate (`scripts/release-gate.mjs`, written to `release-gate.json`) is evaluated on AFTER-2.

The one false positive under the original rule is `SQ-LLM-01`. The local model did the job, but it did not finish inside the 60 s budget, and RigorRun reported TIMED_OUT.

The first attempt at AFTER-1 was stopped by the host's low-memory guard when that model loaded. The 14 unrun cases were resumed with the same tooling on the same stacks, as recorded in `progress.md`.

## Remaining failures and risks

- **N-1, Worktide suites cannot be trusted.** R-8 is fixed, so the Worktide W2 and W3 journeys now compile. Their only nominated read is a time report whose groups have no identifier, so induction keys a group by its minutes value. The suite's own quality check reports a false-positive rate of <!-- n:JOURNEYS.worktide-mcp/w2.quality.false_positive_rate -->1<!-- /n --> (W2) and <!-- n:JOURNEYS.worktide-mcp/w3.quality.false_positive_rate -->1<!-- /n --> (W3). None of the 58 frozen cases grades these suites; the held-out Worktide cases do.
- **A slow agent that did the job is TIMED_OUT, not PASS.** In AFTER-1, `SQ-LLM-01` changed the state correctly but ran past the 60 s budget. RigorRun does not grade a run that did not finish. The audit's original rule counts it as a false positive.
- **What the delta checks still cannot see.**
  - An unrequested change to another record of the focus entity is not caught. Real reads flip flags and counters, so a check on that would fail correct agents.
  - Which record a demonstrated deletion removed is not bound.
  - Records of entities other than the focus entity are not held to the demonstration.
  - A newest-N read that is already full would show a correct creation as a deletion.
- **R-2 is a capability, not a result.** Every re-run verdict still rests on reads through the connection the agent used, and each verdict is labelled SELF_REPORTED. The frozen specs have a single connector.
- **R-7 is partial.** `verify --needs-credential` works, but the verify sandbox is still Node-only, so none of the three audited servers can go through it.
- **The GreenMail suite's own quality check is weak.** Its mutant kill rate is <!-- n:JOURNEYS.email-mcp/gm-w1.quality.mutant_kill_rate -->0.5<!-- /n -->; the baseline caught none (`../traces/email-mcp/gm-w1-setup/quality.json`). Its replay stability is <!-- n:JOURNEYS.email-mcp/gm-w1.quality.replay_stability -->false<!-- /n -->, as at the baseline.
- **MailHog W1 is still refused at compile, correctly.** The message is the baseline's. The target's `check_inbox` crashes (E-1), so nothing can be verified.
- **Host memory shaped both re-runs.**
  - AFTER-1 and AFTER-2 were each stopped by the host's low-memory guard when a local model loaded.
  - Unscored cases were resumed with the same tooling on the same stacks.
  - Local-model cases ran only with headroom, and any that never got it are reported as not run.
- **Environment note.** The pinned email-mcp checkout carries one extra draft written during the original audit. It was never touched, and it is identical for every run.
