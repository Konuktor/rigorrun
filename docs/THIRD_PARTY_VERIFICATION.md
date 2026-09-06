# Verifying servers we did not write

Fixtures we authored do not count as validation. This page records what the
harness did against real, published, third-party MCP servers, including where it
came up short.

**Measured 6 September 2026**, on Docker 28.5.2 (rootful), with no credentials,
no network egress, and one disposable container per tool.

## Results

| Server | Tools | Exercised | Contradicted | Untested | Isolation | Read-only held |
|---|---|---|---|---|---|---|
| `@modelcontextprotocol/server-memory@2026.8.31` | 9 | 5 | 0 | 4 | `RESET` | yes |
| `@modelcontextprotocol/server-filesystem@2026.8.31` | 14 | 2 | 0 | 12 | `RESET` | yes |
| `@modelcontextprotocol/server-everything@2026.8.31` | 13 | 11 | 0 | 2 | `RESET` | yes |
| `@modelcontextprotocol/server-sequential-thinking@2026.8.31` | 1 | 1 | 0 | 0 | `RESET` | yes |

**37 tools discovered · 19 exercised · 18 not.**

Every one launched. Every one reached `initialize` and `tools/list`. Every one
reset cleanly, proven by comparing two independent container starts rather than
by trusting a configuration flag.

## The honest denominator

**19 of 37 tools, or 51%, were exercised.** The rest are named, with reasons,
in each record's mandatory `untested` array.

`server-filesystem` is the interesting one: 2 of 14. Nine of its tools want a
real path, and the argument planner will not generate a string containing a
path separator — not because it could not, but because a generated path is
exactly the shape that turns a benign call into a traversal. So those tools come
back `NEEDS_FIXTURE`, discovered by attempting them rather than guessed from
their schemas. Three more are declared destructive and are believed.

That is the shape of the answer, and it is worth stating plainly rather than
tuning away: **a general harness with no credentials and no fixtures verifies
about half of a typical server's surface.** A fabricated 100% would be worth
less than a measured 51% with the remainder itemised.

## What it found

`server-everything` declares `readOnlyHint: false` on two toggle tools that
change only in-process state. RigorRun reports those `UNDETERMINED`, not
`CONTRADICTED` — its strongest surface is complete over durable state and blind
to a process's memory, so "declares it writes, nothing durable changed" is a
question it cannot settle. That run therefore **exits 3**, not 0: two
undetermined findings against a default threshold of zero. Exit 3 is the whole
reason that code exists — the verification ran, and did not establish enough to
be worth much.

That was not the original behaviour. The first version called it a MINOR
contradiction, which was a finding manufactured out of a limitation. It was
harmless in direction — nobody was accused of a permission problem — but a
verifier that invents findings in the safe direction will eventually invent one
in the other, so the rule changed. The measurement above is from after the fix.

No third-party server tested contradicted a `readOnlyHint: true` or a
`destructiveHint: false`. **That is a result about four servers, not about the
population.** Four servers from one publisher, all well maintained, is the
weakest possible sample and is reported as such.

The contradiction the harness *can* catch is demonstrated on a fixture written
to contain one — see `fixtures/external/mcp-attested-lookup`, and
[VERIFY_SERVER.md](VERIFY_SERVER.md).

## What this does not establish

- **Nothing about the 18,000-server population.** Four servers, one publisher.
- **No security claim about any of them.** A server that contradicted nothing
  here contradicted nothing *that this harness can observe*, on the tools it
  was able to exercise, at one digest, on one day.
- **No claim that unexercised tools are safe.** They are unexercised.
- **No market validation of any kind.** Per PRD §32, our own scan does not count.

## Reproducing

```bash
rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31
```

Each record names its digest, the base image digest, the literal container argv,
and the reset proof. Two runs against the same digest with the same seed differ
only in timestamps and the record id.
