# We tested three real MCP servers with RigorRun. Here is what broke — and it was mostly RigorRun.

*Draft for publication. Every number below is generated from the artefacts in this directory; see `README.md` for how to check them.*

## Why

RigorRun's pitch is that an agent's claim to have done something is worth nothing until the system it touched has been read back. That is easy to demonstrate on a fixture written for the purpose. We wanted to know whether it holds up on servers nobody here wrote, doing real state changes: sending mail, creating tasks and timers, writing rows to a database.

We picked three open-source MCP servers with state-changing tools, an independently inspectable state, and a local deployment story: `sandraschi/email-mcp` (Python, 47 tools, documented MailHog testing), `Worktide-IO/worktide-mcp` (TypeScript, 18 tools against a self-hostable Symfony backend), and `0xOmarA/mcp-server-sqlite` (Rust, 13 tools, fine-grained SQL access control). Nothing left the machine: fake mail sinks, a disposable SQLite file, a local Worktide stack seeded with synthetic data.

## How

The rule that made the audit honest was that RigorRun was never allowed to be its own referee. For every case we wrote the intent, the starting state and the expected final state as a mechanical predicate *before* running it, and judged it with an oracle that reads the system outside the MCP process: MailHog's HTTP API, an IMAP mailbox opened from a separate process, the SQLite file opened read-only, Worktide's REST API cross-checked against its MySQL tables. RigorRun's verdict was then scored against that oracle — true positive, false positive, false negative — case by case.

We drove RigorRun the way a user would, minus the browser: its runner's HTTP API is what the interface calls, so a script called the same routes in the same order (connect, nominate reads, teach the job, answer the questions, decide the rules, build the suite, run the quality check, register agents) and the real CLI ran and gated the suites. Agents were scripted so their behaviour was known in advance — correct, duplicate, wrong entity, wrong value, no action with a false success claim, an extra forbidden action, retry after a lost response — plus one real local model through Ollama. Where a fault had to be injected (a dropped tool response), a 60-line stdio proxy did it, and every such case is labelled INJECTED FAULT.

<!-- n:totals.cases_total -->58<!-- /n --> cases, each run three times from a clean reset.

## What broke upstream

These are organic: nothing was injected, nothing was modified, and each reproduced 3/3.

**email-mcp cannot read its own test inbox.** The project documents MailHog and Mailpit for local testing. Sending works; `check_inbox` and `search_emails` against that service raise a `TypeError`, because a filter parameter was added to the base class and the tool registry but not to the local-service class. Its 220 passing tests never call that path. Separately, thirteen advertised tools — the entire auto-response and watcher feature — fail with `ModuleNotFoundError`: the modules were never committed.

**worktide-mcp cannot change most of what it exposes.** With the base URL its README documents (`…/v1`), every tool that resolves an item and calls it by IRI requests `/v1/v1/…` and gets a 404: get, update, complete, archive. The create-type tools answer 500 against the current backend because they send no workspace or user. Only the timer start/stop tools worked. The MCP has no tests; its `test:tools` script points at a file that does not exist.

**mcp-server-sqlite's `backup` ignores the access-control policy.** The policy is enforced by SQLite's authorizer, which only sees SQL. `backup` uses the online backup API. Under `deny-everything`, or under `read-only --deny Read(tasks.amount)`, a caller can write a complete copy of the database, denied column included, to any path it names. `vacuum`, tested in the same session, is refused. Everything else about the policy engine held: presets, column-level denies, timeouts, single-statement enforcement, and a BEGIN/INSERT/ROLLBACK across three calls that we expected to leak (from reading the pooling code) and that did not. We are disclosing this one privately before publishing details.

**All three are at-least-once.** Drop the response to one send or insert, let the client retry once, and two messages or two rows exist. None of them promises otherwise, so this is a risk to plan for, not a bug — and it is exactly the class of failure a harness like RigorRun should be able to catch.

## What RigorRun detected, and what it missed

Where RigorRun reached a verdict, the numbers were TP <!-- n:totals.true_positives -->10<!-- /n -->, TN <!-- n:totals.true_negatives -->0<!-- /n -->, FP <!-- n:totals.false_positives -->6<!-- /n -->, FN <!-- n:totals.false_negatives -->10<!-- /n -->. Read that as: every correct agent failed, and most wrong ones passed.

One cause. For a real MCP server RigorRun cannot install a starting world, so it records the world at the moment the suite is generated and uses that snapshot as the baseline for "was something created". That snapshot already contains the demonstrated record. An agent that repeats the job exactly therefore creates nothing new and fails; an agent that inserts a different value, a second row, or a row in the wrong table creates something the snapshot lacks and passes. We reproduced it on sqlite, on email, in reset mode and in accumulate mode, and with a real 3B model that did the job right three times out of three and was failed three times out of three.

To its credit, RigorRun's own suite-quality check said so before we ran anything: "1 case(s) no correct implementation can pass", "0/3 injected defects caught". A user who clicks that button is warned. A user who does not is graded by a coin that always lands the same way.

Worktide never got that far. RigorRun's read-nomination probe accepts JSON inside a text block; its demonstration capture keeps only `structuredContent`; the probe said nothing was wrong, the job was demonstrated, and compile refused with "the reads returned text rather than structured records". That result shape is the most common one in the MCP ecosystem.

On MailHog, RigorRun refused correctly, because the only read that could have shown the mail is the one that crashes upstream. That is the product working as designed, and it is also why we needed a fake IMAP server to measure it on email at all.

The lost-response retry — the case we most wanted RigorRun to catch — could not run inside it: generated cases carry a fixed 15-second budget, and RigorRun's own tool-call timeout is 20 seconds, so the case dies before the agent can retry.

## Limitations

Three servers, one machine, one day, pinned commits. RigorRun's bundled demo path was not under test. The Worktide MCP predates its backend by three weeks, so some of its 500s may be drift rather than original defects. The GreenMail track deviates from the MailHog-only brief and is labelled as such throughout. And "verification: PARTIAL, isolation: NONE" is what RigorRun printed on every run it completed — it never claimed more than it had.

## Reproduce it

Clone the four upstream repositories at the commits in `evidence/environment.md`, build them per upstream, and run any case with `python3 scripts/run-cases.py cases/<target>/<case>.json --repeat 3`. The journey scripts, the oracle scripts, the fault proxy, the agents and the aggregator are all in `scripts/`. `node scripts/aggregate-results.mjs --check` fails if any number in this text disagrees with `results.json`.
