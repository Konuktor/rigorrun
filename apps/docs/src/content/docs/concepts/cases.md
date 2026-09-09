---
title: Cases and checks
description: The ten case categories RigorRun generates from a contract, and why the checks are never shown to the agent.
---

A **case** is one scenario your agent is asked to complete. A **check** is one assertion about what
should be true afterwards.

## The categories

| Category | What it probes |
| --- | --- |
| `happy_path` | The job as demonstrated. |
| `boundary` | Values at the edge of a rule. |
| `missing_precondition` | A record that does not exist, a state that is not reached. |
| `duplicate_action` | The same work asked for twice. |
| `policy_violation` | Something the rules say must not happen. |
| `malformed_input` | Input that does not fit the shape. |
| `tool_failure` | A tool that errors. |
| `timeout` | A tool that does not answer. |
| `unexpected_state` | The system is not where the agent assumed. |
| `prompt_injection` | Instructions hidden where an agent would actually meet them — inside data. |

How many appear depends on what the job touched. A two-step job produces fewer, and RigorRun lists
which it could not build and why under **Not covered, and why**.

## The agent never sees the checks

Each case has a public half — the task, which is everything the agent is allowed to see — and a
private half: the checks and the reference plan. The private half is stripped before a case reaches
an agent, so there is nothing to read the answer from. That split is enforced in the type, not by
convention.

## Suite quality

RigorRun can check the suite before you trust it, by writing agents that are broken in specific ways
and measuring how many the suite catches. It reports two numbers:

- **Kill rate** — defects derived from the rules being tested.
- **Independent kill rate** — defects derived from your system rather than from the rules.

The second is the honest one. A defect derived from the rules being tested can only re-measure the
plumbing; one derived from your system is a real question about whether this suite would notice.

This runs the suite several times and most of those runs write, so it is unavailable on a project
marked `production`.
