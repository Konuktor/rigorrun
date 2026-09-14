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
| BEFORE | `07dda8c` (0.2.0) | {{baseline.counts.cases}} of {{baseline.totals.cases_total}} |
| AFTER-1 | {{a1:rigorrun_commit}} | {{a1:CASES_RUN}} of {{a1:TOTAL_CASES}} |
| AFTER-2 (final) | {{rigorrun_commit}} (product sources of `26d1e6a`) | {{CASES_RUN}} of {{TOTAL_CASES}} |

AFTER-2 cases without a recorded attempt: {{NOT_RUN}}. They are counted as not reaching a verdict and never as a pass. The reason is under "Remaining failures and risks" below.

## BEFORE and AFTER-2

| | BEFORE | AFTER-2, outcome-aware (headline) | AFTER-2, original rule |
| --- | --- | --- | --- |
| RigorRun-mode cases run | {{baseline.counts.rigorrunMode}} | {{RIGORRUN_MODE_CASES_RUN}} of {{RIGORRUN_MODE_CASES}} | |
| Reaching a PASS or FAIL verdict | {{baseline.totals.rigorrun_scored_cases}} | {{SCORED_CASES}} | |
| True positives | {{baseline.totals.true_positives}} | {{TRUE_POSITIVES}} | {{ORIGINAL_RULE.TRUE_POSITIVES}} |
| True negatives | {{baseline.totals.true_negatives}} | {{TRUE_NEGATIVES}} | {{ORIGINAL_RULE.TRUE_NEGATIVES}} |
| False positives | {{baseline.totals.false_positives}} | {{FALSE_POSITIVES}} | {{ORIGINAL_RULE.FALSE_POSITIVES}} |
| False negatives | {{baseline.totals.false_negatives}} | {{FALSE_NEGATIVES}} | {{ORIGINAL_RULE.FALSE_NEGATIVES}} |
| Not reaching a verdict (abstained, timed out, harness failure, not run) | none; every graded case was forced into PASS or FAIL | {{NOT_REACHING_VERDICT}} | |
| Of which abstentions or cases not run | none | {{ABSTENTIONS}} | |
| Known-good cases graded correctly (among cases run) | {{KNOWN_GOOD_CORRECT_BEFORE}} of {{KNOWN_GOOD_BEFORE}} | {{KNOWN_GOOD_CORRECTLY_GRADED}} of {{KNOWN_GOOD_TOTAL}} | |
| Injected failures the oracle observed | {{baseline.totals.injected_failures_detected_by_oracle}} of {{baseline.totals.injected_failures}} | {{INJECTED_FAILURES_OBSERVED_BY_ORACLE}} of {{INJECTED_FAILURES_TOTAL}} | |
| Injected failures detected by RigorRun | {{baseline.totals.injected_failures_detected_by_rigorrun}} of {{baseline.totals.injected_failures}} | {{INJECTED_FAILURES_DETECTED}} of {{INJECTED_FAILURES_REACHED}} (the injected failures RigorRun grades) | |
| R-1 reproductions | {{R1_REPRODUCTIONS_BEFORE}} of {{R1_CASES}} | {{R1_REPRODUCTIONS}} of the {{R1_CASES_RUN}} R-1 cases run | {{R1_REPRODUCTIONS_ORIGINAL_RULE}} |
| Verification strength on graded cases | PARTIAL everywhere | PARTIAL on {{VERIFICATION_STRENGTH_BREAKDOWN.PARTIAL}} | |
| Evidence independence | not labelled | SELF_REPORTED on {{EVIDENCE_INDEPENDENCE_BREAKDOWN.SELF_REPORTED}} | |
| Baseline a case is compared with | the generation-time snapshot | observed at case start on {{BASELINE_SOURCE_BREAKDOWN.OBSERVED_AT_START}} | |
| RigorRun findings | {{baseline.totals.confirmed_rigorrun_findings}} open | {{RIGORRUN_FINDINGS_FIXED}} fixed, {{RIGORRUN_FINDINGS_PARTIAL}} partial, {{RIGORRUN_FINDINGS_UNRESOLVED}} unresolved | |

Two of the three injected failures are direct probes (`EM-GM-07`, `SQ-D-09`) that call the server without RigorRun, as they did at the baseline. RigorRun can only detect the third, `EM-GM-06`.

R-8, Worktide: at the baseline both journeys were refused at compile. In AFTER-2 the setup records read: W2 compiled = {{JOURNEYS.worktide-mcp/w2.compiled}}, suite built = {{JOURNEYS.worktide-mcp/w2.suiteBuilt}}; W3 compiled = {{JOURNEYS.worktide-mcp/w3.compiled}}, suite built = {{JOURNEYS.worktide-mcp/w3.suiteBuilt}}. Each suite's own quality check reports a false-positive rate of {{JOURNEYS.worktide-mcp/w2.quality.false_positive_rate}} (W2) and {{JOURNEYS.worktide-mcp/w3.quality.false_positive_rate}} (W3). That is the open defect N-1 below.

## Every RigorRun-mode case

{{CASE_TABLE}}

## Test suite

- **BEFORE.** {{baseline.tests.passed}} of {{baseline.tests.tests}} tests passed in {{baseline.tests.files}} files, at the audited commit (`../evidence/rigorrun-test-remediation-baseline.log`).
{{#if TESTS}}- **AFTER.** {{TESTS.testsPassed}} of {{TESTS.tests}} tests passed in {{TESTS.filesPassed}} of {{TESTS.files}} files. Any failure recorded: {{TESTS.failed}}. This was the full suite at the final commit (`evidence/final-test.log`).
{{/if}}{{#unless TESTS}}- **AFTER.** The final full-suite run did not happen: the host never had the memory headroom for it. The last full run at the fixed product code is recorded in `progress.md` (P8), and it is not counted as the final run.
{{/unless}}
## Held-out validation, reported separately

Both sets were built after the fixes, their expectations committed before the first run, and neither is merged into the numbers above. P8 (`65bbaed`) changed product code after the in-process set's first run; a commit shown below that predates `65bbaed` means that set has not been re-run since.

- **In-process set (commit {{HELDOUT.inprocess.rigorrunCommit}}).**
  - {{HELDOUT.inprocess.matchingExpected}} of {{HELDOUT.inprocess.cases}} cases matched their expectation.
  - Known-good cases failed: {{HELDOUT.inprocess.knownGoodIncorrectlyFailed}}. Known-bad cases passed: {{HELDOUT.inprocess.knownBadIncorrectlyPassed}}.
  - Undecidable cases given a verdict: {{HELDOUT.inprocess.undecidableGivenAVerdict}}. Unfinished cases given a verdict: {{HELDOUT.inprocess.notFinishedGivenAVerdict}}.
  - Abstentions: {{HELDOUT.inprocess.abstentions}}.
{{#if HELDOUT.external}}- **External set on the real servers (commit {{HELDOUT.external.rigorrunCommit}}).**
  - {{HELDOUT.external.run}} of the 16 defined cases ran, and {{HELDOUT.external.matchingExpected}} of the {{HELDOUT.external.cases}} recorded matched their expectation.
  - Known-good cases failed: {{HELDOUT.external.knownGoodIncorrectlyFailed}}. Known-bad cases passed: {{HELDOUT.external.knownBadIncorrectlyPassed}}.
  - Against the oracle: {{HELDOUT.external.falsePositivesAgainstOracle}} false positives and {{HELDOUT.external.falseNegativesAgainstOracle}} false negatives.
  - Timed out: {{HELDOUT.external.timedOut}}. Oracle contradicting a truth label: {{HELDOUT.external.oracleDisagreesWithTruthLabel}}. Fault not landing as intended: {{HELDOUT.external.faultNotAsIntended}}.
  - Cases with no recorded run: {{HELDOUT_EXTERNAL_MISSING}}.
{{/if}}{{#unless HELDOUT.external}}- **External set.** It did not run.
{{/unless}}
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

AFTER-1 measured commit `f4145bb` on {{a1:CASES_RUN}} of the {{a1:TOTAL_CASES}} frozen cases. Its numbers are read from `after-1-results.json`, and `AFTER_RUN=after-1 node scripts/aggregate-after.mjs --check` verifies every number in this section.

| AFTER-1 | Outcome-aware rule | Original rule |
| --- | --- | --- |
| True positives | {{a1:TRUE_POSITIVES}} | {{a1:ORIGINAL_RULE.TRUE_POSITIVES}} |
| True negatives | {{a1:TRUE_NEGATIVES}} | {{a1:ORIGINAL_RULE.TRUE_NEGATIVES}} |
| False positives | {{a1:FALSE_POSITIVES}} | {{a1:ORIGINAL_RULE.FALSE_POSITIVES}} |
| False negatives | {{a1:FALSE_NEGATIVES}} | {{a1:ORIGINAL_RULE.FALSE_NEGATIVES}} |
| R-1 reproductions | {{a1:R1_REPRODUCTIONS}} | {{a1:R1_REPRODUCTIONS_ORIGINAL_RULE}} |
| Known-good cases graded correctly | {{a1:KNOWN_GOOD_CORRECTLY_GRADED}} of {{a1:KNOWN_GOOD_TOTAL}} | |

Both false negatives were new, and both were serious.

- **The cases.** `SQ-W1-06` and `SQ-W1B-06` insert the requested row and then delete another one.
- **At the baseline.** They counted as detections only because of R-1: the stale baseline made the demonstrated row look absent.
- **After R-1 was fixed.** The checks covered what was created and nothing covered what was deleted.

P8 fixed this. AFTER-2, reported in the tables above, re-ran the whole benchmark at the fixed commit, and the release gate (`scripts/release-gate.mjs`, written to `release-gate.json`) is evaluated on AFTER-2.

The one false positive under the original rule is `SQ-LLM-01`. The local model did the job, but it did not finish inside the 60 s budget, and RigorRun reported TIMED_OUT.

The first attempt at AFTER-1 was stopped by the host's low-memory guard when that model loaded. The 14 unrun cases were resumed with the same tooling on the same stacks, as recorded in `progress.md`.

## N-1: record identity and aggregate change (appended after AFTER-2)

N-1 was found in AFTER-2 and on the external held-out set: the Worktide suites named a time-report group by its minutes value, so EH-WT-03 (two time entries instead of one) passed. The numbers in this section are read from `n1/results.json`, which `n1/scripts/aggregate-n1.mjs` generates from N-1's evidence and checks in this prose.

- **What changed.**
  - A field seen changing for the same record between the recording's readings, or adding up to a total, is never a record's identity. Identity is one stable field, else the smallest set of stable fields, else declared unestablished.
  - One record key builds every state.
  - A record the job changes must change the way the demonstration changed it (`state_change`). A job that changes records is held to the records of that kind it creates.
  - Design and amendments: `n1/design.md`.
- **EH-WT-03 after the fix, final product sources** (commit {{n1:commit}}):
  - {{n1:EH_WT_03.fail}} of {{n1:EH_WT_03.attempts}} runs FAIL. Passes: {{n1:EH_WT_03.pass}}. In every run the oracle saw the duplicate staged: unassigned minutes 0 → 2 in {{n1:EH_WT_03.duplicateStaged}}.
  - The demonstrated change is minutes {{n1:EXPECTED_CHANGES.minutes.from}} → {{n1:EXPECTED_CHANGES.minutes.to}}.
  - The first measurement (commit {{n1:FIRST_MEASUREMENT.commit}}, before the creation check) had {{n1:FIRST_MEASUREMENT.EH_WT_03.fail}} FAIL and {{n1:FIRST_MEASUREMENT.EH_WT_03.timedOut}} TIMED_OUT (the host ran out of memory, and the duplicate was never staged) in {{n1:FIRST_MEASUREMENT.EH_WT_03.attempts}} runs.
  - Details: `n1/after-fix.md`.
- **Worktide v2 held-out set** (`heldout-worktide-v2/`, frozen at {{n1:V2.frozenAt}} before its first run; measured at {{n1:V2.commit}}). It has {{n1:V2.defined}} cases: {{n1:V2.knownGood}} known-good and {{n1:V2.knownBad}} known-bad.
  - **MCP-only gate block:** {{n1:V2.gate.run}} of {{n1:V2.gate.defined}} run. Known-good failed: {{n1:V2.gate.knownGoodIncorrectlyFailed}}. Known-bad passed: {{n1:V2.gate.knownBadIncorrectlyPassed}}. Abstentions: {{n1:V2.gate.abstentions}}. Timed out: {{n1:V2.gate.timedOut}}.
  - **Side-channel block:** {{n1:V2.sideChannel.run}} of {{n1:V2.sideChannel.defined}} run. Known-good failed: {{n1:V2.sideChannel.knownGoodIncorrectlyFailed}}. Known-bad passed: {{n1:V2.sideChannel.knownBadIncorrectlyPassed}}.
  - **Disclosed limit probes, not gated:** {{n1:V2.limitProbe.run}} of {{n1:V2.limitProbe.defined}} run. Known-bad cases RigorRun passed there: {{n1:V2.limitProbe.knownBadIncorrectlyPassed}}.
- **Tests.**
  - Before the fix, the N-1 regressions ran {{n1:TESTS_BEFORE_FIX.failed}} failed and {{n1:TESTS_BEFORE_FIX.passed}} passed.
  - Full suite at the final product sources: {{n1:TESTS.passed}} of {{n1:TESTS.total}} in {{n1:TESTS.files}} files.
  - In-process held-out set re-run at the N-1 commit: {{n1:INPROCESS.matchingExpected}} of {{n1:INPROCESS.cases}} as expected.

## Remaining failures and risks

- **N-1 (as found in AFTER-2; see the N-1 section above for what changed since): Worktide suites cannot be trusted.** R-8 is fixed, so the Worktide W2 and W3 journeys now compile. Their only nominated read is a time report whose groups have no identifier, so induction keys a group by its minutes value. The suite's own quality check reports a false-positive rate of {{JOURNEYS.worktide-mcp/w2.quality.false_positive_rate}} (W2) and {{JOURNEYS.worktide-mcp/w3.quality.false_positive_rate}} (W3). None of the 58 frozen cases grades these suites; the held-out Worktide cases do.
- **A slow agent that did the job is TIMED_OUT, not PASS.** In AFTER-1, `SQ-LLM-01` changed the state correctly but ran past the 60 s budget. RigorRun does not grade a run that did not finish. The audit's original rule counts it as a false positive.
- **What the delta checks still cannot see.**
  - An unrequested change to another record of the focus entity is not caught. Real reads flip flags and counters, so a check on that would fail correct agents.
  - Which record a demonstrated deletion removed is not bound.
  - Records of entities other than the focus entity are not held to the demonstration.
  - A newest-N read that is already full would show a correct creation as a deletion.
- **R-2 is a capability, not a result.** Every re-run verdict still rests on reads through the connection the agent used, and each verdict is labelled SELF_REPORTED. The frozen specs have a single connector.
- **R-7 is partial.** `verify --needs-credential` works, but the verify sandbox is still Node-only, so none of the three audited servers can go through it.
- **The GreenMail suite's own quality check is weak.** Its mutant kill rate is {{JOURNEYS.email-mcp/gm-w1.quality.mutant_kill_rate}}; the baseline caught none (`../traces/email-mcp/gm-w1-setup/quality.json`). Its replay stability is {{JOURNEYS.email-mcp/gm-w1.quality.replay_stability}}, as at the baseline.
- **MailHog W1 is still refused at compile, correctly.** The message is the baseline's. The target's `check_inbox` crashes (E-1), so nothing can be verified.
- **Host memory shaped both re-runs.**
  - AFTER-1 and AFTER-2 were each stopped by the host's low-memory guard when a local model loaded.
  - Unscored cases were resumed with the same tooling on the same stacks.
  - Local-model cases ran only with headroom, and any that never got it are reported as not run.
- **Environment note.** The pinned email-mcp checkout carries one extra draft written during the original audit. It was never touched, and it is identical for every run.
