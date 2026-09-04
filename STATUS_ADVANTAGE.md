# Demonstration-to-eval — build status

Live checklist for the generalization build. Updated against executed commands,
not intent. The audit this burns down is `docs/GENERALIZATION_AUDIT.md`.

**Thesis:** show RigorRun how the job is done once, get an executable acceptance
suite for every AI agent — on *any* workflow, not one.

| Phase | What | State |
| ----- | ---- | ----- |
| 0  | Generalization audit                          | ✅ `docs/GENERALIZATION_AUDIT.md` |
| 1  | `@rigorrun/environment` adapter SDK           | ✅ 28 tests |
| 2  | Generic derived projection                    | ✅ |
| 3  | CanonicalHumanTrace + three producers         | ✅ |
| 4  | Generic state-delta engine                    | ✅ |
| 5  | Provenance + rule lifecycle                   | ✅ |
| 6  | Generic contract compiler (10 templates)      | ✅ |
| 7  | Typed verifier synthesis + tri-state          | ✅ |
| 8  | State-aware counterfactual generator          | ✅ |
| 9  | Five demo environments + generic agents       | ✅ |
| 10 | Hidden sixth-domain acceptance test           | ✅ 10 tests, zero code changes |
| 11 | Benchmark mutation testing                    | ✅ |
| 12 | Benchmark quality + time-to-benchmark         | ✅ |
| 13 | Browser execution lane                        | ⬜ |
| 14 | BYO agent / BYO environment / privacy / CLI   | ⬜ |
| 15 | Product UX, `/proof`, docs                    | ⬜ |
| 16 | Anti-hardcoding gate, full green, deploy      | 🔵 gate done |

## Success criteria (from the brief §34)

| # | Criterion | State |
| - | --------- | ----- |
| 1  | Same generic compiler processes all five workflows | ⬜ |
| 2  | No workflow-specific branching in generic core     | ⬜ |
| 3  | Sixth hidden-domain test works with no code change | ⬜ |
| 4  | Human trace generates observed facts               | ⬜ |
| 5  | Inferences retain provenance                       | ⬜ |
| 6  | User confirmation changes enforcement              | ⬜ |
| 7  | Counterfactuals from schema/rules/state mutations  | ⬜ |
| 8  | Typed deterministic verifiers synthesized          | ⬜ |
| 9  | Benchmark catches intentionally broken mutants     | ⬜ |
| 10 | Mutation kill rate calculated                      | ⬜ |
| 11 | Replay stability measured                          | ⬜ |
| 12 | Private verifier data cannot leak to the agent     | ⬜ |
| 13 | Two workflows execute through real browser UI      | ⬜ |
| 14 | External HTTP agent adapter works                  | ⬜ |
| 15 | Environment SDK exists, example integration works  | ⬜ |
| 16 | Raw trace stays local by default                   | ⬜ |
| 17 | Existing RigorRun demo still works                 | ⬜ |
| 18 | All release gates remain green                     | ⬜ |
