# N-1: rigor review before accepting the conclusions

This review uses the six dimensions of the `rigor-reviewer` skill. That skill is written for a research artifact with claim and experiment files, which N-1 does not have, so the dimensions are applied directly to N-1's three claims and their evidence rather than to that artifact structure. It was written after every result was in, and it changes none of them.

## The claims under review

- **C1.** After the fix, RigorRun does not pass EH-WT-03, and it fails it for the reason the evidence shows: the demonstrated +1, and an observed +2.
- **C2.** The fix generalises within Worktide's time reports: on a set frozen before its first run, no known-good case fails and no known-bad case passes, in both gated blocks.
- **C3.** The fix introduces no regression in what was re-measured: the full test suite, the in-process held-out set, and the frozen labels.

## Scores

| Dimension | Score | Why |
| --- | --- | --- |
| D1 Evidence relevance | 4 | See the notes below. |
| D2 Falsifiability | 4 | The v2 gate was written, committed and hashed before any case ran, and names its failure condition (a known-good FAIL or a known-bad PASS). The limit probes predict their own blind-spot outcome in advance, so what they claim can also fail. Weaker: C1's "for the right reason" is checked by reading the recorded message, not by a separate criterion. |
| D3 Scope calibration | 4 | Claims are limited to Worktide `time.report` at the pinned commits; blind spots are disclosed as probes, not hidden. C3 is scoped to what was re-run. The scope gap that remains is F02. |
| D4 Argument coherence | 4 | The chain holds: reproduction, then a root cause confirmed in code, then a design, then failing tests, then the fix, then external runs, then the frozen set. Each amendment is tied to the run that exposed it. Minor: `before-after.md` still carries the pre-fix N-1 risk bullet (kept, marked as pre-N-1), next to the new section. |
| D5 Exploration integrity | 4 | Failures are documented specifically: per-entry pairing misleading by position, a false abstain on a preparatory-call value, a missing creation check, a host-starved run kept rather than dropped, a runner bug that overwrote the oracle verdict (fixed and rebuilt from evidence), and a browser cache lost from the host. |
| D6 Methodological rigor | 3 | See the notes below. |

Mean 3.83. By the skill's mapping (a mean of at least 3.8, and no dimension below 2) that is **Accept**, with the major findings below stated alongside every conclusion.

**D1, evidence relevance.**
- **C1:** supported by three independent real-stack runs at the final product sources, and by a hash-exact in-process replay of the frozen run.
- **C2:** tested on varied conditions — a report grouped by user, a non-zero starting total, a two-minute job, wrong-group and extra-group behaviour through a side channel — with truth judged by an oracle that never uses the MCP.
- **C3:** supported by suite and in-process re-runs.
- **Weak point:** C2 rests on one run per case, and on one target.

**D6, methodological rigor.**
- **Strengths:**
  - pre-registration by hash and commit;
  - an oracle independent of the MCP;
  - the tests were recorded failing before each fix;
  - the known-good controls on every journey pass.
- **Weaknesses:**
  - one run per v2 case, so no variance is measured;
  - the set's author also designed the fix;
  - the frozen real-server benchmark was not re-run at the N-1 commit.

## Findings

| ID | Dimension | Severity | Observation | Suggestion |
| --- | --- | --- | --- | --- |
| F01 | D6 | major | The v2 set was designed by the agent that designed the fix. V2-S-02 is what exposed the creation gap that amendment 3 closed before the freeze (`heldout-worktide-v2/RUN-NOTES.md`). The freeze prevents editing after results; it does not make case selection independent. | Treat V2-S-02 as weaker evidence. Before relying on N-1 for new targets, have a set written by someone else, or generated from a template, without access to the fix. |
| F02 | D3 | major | `after-results.json`, and the release gate's R1, FP and INJECTED gates, measure product sources that predate N-1. N-1 changes identity induction for every induced schema, and the GreenMail inbox header was keyed by a changing `count`. | Re-run the frozen RigorRun-mode sqlite and email cases (Layer B) at the N-1 commit before quoting those numbers as current, and before popular MCP audits. |
| F03 | D6 | minor | Each v2 case ran once. The outcomes depend on timing: a timer is measured in whole minutes. | Repeat the v2 set at least three times, or report per-case agreement across runs. |
| F04 | D3 | minor | Two classes of false negative are inherent to reports of totals: a split contribution (V2-L-01), and a grouping that cannot see the difference (V2-L-02). Both passed, as predicted. | Recommend nominating a read that lists entries whenever the job is "exactly one entry"; the aggregate alone cannot prove it. |
| F05 | D3 | minor | "minutes" appears in five production doc comments as an example. It is not behaviour, and the target-specific scan passes. | Replace it with a neutral example in a later commit, then re-run the suite. It was not changed mid-measurement. |
| F06 | D6 | suggestion | The first EH-WT-03 measurement lost a run to host memory exhaustion. | Gate a run on memory headroom automatically (`resume-cases.sh` does this for the local-model cases). |

## Questions a reviewer would ask

1. Would a set written without knowledge of the fix, for example with the email-mcp or sqlite journeys changing records, still show zero known-bad passes?
2. Do the frozen RigorRun-mode email and sqlite cases keep their AFTER-2 outcomes at the N-1 commit?
3. How often does a correct but slow agent on a timing-sensitive job fail `state_change`, compared with the demonstration?
