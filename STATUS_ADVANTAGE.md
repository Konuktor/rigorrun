# Demonstration-to-eval — build status

Updated against executed commands, not intent.

**Thesis:** show RigorRun how the job is done once, get an executable
acceptance suite for every AI agent — on *any* workflow, not one.

**One command:** `pnpm verify` (lint · typecheck · domain leak · tests · build).

| Phase | What | State |
| ----- | ---- | ----- |
| 0  | Generalization audit                          | ✅ `docs/GENERALIZATION_AUDIT.md` |
| 1  | `@rigorrun/environment` adapter SDK           | ✅ conformance kit included |
| 2  | Generic derived projection                    | ✅ replaces every hand-written join |
| 3  | CanonicalHumanTrace + three producers         | ✅ browser · action log · import |
| 4  | Generic state-delta engine                    | ✅ |
| 5  | Provenance + rule lifecycle                   | ✅ observed/inferred/confirmed/rejected |
| 6  | Generic contract compiler                     | ✅ 11 rule shapes, no vocabulary |
| 7  | Typed verifier synthesis + tri-state          | ✅ paths validated, never fail-open |
| 8  | State-aware counterfactual generator          | ✅ expectations computed, not written |
| 9  | Five demo environments + generic agents       | ✅ |
| 10 | Hidden sixth-domain acceptance test           | ✅ zero product changes |
| 11 | Benchmark mutation testing                    | ✅ defects and a control that must survive |
| 12 | Benchmark quality + time-to-benchmark         | ✅ measured, not estimated |
| 13 | Browser execution lane                        | ❌ **not built** |
| 14 | BYO agent · BYO environment · privacy · CLI   | ✅ HTTP + scaffold + `privacy inspect` |
| 15 | Product UX, `/proof`, docs                    | ✅ |
| 16 | Anti-hardcoding gate, full green, deploy      | ✅ |

## Success criteria (brief §34)

| # | Criterion | State |
| - | --------- | ----- |
| 1  | Same generic compiler processes all five workflows | ✅ `workflows.test.ts`, no branch on workflow |
| 2  | No workflow-specific branching in generic core     | ✅ `pnpm domain` |
| 3  | Sixth hidden-domain test works with no code change | ✅ `unknownDomain.test.ts` |
| 4  | Human trace generates observed facts               | ✅ from the state delta |
| 5  | Inferences retain provenance                       | ✅ 8 typed kinds, weakest-first reporting |
| 6  | User confirmation changes enforcement              | ✅ asserted by test |
| 7  | Counterfactuals from schema/rules/state mutations  | ✅ 16 primitives |
| 8  | Typed deterministic verifiers synthesized          | ✅ paths validated against a published schema |
| 9  | Benchmark catches intentionally broken mutants     | ✅ 3–4 of 4, per workflow |
| 10 | Mutation kill rate calculated                      | ✅ split by independence |
| 11 | Replay stability measured                          | ✅ canonical state hashed |
| 12 | Private verifier data cannot leak to the agent     | ✅ plus one identical brief per suite |
| 13 | Two workflows execute through real browser UI      | ❌ **not built** |
| 14 | External HTTP agent adapter works                  | ✅ protocol documented, SSRF-guarded |
| 15 | Environment SDK exists, example integration works  | ✅ scaffold + conformance kit |
| 16 | Raw trace stays local by default                   | ✅ `rigorrun privacy inspect` |
| 17 | Existing RigorRun demo still works                 | ✅ refund is one of the five |
| 18 | All release gates remain green                     | ✅ |

## Round two — the three decisions

| Decision | What was built |
| --- | --- |
| Deploy publicly, keep a rollback point | `rollback/pre-generalization` and `green/generalization-v1` tags; local gates before, production gates after |
| Six-step journey as the primary path | Six screens, not five: reviewing what RigorRun learned and ruling on it are separate acts |
| Schema-driven demo apps, themed per workflow | `apps/demo-ops` — one renderer, five products, no branch on which |

### The renderer

Everything that differs between the finance console, the CRM, the access
register, the warehouse and the support desk is a declaration on the
environment adapter:

entity and navigation labels · which view suits a collection · which columns
matter and how they align · what the sections on a record are · what each
lifecycle value means · which actions belong on a page and what to call them ·
layout · density · accent

Two tests hold the claim. One scans every file in the renderer for an
environment id, a workflow key, or a comparison against either. `pnpm domain`
covers the renderer alongside the compiler. A third set checks the
declarations themselves resolve — a column naming a field that does not exist
renders a blank where a number should be, and nothing would otherwise complain.
