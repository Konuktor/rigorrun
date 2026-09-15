# Requalification after the final qualification (NO_GO) — stage A record

The final qualification at product commit `a9edbec` returned NO_GO (`../final-qualification/README.md`). This directory holds the requalification. Nothing under `../final-qualification/`, `../remediation/`, `../cases/` or `../scripts/` is edited or added to; the v1 freezes stay verifiable.

Decisions were made with the user on 2026-09-15, before any new run:

1. **Frame conditions over every record type.** Anything outside the demonstrated frame FAILs. A field is excluded only when proven read-mutated. When a change can't be attributed, the result is ABSTAIN, never PASS.
2. **IO-7.** State comes from the verifier only once a verifier read is nominated.
3. **GreenMail in benchmark-v1.** Kept strict.
4. **Budgets.** v1 stays at 60 s. benchmark-v2 pre-registers 90 s for local-model cases.
5. **GreenMail in benchmark-v2.** Oracle labels cover the full generated suite, judged per case.
6. **Gate basis.** v2 decides GO/NO_GO; v1 is reported alongside.
7. **IO-v2.** A second record type plus a read that changes state, frozen before any run.
8. **Per-case oracle readings.** Taken through a generic after-case hook.
9. **Generator.** The instruction must not contradict the case's inputs.
10. **Over-cautious control.** Stays strict and asks only for permissions its plan lacks (decided during stage A).
11. **A3 wording.** One identical sentence on every case (decided during stage A).

Every number below was read from a log in `evidence/stage-a/`.

## P10 — State from the verifier only (audit IO-7-mixed-a)

- **Defect.**
  - `stateFromPayloads` (`packages/connector/src/rows.ts`) let a later answer's rows replace an earlier answer's.
  - `SystemEnvironment.getState` did not tell verifier reads from the system's own reads.
  - Result: a connector read that misreported state, nominated after the verifier, turned a wrong world into PASS.
  - The regression tests also showed the connector-first order was unsafe: a record invented by the system's read survived the merge.
- **Fix.**
  - `readsForVerdict` (`packages/connector/src/verified.ts`): once any verifier read is nominated, only verifier reads are used, and the system's own reads are neither merged nor called.
  - Applied to the verdict state, every demonstration reading, and the setup probe.
  - Setup returns `readsIgnored` and says which reads are ignored.
  - The `stateReadIndependence` label is unchanged: a mixed project stays SELF_REPORTED.
- **Evidence.**
  - Before the fix: 8 of 19 connector tests and 3 of 3 daemon tests failed (`io7-connector-before-fix.log`, `io7-daemon-before-fix.log`).
  - After the fix: connector, daemon and CLI passed 42 files, 327/327 (`io7-packages-after-fix.log`).
- **Commits.** `2cc8980` (tests), `7e2e6a1` (fix).

## P9 — Frame conditions over every record type (audit IO-5; supersedes P8 alternative (a) by user decision)

- **Defect.** A job that creates records was held only to what it created. A correct task plus an unrelated change passed, although the verifier observed the change.
- **Fix.**
  - **Contract.** `expectedFrame` records, per schema entity, how many records were created, deleted and changed, which fields changed, how many records existed at the start, and whether identity is established.
  - **Generated check.** Every case gets `frame__nothing_else_changed` (kind `state_frame`), a blocking invariant.
  - **Declined cases.** The job's own record type is held to nothing; other types keep the demonstrated bound.
  - **Double reads.** The runner reads the world twice at each end, but only for cases carrying the check. The seed is the second starting read, the final state is the first final read, and neither read spends the agent's budget.
  - **Verifier FAILs** more created, deleted or changed records, or a changed field the demonstration never changed, whatever the field's type. A field is excluded only when the two readings prove the reads change it.
  - **Verifier UNVERIFIABLE (ABSTAIN)** in exactly four situations:
    - `frame_membership_unstable:<E>`: records appeared or disappeared between two readings with nothing in between (creations and deletions only);
    - `frame_existing_rows_undemonstrated:<E>`: the demonstration had no records of that kind (updates and deletions only);
    - `frame_entity_not_in_contract:<E>`: a changed record type the contract does not know;
    - `frame_evidence_missing`.
- **Evidence.**
  - Before the fix: 41 of 90 tests failed across six files; the 49 guards passed (`frame-before-fix.log`).
  - After the fix: 7 files, 102/102 (`frame-after-fix.log`).
  - Deliberate test changes:
    - `packages/runner/test/outcomes.test.ts` now fails the third read to reach the final world;
    - the `expectedDelta.test.ts` note and the generator comment that said changes to other records are not held were rewritten.
- **Commits.** `e60f8e5` (tests; message corrected before any later commit), `8013852` (vocabulary), `32d561c` (enforcement).

### P9a — The over-cautious control (decision 10)

- **Conflict found.** The first full suite with the frame had 3 failures in 1076, all the suite-quality guarantee "never fails an implementation for being over-careful" in refund, lead and access (`full-test-after-frame.log`).
- **Cause, measured by a probe.** The `over_cautious` control requested every remedy, then replayed a plan that already contained it, filing the same approval request twice: "2 ManagerApproval record(s) created, where the demonstration created 1". No other check failed.
- **Fix.** The control asks only for remedies its plan lacks.
- **Measured with the tightened control.**
  - 0 non-passing cases in refund (22), lead (10) and access (13), with an unneeded permission request in 18, 4 and 10 of them.
  - Invoice (13) and fulfillment (12) are also 0 non-passing, but with 0 unneeded requests both before and after the change. That is a limit of the control in those two workflows, pinned in `packages/quality/test/quality.test.ts`.
  - Before the control change the quality file failed 8 of 42 (`over-cautious-before-fix.log`).
- **Commits.** `d75fb3b` (test), `4491fbd` (fix).

## P11 — The instruction no longer contradicts the work order (decisions 9 and 11)

- **Defect.** Generated instructions render only the contract goal, so a GreenMail `missing_precondition` case asked for service `Record1-DOES-NOT-EXIST` under "…through the default service".
- **Why not per-case values.** The approved per-case wording would have broken `checkIsolation` (`packages/quality/src/quality.ts:361-363`), which requires every case's instruction to be identical.
- **Fix.** One identical sentence on every instruction: "The work order that comes with this task carries its inputs; where the goal above names a different value, the work order takes precedence."
- **Evidence.** Before the fix the new test failed and the 15 other generator counterfactual tests passed (`instruction-before-fix.log`).
- **Commits.** `6a2f535` (test), `a6f60ed` (fix).

## P12 — `--after-case <program>` (decision 8)

- **Behaviour.**
  - `Service.runAgent` takes `afterCase(result, index)`, awaited after each case's final state read and before the next case starts. A throw stops the run.
  - `rigorrun run|gate --after-case <program>` wires it for both project and file pipelines.
- **Changed from the plan.** The security guard (`packages/cli/test/security.test.ts:61-75`) allows only `packages/exec/src/exec.ts` to start processes, and never through a shell, so a shell command is not possible. The program runs through `@rigorrun/exec` `runCommand`:
  - no shell and no arguments;
  - a minimal environment plus `RIGORRUN_RUN_ID`, `RIGORRUN_AGENT_ID`, `RIGORRUN_CASE_ID`, `RIGORRUN_CASE_INDEX`, `RIGORRUN_CASE_OUTCOME` and `RIGORRUN_CASE_CATEGORY`;
  - provenance `operator-configured` and a 10-minute timeout;
  - output goes to stderr;
  - a non-zero exit, a timeout or a refused command line stops the run with exit 2.
- **Evidence.**
  - Before the implementation, the daemon tests failed 2 of 2 and the CLI test file failed to import (`after-case-before-fix.log`).
  - The first implementation failed the security guard (`full-test-after-a3-a4.log`: 1 failed, 1087 passed).
- **Commits.** `03ad7d6` (tests), `94d7230` (feature).

## Stage A verification (final tree `94d7230`)

| Check | Result | Log |
| --- | --- | --- |
| Full suite | 99 files, 1089/1089 | `full-test-after-hook-exec.log` |
| Typecheck | exit 0 | `typecheck-after-hook-exec.log` |
| Lint on every changed file | exit 0 | (run per commit) |
| Frozen in-process held-out set, unmodified | 23 cases, 23 matching expected, 0 known-good failed, 0 known-bad passed, 6 abstentions | `heldout-inprocess-final/` |
| Original defects (inline copy of `remediation/repro/run-repro.sh after`, log redirected) | 10/10 defect assertions fail, so all 10 defects remain absent | `repro-after.log` |
| e2e (`pnpm e2e`) | 56 passed | `e2e.log` |

## Residual risks carried into the qualification

1. **Windowed reads.** A count-preserving delete plus create fails rather than abstains, so a correct agent against a full newest-N listing fails. The focus-deletion check already did this. The follow-up is per-read coverage metadata.
2. **Allowed set.** It is the demonstrated set only; there is no review-time allowance.
3. **Declined cases** keep the demonstrated bound on record types other than the job's own.
4. **The demonstration is read once at each end,** so a read-induced change during it becomes an allowed update. That makes the frame more permissive.
5. **Changes during the agent's run that aren't attributable:**
   - an external writer between the second starting read and the first final read;
   - a clock-driven field that ticks during the agent's run but not between the two readings.

   Both fail rather than abstain.
6. **GreenMail `Email`** starts every demonstration with no rows, so changes to existing mail abstain. An asynchronous seen-flag would make a known-good accumulate-mode attempt abstain, which is measured, not assumed.
7. **The over-cautious control** exercises no unneeded permission in invoice and fulfillment.
