# Where RigorRun is actually different

## How to read this

Two rules were applied while writing it.

**Nothing is claimed for RigorRun that is not in the repository and covered by
a test.** Every `YES` in the RigorRun column names the file or the command that
makes it true. Where something is partly built, it says `PARTIAL` and says what
is missing.

**Nothing is claimed about anyone else that was not verifiable.** This was
written in an environment with no network access, so competitor documentation
could not be read. Rather than guess, competitor cells are `UNKNOWN` unless the
capability is one the product publicly and prominently describes — and even
then the cell records that it is a description, not a test result. **`UNKNOWN`
means "not verified here", never "no".** A reader who can reach the vendors'
documentation should fill these in; several will move.

The comparison is also narrow on purpose. LangSmith, Braintrust, Giskard,
Promptfoo and the rest do a great deal that RigorRun does not do at all —
production tracing, prompt management, dataset curation, red-team libraries,
observability. This table is not a scorecard of those products. It is a list of
the capabilities that follow from one specific idea, so that a reader can see
what is genuinely new and what is table stakes.

## The idea

Everything below follows from one decision: **the input is a demonstration, not
a dataset.**

Most eval tooling begins after you already have something to evaluate — a
production trace, a golden dataset, a set of prompts. RigorRun begins before
that, with a person doing the job once, and derives the test suite from what
the system did while they worked.

## Capability matrix

| Capability | RigorRun | Trace/dataset eval platforms | Scenario generators | Notes |
| --- | --- | --- | --- | --- |
| Works with no dataset authored by hand | **YES** | UNKNOWN | UNKNOWN | Cases come from mutation primitives over the schema, not from authoring |
| Human demonstration as the input | **YES** | UNKNOWN | UNKNOWN | `recordDemonstration` → `induceContract` |
| Usable before any agent exists | **YES** | UNKNOWN | UNKNOWN | Nothing in the pipeline reads an agent trace |
| Observed facts kept apart from inferred rules | **YES** | UNKNOWN | UNKNOWN | `RuleStatus`, asserted by test, not a label |
| Typed provenance on every rule | **YES** | UNKNOWN | UNKNOWN | 8 provenance kinds, weakest-evidence reporting |
| Human confirmation changes enforcement | **YES** | UNKNOWN | UNKNOWN | Only `observed`/`confirmed` produce blocking checks |
| Generic state-delta extraction | **YES** | UNKNOWN | UNKNOWN | `diffStates` over any declared schema |
| Deterministic verifier synthesis | **YES** | UNKNOWN | UNKNOWN | Typed assertions only, no generated code |
| State-aware counterfactual generation | **YES** | PARTIAL (described) | PARTIAL (described) | Mutations chosen by schema and rules, not by a model |
| Testing the benchmark itself | **YES** | UNKNOWN | UNKNOWN | Injected defects, plus a control that must survive |
| Replay stability measured | **YES** | UNKNOWN | UNKNOWN | Canonical state hashed, not just verdicts |
| Verification against authoritative state | **YES** | PARTIAL (described) | PARTIAL (described) | Adapter state; the agent's own account is never read |
| Local-first by default | **YES** | UNKNOWN | UNKNOWN | No network in the required path |
| Browser workflow execution | **NO** | UNKNOWN | UNKNOWN | Not built. See below |
| Bring your own environment | **YES** | UNKNOWN | UNKNOWN | `@rigorrun/environment` + conformance kit |
| Bring your own agent | **PARTIAL** | UNKNOWN | UNKNOWN | HTTP and OpenAI-compatible adapters; no browser controller |
| Production trace ingestion | **NO** | YES (described) | UNKNOWN | Deliberately not built — see below |
| Prompt management, tracing, observability | **NO** | YES (described) | UNKNOWN | Different product |

## What the `YES` cells rest on

| Claim | Evidence |
| --- | --- |
| One compiler, five unrelated jobs | `packages/environments/test/workflows.test.ts` — no branch on which workflow |
| Generalises past the five | `packages/environments/test/unknownDomain.test.ts` — a domain written only inside a test file, zero product changes |
| Core stays domain-blind | `pnpm domain` — fails the build on a business noun in generic code |
| Only confirmed rules gate | `packages/core/test/environmentContract.test.ts` |
| The answer never reaches the agent | `checkIsolation`, plus an identical brief on every case |
| Benchmark quality | `packages/quality/test/quality.test.ts` |
| Time to a trustworthy benchmark | Measured with a real clock in `compileWorkflow`, published on `/proof` |

## What was deliberately not copied

Not from modesty — each of these is a real decision with a cost.

**Production trace ingestion.** The whole point is to work *before* there is
traffic to ingest. Building it first would have made the product need an agent
in production, which is the position every competitor already occupies.

**A model that writes test cases.** Asking a model for twenty edge cases
produces twenty plausible sentences whose relationship to the system is
unverified. Cases here come from the structure of the job: a threshold has a
value either side of it, a required link can be missing, a lifecycle has states
nobody demonstrated. That is checkable, repeatable and explainable, and it is
why the whole pipeline runs with no model at all.

**A model as arbiter.** The evaluator hierarchy is state → event → output →
human → model, and the model tier is not implemented. Shipping it half-done
would blur the line the product depends on. The type and the label exist so a
report can never mix a model's opinion in with authoritative state silently.

**A public leaderboard.** The value is that the benchmark is private and is
about *your* job.

**Red-teaming as a product.** Injection cases exist because untrusted text is
part of the workflow, not because jailbreaks are a category worth selling.

## What is missing, plainly

- **No browser execution lane.** Agents call a typed action API. The assertion
  kinds for DOM and HTTP exist and are tested, but nothing drives a real
  browser, so an agent that only works by clicking cannot be tested yet.
- **No model-judged evaluator.**
- **The reference implementation is an oracle.** It is given the answer. It
  proves the benchmark is satisfiable and nothing else, and is labelled as such
  everywhere it appears.
- **Every environment here is synthetic.** The SDK is real and conformance-
  checked; no third party has yet pointed it at a staging system.
- **Cross-demonstration recall is not measured.** The strongest available check
  on whether induction generalises is to compile a second recording of the same
  job and see which rules recur. The machinery exists; the second recordings do
  not.
