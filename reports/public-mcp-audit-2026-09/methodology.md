# Methodology

This audit asks one question: **can RigorRun find real, reproducible failures in
external, state-changing MCP workflows?** Everything below exists to make the
answer checkable by somebody who was not here.

## What was tested, and with what

| Layer | Implementation | How it was pinned |
| --- | --- | --- |
| RigorRun | repository sources, run with `pnpm rigorrun` (tsx) | commit and version in `evidence/environment.md` |
| Targets | three third-party MCP servers, unmodified | upstream commit SHAs in `evidence/environment.md`; clones under `tmp/rigorrun-audit/` (git-ignored) |
| Oracles | scripts in `scripts/oracle-*.py` that read each system **outside** the MCP process | MailHog HTTP API; GreenMail IMAPS; SQLite opened read-only from a separate process; Worktide REST plus a direct MySQL query |

No upstream source was modified. No RigorRun source was modified. Nothing left
this machine: every mail sink, database and API ran in a local container or a
local file created for the audit.

## The product path, driven headlessly

RigorRun 0.2.0 sets a project up in its browser interface only; there is no
CLI for connecting a system or teaching a job (`docs/V1_GAP_AUDIT.md` records
this as MISSING). The interface is a client of the runner's loopback HTTP API,
so `scripts/journey.mjs` starts the runner, redeems the one-time pairing code
for the session cookie, and calls the same `/api/projects/…` routes in the same
order the interface does: create project → connect the MCP server → mark
read-only tools and nominate verifier reads → teach the job by calling tools →
answer the schema questions (the proposed answer is accepted unless a spec
overrides it) → compile → decide every proposed rule (confirm what the spec
names, reject the rest, record both) → generate the suite → run RigorRun's own
suite-quality check → register agents. Running and gating then use the real
CLI: `rigorrun run --project <id> --agent <name> --home <dir>`. Every request
and response is kept in `traces/<target>/<journey>-setup/api-log.json`.

## Ground truth before any run

Every case is a JSON file under `cases/<target>/` written **before** it runs. It
names the intent, the initial state, the allowed and forbidden actions, the
expected final state, the oracle, the truth label (`EXPECTED_PASS` or
`EXPECTED_FAIL` for the *behaviour under test*), and `expect`: a mechanical
predicate over the before and after oracle snapshots. Nobody eyeballs truth.

`scripts/run-cases.py` executes a case as: reset → before snapshot → action →
after snapshot → evaluate `expect` → read RigorRun's verdict from the run file
it wrote → classify. Every attempt leaves `before.json`, `after.json`,
`attempt.json` and, for RigorRun runs, the full `rigorrun-run.json` under
`evidence/<target>/<case>/attempt-N/`.

Three action modes exist, and each case states which it used:

- `rigorrun` — the action is a RigorRun run of a registered agent. This is the
  mode that measures RigorRun.
- `direct` — the action is a list of MCP tool calls made with
  `scripts/mcp-call.py`, a 70-line stdio client. Used only where RigorRun
  cannot host the case (the reason is on the case), and never scored as a
  RigorRun verdict.
- `shell` — an arbitrary command (restart and persistence cases).

## Agents

Agent behaviour is the thing under test in the agent-level cases, so it is
scripted and known in advance. `scripts/agents/scripted-agent.py` is a process
agent in RigorRun's `rigorrun/agent/2` protocol that executes a playbook
(`scripts/playbooks/*.json`) through the per-case MCP endpoint RigorRun hands
it: `correct`, `duplicate`, `wrong-entity`, `wrong-value`, `missing-action`
(with a false success claim), `forbidden-extra`, and `retry-after-lost-response`.

One real model was also run per reachable workflow: `scripts/agents/ollama-agent.py`
is the same protocol with an ordinary tool-calling loop against a local Ollama
model through its OpenAI-compatible endpoint. RigorRun ships no Anthropic
provider and no paid key was used; the model is whatever fitted RigorRun's
fixed 15-second case budget on this machine (see findings).

## Injected faults

`scripts/fault-proxy.mjs` is a stdio JSON-RPC pass-through placed between
RigorRun (or the direct client) and the unmodified server. It forwards every
message and, when armed, swallows the server's response to the Nth call of one
named tool. The server still executed the call; the client sees a timeout.
Every case that uses it carries `"injected": true` and the label INJECTED
FAULT, and nothing observed under it is reported as an upstream bug. The proxy's
own log (`traces/*/fault-proxy*.jsonl`) shows exactly which response was
dropped.

## Scoring RigorRun

For every `rigorrun`-mode attempt two verdicts exist: the oracle's
(`expectedStateHeld`) and RigorRun's (`taskSuccess ∧ policyCompliant ∧ no
unsafe actions` on the run file). They combine as:

| Oracle says the state is | RigorRun says | Class |
| --- | --- | --- |
| wrong | FAIL | TRUE_POSITIVE |
| wrong | PASS | FALSE_NEGATIVE |
| right | FAIL | FALSE_POSITIVE |
| right | PASS | TRUE_NEGATIVE |

A case RigorRun refused to build or run is `NOT_SCORED` and counted separately
as an abstention, never as a negative. Rates in `results.json` are computed by
`scripts/aggregate-results.mjs` from the attempt files, and `--check` fails if
any number quoted in the markdown differs from the JSON.

## Confirmation rule

After all reports were written, every confirmed case was run once more from a
clean reset into `evidence/final-pass/`; each reproduced the recorded verdict.

A finding is reported as confirmed only when it reproduced from a clean reset
in three of three attempts, the independent oracle shows it, the expected
behaviour follows from the target's documentation or an obvious operating
contract, and the cause was located in source. Anything short of that is
labelled FLAKY / NEEDS INVESTIGATION or not reported.

## Two deviations, stated

1. **A GreenMail supplement for email-mcp.** The brief asked for MailHog or
   Mailpit only. Against MailHog the audit found, and confirmed, that the
   upstream server's only local inbox reads crash (finding E-1), which left
   RigorRun with no records-returning read and it correctly refused to compile
   a suite. To still measure RigorRun on email semantics, the upstream server
   was pointed, unmodified, at a local GreenMail fake IMAP/SMTP container
   through a 40-line loopback STARTTLS relay (`scripts/starttls-relay.py`),
   because the server always negotiates STARTTLS and GreenMail's plain port
   does not offer it. Cases on that track are named `EM-GM-*` and the oracle
   reads GreenMail over IMAPS directly. No real mailbox was involved.
2. **Docker-built Rust binary.** The host has no Rust toolchain, so
   mcp-server-sqlite was built and its upstream tests run inside a
   `rust:1-bookworm` container; the resulting Linux binary was used on the host.

## Housekeeping that touched this machine

Disk filled during the Rust build; the Docker build cache and stopped
containers were pruned (`docker builder prune -af`, `docker container prune -f`)
and the Rust registry cache deleted. No image, volume or running container was
removed.
