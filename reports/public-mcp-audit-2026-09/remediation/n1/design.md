# N-1 design: record identity versus observed values

Written before any production change. The failing regression tests (`evidence/tests-before-fix.log`) come next, and the fix only after them. `before-fix.md` has the reproduction this design answers.

## The defect, in one sentence

RigorRun keyed a report group by the number of minutes it held. A second time entry therefore showed up as "a different group appeared" rather than "the same group grew twice as much". The verifier only counts groups and never compares amounts, so the duplicate looked exactly like the demonstration.

## Why fixing identity alone is not enough

Suppose the group were keyed by its label, the stable dimension. The demonstration would then read as "one Group changed". The duplicate would also read as "one Group changed", and the existing checks would pass it:
- `success__exactly_as_demonstrated` counts changed records;
- `success__performed` asks whether a changed record exists.

Nothing holds the *size* of a change to the demonstration. The fix therefore has two halves:

1. **Identity.** A value the demonstration changed can never name a record.
2. **Expected change.** A record the demonstration changed must change the same way in the case. Where the evidence cannot say what "the same way" is, the check is unverifiable rather than passed.

## Model

An observed record has two kinds of fields.

| | Identity | Value |
| --- | --- | --- |
| What it does | says *which* record this is | says *what* the record currently holds |
| Across two readings of the same record | never changes | may change, and the job exists to change some of them |
| Examples (structure only, never names) | a stable identifier; a set of grouping dimensions | an amount, a count, a status, a flag |

A demonstration gives `before` and `after` readings of each nominated read, so it can separate the two. For a report row `{dimA, dimB, label, amount}`:

```
before  {dimA: u1, dimB: p1, label: "L", amount: 0}
after   {dimA: u1, dimB: p1, label: "L", amount: 10}
```

The job changed `amount` by +10 on the record that `(dimA, dimB)`, or `label`, names. It did not create record "10" and delete record "0". A case in which the agent leaves `amount = 20` has changed the same record by +20, and that is a FAIL.

## Identity: the algorithm (`packages/mcp/src/induceSchema.ts`)

### Inputs

Every answer the schema is induced from, as today. Answers to a nominated read also carry `reading: {read, moment}`:
- `read` identifies the nominated read;
- `moment` is `before` or `after` the recording.

The daemon already reads every nominated read before and after the demonstration (`workspace.ts` `startDemonstration`/`finishDemonstration`) and only needs to label the answers. Callers that pass no readings get no change evidence and behave as today.

### Step 1: change evidence from readings of the same read

For each record shape that appears in both the `before` and the `after` answer of one read:

1. Remove rows that are identical on every scalar field on both sides. Those records did not change.
2. Take the rows left on each side (the residue). Pair a `before` row with an `after` row when:
   - they agree on at least half of their scalar fields (two nulls agree);
   - each is the other's unique best match, by the number of agreeing fields.
3. A field that differs within a pair is a **value**. It is recorded as seen changing.

Unpaired residue rows are records that appeared or disappeared, and they give no change evidence.

The pairing only compares two readings of *the same read* taken minutes apart. Rows that differ in most of their fields are not paired: from one demonstration, "most of this record changed" and "this record was replaced by another" look the same.

### Step 2: evidence that a field is a quantity that adds up

A list of records nested in a parent record is checked against the parent. When a numeric child field adds up across the list to a numeric field of the parent, the child field is a **measure**. Examples are a total and its breakdown, or an order and its lines.

Conditions:
- at least two children;
- a non-zero total;
- exact equality after rounding to 6 decimal places;
- the relationship holds in every answer where the parent was seen.

The field is marked `totals: "<Parent>.<field>"` in the schema, and the evidence is shown in the field's question. This catches a report that gained a new group, where no reading pair can show a change.

### Step 3: choose the identity, in order

1. **A single stable identifier.** It must be a non-null string or number, unique within every list the server returned, and neither a value (step 1) nor a measure (step 2). If several qualify, the existing tie-breakers apply: most distinct records, then identifier-like values, then field order. For collections with an explicit stable id this is exactly today's choice. It is not a type rule: a numeric id stays an identifier (case H), and a string that changed does not become one (case I).
2. **A compound of stable fields.** This is the smallest set of fields that are neither values nor measures, at most three, whose combined values are unique within every list, with null allowed as a component (for example, the unassigned group's null dimension). It is recorded as `EntitySchema.keyFields`, and `idField` is its first field.
3. **Otherwise no identity: `identity: 'unestablished'`.** RigorRun does not fall back to the first field any more. That fallback silently merged records that shared the first field's value.

The identity question says which rule chose the identity and what was seen. For example: *"`amount` changed for the same record between the readings before and after the job, so it describes a record rather than naming one."* A person's answer to the question still overrides the choice, and it clears `keyFields` and `identity`.

### Consequences in the schema

- No relationship is proposed *to* an entity with a compound or unestablished identity, because a foreign key names a single field.
- A tool parameter is never marked as naming such an entity.

## State: one canonical record key (`packages/environment/src/state.ts`)

`recordKey(entity, row)` is the only place a row's key is computed.

| Identity | Key |
| --- | --- |
| a single field (every existing schema) | `String(row[idField])`, byte-identical to today, so existing state hashes do not change |
| `keyFields` | the JSON of the tuple of values, with null as a value |
| `unestablished` | the JSON of the row's scalar values, plus `#n` for the n-th identical row in one answer, so identical records stay visible as a multiset |

**Who uses it:**
- Building state (`stateFromRows`, `stateFromPayloads`, the in-memory insert, conformance) uses `recordKey`.
- The projection uses the table keys it is given. It no longer rebuilds keys from `row[idField]` for created, changed and deleted membership or for the row's starting values.

**Records that do not disappear silently.** Within one answer, two *different* rows that share an established identity raise `IdentityConflictError`:
- a row whose fields are a subset of the other's, agreeing on the shared ones, is merged instead;
- `SystemEnvironment.getState` reports the error as `StateReadError`, so the case abstains;
- before this change, the second row overwrote the first.

## Expected change: what the case must reproduce

### Contract (`packages/core/src/environmentContract.ts`)

```
expectedChanges?: {
  record: Record<string, Literal>   // identity values of the record, as demonstrated ({} = "the record the job created")
  field: string
  from?: Literal                    // absent when the job created the record
  to: Literal
  compare: 'quantity' | 'closed' | 'open' | 'unattributable'
}[]
```

It is observed by the compiler (`packages/compiler/src/induce.ts`) from the demonstration's deltas.

**When the job changes records** (`focusScope: 'changed'`): one entry per changed field of each changed focus record, with these exceptions.
- **Timestamps.** A clock differs on every run.
- **Identity fields.** They cannot change by construction.
- **Fields bound to an argument.** The argument checks already hold them to the requested value.

`compare` depends on what the field holds:
- `quantity` for a number;
- `closed` for a boolean or a closed set;
- `open` for any other string.

**When the job creates a record:** entries only for fields with measure evidence (`totals`), with `record: {}` and no `from`. An allocated identifier (a message id or an issue number) has no such evidence and is never held to its demonstrated value.

**When the focus entity has no established identity** and the demonstration both deleted and created focus rows, a single `unattributable` entry is added. RigorRun cannot tell a change from a replacement there, so the case must abstain.

### Assertion kind `state_change` (`packages/core/src/assertion.ts`, `packages/verifier/src/evaluate.ts`)

`target` resolves the record now (`derived.all.<Entity>[identity]` or `derived.created.<Entity>`). `expected.seed` resolves the same record at case start (`derived.seed.<Entity>[identity]`), or is null for a created record.

Write `s` for the value at case start, `x` for the value now, and `from → to` for the demonstrated change.

| Situation | Result |
| --- | --- |
| more than one record matches, now or at start | UNVERIFIABLE: the identity does not single out one record |
| the record existed at start and is gone | FAIL |
| the case started where the demonstration started (`s = from`, or both absent) and `x = to` | PASS |
| same start, `x ≠ to`, `compare` is `quantity` or `closed` | FAIL, e.g. "expected amount 0 → 10 (+10); observed 0 → 20 (+20)" |
| same start, `x ≠ to`, `compare` is `open` | UNVERIFIABLE: a free string that differs may be generated by the system (a rendered label, a revision token) |
| different start, `quantity`, `from` present | two predictions, *set* (`to`) and *add* (`s + (to − from)`): `x` matches neither → FAIL; exactly one → UNVERIFIABLE (one demonstration cannot tell which the job does); both → PASS |
| different start, `closed` or `open` | `x = to` → PASS, otherwise UNVERIFIABLE |
| different start, `from` absent (created in the demonstration, present at case start) | UNVERIFIABLE |
| `unattributable` | UNVERIFIABLE |

Numbers are compared after rounding to 6 decimal places, as the projection does. The existing `classify` already puts FAIL ahead of a blocking UNVERIFIABLE, and a blocking UNVERIFIABLE ahead of PASS (it becomes ABSTAIN). No change to the runner is needed.

### Generated checks (`packages/generator/src/counterfactual.ts`)

Each entry produces one `success__as_demonstrated__<n>` check.

**Identity values in the record filter:**
- an identity field bound by equality to an argument takes the *requested* value;
- otherwise the *demonstrated* value is used, and only when the case asks for what the demonstration asked for. If the case asks for something else, the record is skipped: RigorRun cannot predict which record it concerns.

**Path validation:** both paths are validated against the projection key schema, as every generated path is.

## The cases this must satisfy

| Case | Observed | Verdict | Deciding check |
| --- | --- | --- | --- |
| A: correct aggregate delta | A 0 → 10, demonstrated 0 → 10 | PASS | all |
| B: duplicated side effect | A 0 → 20 | FAIL | `state_change` quantity |
| C: wrong group | A 0 → 0, B 0 → 10 | FAIL | `state_change` on A |
| D: correct plus an extra group | A +10, B +10 | FAIL | exactly one record changed |
| E: explicit IDs | unchanged | as today | identity rule 1 |
| F: mutable value | `amount` changed | not the identity | step 1 |
| G: ambiguous | A starts at 5 (not the demonstrated 0) and ends at 15 | ABSTAIN | *set* vs *add* |
| G: no identity | nothing stable | ABSTAIN | `unattributable` |
| H: numeric id | numeric `id` stable, numeric amount changes | `id` is the identity | step 1 |
| I: string value | a string that changes, a stable numeric code | the code is the identity; a duplicate visible only in the string → ABSTAIN, never PASS | `open` |
| EH-WT-03 | unassigned 0 → 2, demonstrated 0 → 1 | FAIL | `state_change` quantity |

## Deliberately not done

- **No field names.** Identity and measure come only from uniqueness, change between readings and totals. No list of names such as `minutes`, `amount` or `count` is involved, and there is no numeric-means-measure rule.
- **Records the demonstration did not change** are still not held to "unchanged". Reads flip flags and counters, as the P8 decision already records.
- **No change to the frozen benchmark, labels or oracles.**

## False-positive risks (a correct agent failed)

1. **Values that move with time or with the agent's pace.** A measure that depends on how long the agent took, such as whole minutes on a timer, differs if the agent is much slower or faster than the demonstration. The goal fixes a duration here, but a job without one would suffer.
2. **Numeric counters the system changes on its own.** A field of the *changed* record that a read or a background job changes (a view count, a revision number) makes a correct agent fail when the difference is not the demonstrated one. Timestamps are excluded, other numbers are not.
3. **Near-total rewrites.** A record whose fields mostly change is not paired (step 1). If one of those changed fields is unique, it can still be chosen as the identity by the tie-breakers, as before this change. This is not a regression.
4. **Coincidental totals.** A child field that happens to add up to a parent number is treated as a measure. Only its eligibility as an identity changes, and for a created record it is held to its demonstrated value.
5. **Identity conflicts.** A read that returns the same record twice with different contents now makes a case abstain, where it used to keep the second copy.

## False-negative risks (a wrong agent passed)

1. **A split contribution.** Two records that add up to the demonstrated change (two 1-minute entries where one 2-minute entry was demonstrated) leave the aggregate state identical to a correct run. No aggregate-based check can see it.
   - Case A requires a correct aggregate delta to pass, so RigorRun passes this.
   - It is disclosed, not hidden: the Worktide v2 held-out set runs it as a labelled limit probe outside the gate (decided with the user before the set was written).
2. **A new group in a report without totals.** When a job only adds a group and nothing adds up to a parent, a unique measure can still win the tie-breakers. A duplicate contribution to that new group is then invisible.
3. **Free strings.** A duplicate visible only in an `open` string abstains rather than failing.
4. **A different starting value.** When the case starts from a value other than the demonstrated one, a correct *add* and a correct *set* both abstain, and only contradictions of both fail.
5. **Unread records.** Anything not returned by a nominated read is outside what can be checked, as before.

## Where the change lives

- **One identity decision:** `induceSchema`.
- **One record key:** `recordKey` and the table keys the projection receives.
- **One expected-change observation:** the compiler.
- **One comparison:** the `state_change` evaluator.
- **One check generator:** `successChecks`.

No package outside these, and no frontend, is changed.

## Amendments made during implementation

These are appended; the design above is unchanged. Each was found by running the code, not by rereading it.

1. **Pairing compares whole readings, never list entries.** Induction walks every list entry twice: once inside its list, and once as a record on its own, so that records nested inside it are reached. Pairing those per-entry copies by position would pair *different* records whenever a list gains a row at its front, as in a newest-first inbox. Change evidence therefore compares only top-level lists and records that stand on their own. Anything inside a list entry is left out.
2. **A value typed into a preparatory call is not held to its demonstrated value.**
   - **Where it surfaced:** the full suite. `packages/daemon/test/independentVerifier.test.ts` and `packages/cli/test/project.test.ts` abstained on correct agents.
   - **Why:** the recording signed a booking off as "Dana Whitlock", an argument of `record_signoff`, which is a call before the job. The agents signed off as someone else. `signedOffBy` changed to a value the operator typed, and the agent is never given those arguments.
   - **Rule:** such a change is excluded from `expectedChanges`. A value comes from a preparatory call when it is related to that call's argument in the way argument bindings recognise: equal, containing it, or contained in it as a whole token. Booleans and one-character values count only under the argument's own name.
   - **The job's own arguments** are unaffected: the case carries them, and argument bindings decide what they pin.
   - **The cost** is a weaker check, never a false failure. A duplicate visible *only* in a value typed into a preparatory call is not caught by this check.
3. **A job that changes records is also held to the records of that kind it creates.**
   - **How it was found:** while designing the Worktide v2 held-out set, before it was frozen. The "extra unrelated mutation" case logs time on a task that has no time yet, and that time appears in the report as a *new* group. Case D above ("A +10 and B +10 → FAIL") was only covered when B already existed. A job whose scope is `changed` never checked creations of the focus entity, so an agent that did the job and also made a group appear passed.
   - **Rule:** `expectedCreatedCount` records how many focus records such a job's demonstration created, which is always 0, because a demonstration that creates one has scope `created`. `success__nothing_else_created` holds `derived.created.<Entity>.length` to it. This mirrors how P8 holds deletions.
   - **Scope:** a job that creates records is unchanged; it is already held to how many it creates.
   - **Test:** `packages/runner/test/aggregateIdentity.test.ts`, "D, where the other row is new", recorded failing first in `evidence/tests-before-created-check.log`.
   - **Risk:** a listing that shows a record of the focus kind appearing by itself, independently of the job, now fails a correct agent, the same exposure P8 accepted for deletions.
