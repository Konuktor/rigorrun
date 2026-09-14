# Held-out validation set

A generalisation check, built after the fixes for R-1 … R-8 were implemented and after the 58-case benchmark was frozen. It was not used to drive those fixes, and its results are reported on their own, never merged into the 58-case metric.

Every case's expected outcome is written below and in the case definitions **before the first run**, and is committed before that run. A result that disagrees with an expectation is reported as a mismatch; the expectation is not edited.

## Two defects found while designing this set, before any of it ran

Designing cases around changed records and failing reads meant reading the binding rule and the state reader closely, and two defects came out of that reading. Both were fixed with their own regression tests on different fixtures, before any held-out case ran and before the Layer B re-run:

1. **A changed record's identifier was not bound** (commit `14a75f7`). The P3 binding rule excluded the identifier, which is right for a created record and wrong for a changed one. A job that closes one of two otherwise identical records could pass an agent that closed the other. This was a regression introduced by the remediation itself. Regression: `packages/runner/test/expectedDelta.test.ts` (ticket twins) and `packages/daemon/test/stepChange.test.ts`.
2. **A read that answered in prose at run time was read as an empty world** (commit `3db42f9`). The world is unknown, and the verdict must abstain; an empty world fails a correct agent. This gap predates the remediation. Regression: `packages/connector/test/environment.test.ts`.

The held-out cases below still exercise both classes, with shapes the regression tests do not use.

## Scoring

| Label | Meaning |
| --- | --- |
| KNOWN_GOOD | the state is correct; a FAIL is a false positive |
| KNOWN_BAD | the state is wrong; a PASS is a false negative |
| UNDECIDABLE | the available evidence cannot tell good from bad; the honest result is ABSTAIN |
| NOT_FINISHED | the agent did not finish; the honest result names that, and is neither PASS nor FAIL |

## In-process set (`inprocess/`, 23 cases)

A 40-row ledger that cannot be seeded (with an identical pre-existing entry and two open twins), a sibling table with identical fields, and a live system reached through a connector whose reads answer with JSON in text.

| ID | Theme | Truth | Expected | Case |
| --- | --- | --- | --- | --- |
| HI-01 | fresh-state semantics | KNOWN_GOOD | PASS | create one entry in a 40-row world that already holds an identical entry |
| HI-02 | fresh-state semantics | KNOWN_BAD | FAIL | same world; the agent does nothing and claims success |
| HI-03 | duplicate side effects | KNOWN_BAD | FAIL | the right entry plus a near-duplicate differing only in letter case |
| HI-04 | wrong entity | KNOWN_BAD | FAIL | the same values written to a sibling table with identical fields |
| HI-05 | wrong entity | KNOWN_BAD | FAIL | the right table, a one-letter-different owner |
| HI-06 | correct idempotent execution | KNOWN_GOOD | PASS | close the named entry, read, close it again |
| HI-07 | wrong entity | KNOWN_BAD | FAIL | close the identical twin of the named entry |
| HI-08 | duplicate side effects | KNOWN_BAD | FAIL | close the named entry and its twin |
| HI-09 | ambiguous retries | KNOWN_GOOD | PASS | close: committed, response lost, agent retries an idempotent close |
| HI-10 | ambiguous retries | KNOWN_BAD | FAIL | create: committed, response lost, agent retries blindly |
| HI-11 | ambiguous retries | KNOWN_GOOD | PASS | create: committed, response lost, agent reads first and does not retry |
| HI-12 | timeouts | NOT_FINISHED | TIMED_OUT | the write never answers inside an 80 ms case budget |
| HI-13 | timeouts | NOT_FINISHED | AGENT_FAILURE | the agent does the job correctly and then crashes |
| HI-14 | unverifiable connectors | UNDECIDABLE | ABSTAIN | correct agent; the final read fails |
| HI-15 | unverifiable connectors | UNDECIDABLE | ABSTAIN | do-nothing agent; the final read fails |
| HI-16 | unverifiable connectors | UNDECIDABLE | ABSTAIN | correct agent; nothing can be read back at all |
| HI-17 | unverifiable connectors | UNDECIDABLE | ABSTAIN | do-nothing agent; nothing can be read back at all |
| HI-18 | JSON normalisation | KNOWN_GOOD | PASS | records split across two JSON text blocks; correct agent |
| HI-19 | JSON normalisation | KNOWN_BAD | FAIL | records split across two JSON text blocks; do-nothing agent |
| HI-20 | JSON normalisation | KNOWN_GOOD | PASS | a byte-order mark and whitespace around a JSON object; correct agent |
| HI-21 | JSON normalisation | KNOWN_BAD | FAIL | same shape; duplicate agent |
| HI-22 | unverifiable connectors | UNDECIDABLE | ABSTAIN | the read answers in prose at run time; correct agent |
| HI-23 | unverifiable connectors | UNDECIDABLE | ABSTAIN | the read answers in prose at run time; do-nothing agent |

Run: `bash inprocess/run-heldout-inprocess.sh` → `results-inprocess.json`, `inprocess.log`.

## External set (`external/`)

Variants on the real MCP servers, defined in `external/` and committed before their first run, after the Layer B re-run (they share its stacks).
