# TTFRV — Time To First Verification Record

**TTFRV is a human measurement.** It is the wall-clock time from a person deciding to try
RigorRun to that person holding their first verification record.

## The rule this document exists to enforce

**Machine execution time is never reported as human time.**

This is not pedantry. `docs/AUDIT_REMEDIATION_0.1.1.md:154-168` records that 0.1.0 shipped
"in ten minutes" across the README, the getting-started guide and the site — a
quantitative onboarding claim that had never been measured on an independent human. It was
removed in 0.1.1 rather than defended. Re-introducing it from a stopwatch on a script
would be the same defect wearing a number.

Both quantities are recorded. They are recorded separately, under different names, and the
machine number never appears in a sentence about onboarding.

| Name | What it measures | How |
|---|---|---|
| **Human TTFRV** | Person decides to try → person has a record | Manual stopwatch, protocol below |
| **Machine runtime** | Process start → record written | Instrumented, printed by the CLI |

PRD §27.4 targets a **median human TTFRV under 10 minutes** for v2, against an
unmeasured v1. `docs/THIRD_PARTY_DOGFOOD.md:213-218` set 30 minutes for the v1 flow and
explains the gap in exactly these terms: *"Ten minutes is what the machinery takes; a
person has to read, decide… Claiming ten before measuring a human is how a product ends up
with an onboarding number nobody can reproduce."*

---

## Manual stopwatch protocol — human TTFRV

### Subject

Someone who has **not** seen this repository. Not the author. Not someone who has watched
a demo. The measurement is worthless taken on anyone who already knows the answer.

Record: how they were recruited, their role, whether they had used MCP before, and their
operating system. A number without its subject is not a measurement.

### Setup

- A machine that has never run RigorRun. Fresh `HOME`, or a fresh container/VM.
- A container runtime installed (see [SANDBOX_MODEL.md](SANDBOX_MODEL.md) — if it must be
  installed during the session, that time **counts**).
- Network access.
- No screen share, no hints, no answering questions during the run. Questions asked are
  data; write them down and answer nothing until the clock stops.

### What the subject is given

One sentence, and nothing else:

> Find out what the tools in this MCP server actually do:
> `@modelcontextprotocol/server-memory@2026.8.31`

They are not given a command, a URL, or the README. Discovery time is part of TTFRV.

### The clock

**START** when the subject has read that sentence and begins working.

**STOP** when the subject can point at a verification record and say what it tells them
about the server. Not when the process exits — when they have the answer. A record they
have not understood is not a first value.

**Do not stop the clock for:** reading documentation · installing a container runtime ·
pulling a base image · reading errors · asking a question · getting it wrong once.
All of that is onboarding.

**Do stop the clock for** anything unrelated that interrupts the session, and record it.

### Recorded per run

| Field | Notes |
|---|---|
| Subject id | anonymous, e.g. `S1` |
| Date, OS, container runtime | as found |
| Prior MCP experience | yes / no |
| **Human TTFRV** | mm:ss, or `DID NOT REACH` |
| Machine runtime | from the CLI, separately |
| First command tried | verbatim |
| Wrong turns | each one, verbatim |
| Questions asked | verbatim; each is a documentation defect |
| Where they gave up | if they did |

**A subject who does not reach a record is recorded as `DID NOT REACH` and is included in
the denominator.** Dropping failed runs is how a median becomes a lie.

### Reporting

Report the **median** over at least three subjects, with n and the range. Fewer than three
subjects is reported as individual runs, never as a median.

**Until at least one human run has been recorded, every document states:**

```
HUMAN TTFRV: UNMEASURED
```

Not an estimate. Not a machine number relabelled. Not "approximately".

---

## Machine runtime

Instrumented, and useful for catching regressions in the harness — not for onboarding
claims.

Existing v1 machinery, reused rather than rebuilt:

- `packages/daemon/src/activation.ts:146` — `humanMsToFirstVerdict`
- `packages/cli/src/project.ts:299` — prints `Time to first verdict: X.Xs`
- `packages/daemon/test/freshUser.test.ts:250-256` — prints it in the fresh-user test

For v2, `rigorrun verify` records its own phase breakdown in the verification record, so a
slow run can be attributed rather than guessed at:

| Phase | Measures |
|---|---|
| `resolve` | registry lookup and digest pinning |
| `fetch` | tarball download and integrity verification |
| `stage` | dependency install on the host, scripts disabled |
| `image` | base image pull (first run only) and image build |
| `launch` | container start to MCP `initialize` complete |
| `exercise` | all tool cases |
| `record` | serialization and write |

Report machine runtime as a range across the targets measured, and always name the target
and whether the base image was already present — a first run that pulls a base image is
not comparable to one that does not.

---

## Current measurements

### Human TTFRV

```
HUMAN TTFRV: UNMEASURED
```

No human run has been conducted. No number is available, and none is estimated.

### Machine runtime

Recorded per target as the vertical slice runs; see `STATUS_V2.md` for current figures and
the conditions they were taken under.
