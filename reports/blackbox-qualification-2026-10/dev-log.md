# Development runs (never counted)

AMENDMENT-1: before `freeze.json` exists, the harness and the agents may be run to fix faults in the harness itself. These runs never count and must not change the jobs, the agents' behaviours, the expected verdicts or the gates. Each is listed here by `run_bb.py run --dev`; its summaries are in `dev-runs/<id>/`, its cell records under `tmp/rigorrun-audit/bbq/dev/<id>/` (git-ignored).

## dev-20261001T021418Z

- HEAD 655e0439d1460fb110151e567c6f4ad02b3bbe58 on wt/s4-blackbox; uncommitted paths at start: 14
- Cells run: 3 (selected: update:correct)
- Classification: {'MISSING': 33, 'TRUE_NEGATIVE': 3}
- Gates (as if counted): 1_FN_is_0 True, 2_FP_is_0 True, 3_no_abstain_no_harness_failure False, 4_oracle_equals_expected False, 5_state_only_independent_unmade_call_order_listed True; outcome NO_GO
- Re-runs: 0; run time 3.9 s
- Note: first harness smoke test

## dev-20261001T021434Z

- HEAD 655e0439d1460fb110151e567c6f4ad02b3bbe58 on wt/s4-blackbox; uncommitted paths at start: 41
- Cells run: 36 (selected: create:correct, create:did_nothing, create:extra_note, create:second_write, create:wrong_entity, create:wrong_value, update:correct, update:did_nothing, update:extra_note, update:second_write, update:wrong_entity, update:wrong_value)
- Classification: {'TRUE_NEGATIVE': 6, 'TRUE_POSITIVE': 30}
- Gates (as if counted): 1_FN_is_0 True, 2_FP_is_0 True, 3_no_abstain_no_harness_failure True, 4_oracle_equals_expected True, 5_state_only_independent_unmade_call_order_listed True; outcome GO
- Re-runs: 0; run time 41.9 s
- Note: first full 36-cell development run

## dev-20261001T021740Z

- HEAD 655e0439d1460fb110151e567c6f4ad02b3bbe58 on wt/s4-blackbox; uncommitted paths at start: 20
- Cells run: 3 (selected: create:correct)
- Classification: {'MISSING': 33, 'TRUE_NEGATIVE': 3}
- Gates (as if counted): 1_FN_is_0 True, 2_FP_is_0 True, 3_no_abstain_no_harness_failure False, 4_oracle_equals_expected False, 5_state_only_independent_unmade_call_order_listed True; outcome NO_GO
- Re-runs: 1; run time 3.2 s
- Note: development test: one injected harness fault (attempt 2) to exercise the one permitted re-run and its disclosure; not a product or harness result

## dev-20261001T021820Z-counted-path-rehearsal

- HEAD d3b129d58335110df9cd8a0aea614a5c2fa9d52c on wt/s4-blackbox (the harness commit); worktree clean
- What: the counted code path (`setup` -> `freeze` -> `run` -> `aggregate`) run in-process with `FREEZE`, `EVIDENCE`, the state directory and the three counted outputs redirected to a scratch directory outside the repository, so no counted file was written under this qualification. The rehearsal freeze is kept as `freeze.rehearsal.json`; it is not this qualification's freeze.
- Refusals exercised, each as intended: `run` and `freeze` before a setup; `setup` and `run --dev` after the freeze; `run` with one harness hash altered in the freeze; `run` with the freeze pointed at the commit before the harness; a second `run` after the counted cells exist.
- Cells run: 36 (all). Classification: {'TRUE_NEGATIVE': 6, 'TRUE_POSITIVE': 30}
- Gates (as if counted): 1_FN_is_0 True, 2_FP_is_0 True, 3_no_abstain_no_harness_failure True, 4_oracle_equals_expected True, 5_state_only_independent_unmade_call_order_listed True; outcome GO
- Re-runs: 0; run time 42.6 s (02:18:23Z to 02:19:06Z)
- Found: `freeze` compared the setup's commit to HEAD exactly, so committing `evidence/setup/` before freezing would have been refused. Fixed before the next run: it now applies `run`'s rule (only this qualification's generated outputs may differ).

## dev-20261001T021923Z

- HEAD d3b129d58335110df9cd8a0aea614a5c2fa9d52c on wt/s4-blackbox; uncommitted paths at start: 4
- Cells run: 36 (selected: create:correct, create:did_nothing, create:extra_note, create:second_write, create:wrong_entity, create:wrong_value, update:correct, update:did_nothing, update:extra_note, update:second_write, update:wrong_entity, update:wrong_value)
- Classification: {'TRUE_NEGATIVE': 6, 'TRUE_POSITIVE': 30}
- Gates (as if counted): 1_FN_is_0 True, 2_FP_is_0 True, 3_no_abstain_no_harness_failure True, 4_oracle_equals_expected True, 5_state_only_independent_unmade_call_order_listed True; outcome GO
- Re-runs: 0; run time 42.6 s
- Note: final full development run with the committed harness (after the counted-path rehearsal and the freeze-check fix)

