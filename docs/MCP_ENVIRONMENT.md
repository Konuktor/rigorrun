# Connecting an MCP server

RigorRun connects to a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio or streamable HTTP, using `@modelcontextprotocol/sdk` 1.30,
protocol `2025-11-25`.

## Local (stdio)

RigorRun runs a command and talks to it over its standard input and output.

| Field | Example |
| --- | --- |
| Command | `npx` |
| Arguments | `-y`<br>`@example/booking-mcp` |
| Credentials | `DESK_TOKEN` |

The command is a binary and an argument list, never one string. RigorRun spawns
it directly, so nothing is interpreted by a shell, and a command containing
shell metacharacters is refused outright. Only configuration you have created
locally can start a process — a benchmark file cannot, and neither can anything
a connected server says. See [SECURITY_MODEL.md](SECURITY_MODEL.md).

The child gets a small allowlist of environment variables plus the credentials
you named, and nothing else from your shell.

## Remote (HTTP)

| Field | Example |
| --- | --- |
| URL | `https://staging.example.com/mcp` |
| Credentials | `DESK_TOKEN` — sent as a header |

Private addresses are allowed, because a staging system is usually on one.
Non-HTTP schemes, credentials embedded in the URL, and the cloud metadata
addresses are refused.

## Credentials

Only the *names* live in the project. The values live in one owner-only file
for this install:

```bash
RIGORRUN_SECRET_VALUE=... rigorrun secrets set DESK_TOKEN
rigorrun secrets list      # names only
```

There is deliberately no command that prints a value back. A project file can
therefore be read, copied or attached to a support request without carrying a
credential — and RigorRun can still tell you exactly which one is missing.

## What discovery gives you

RigorRun calls `tools/list` and shows every tool with its arguments and what it
is likely to do. Arguments it cannot express are listed with a reason rather
than silently dropped, so you can see when a tool takes a nested object RigorRun
cannot yet compare against.

### Annotations are claims, not permissions

A server may annotate a tool `readOnlyHint`, `destructiveHint`, `idempotentHint`
or `openWorldHint`. RigorRun shows you that it did, labelled as the server's
claim, and will not act on it. From the specification, repeated verbatim in the
SDK:

> **NOTE:** all properties in ToolAnnotations are **hints**. They are not
> guaranteed to provide a faithful description of tool behavior. Clients should
> never make tool use decisions based on ToolAnnotations received from
> untrusted servers.

So RigorRun's `read` label carries its source. Only your own decision, or
RigorRun watching state fail to change, makes a tool genuinely read-only. A
tool the server said nothing about is assumed to write, because silence should
buy caution rather than trust.

If a server claims a tool is read-only and RigorRun later sees it change state,
that mismatch is reported. It usually means the server is wrong about its own
implementation, and it is worth knowing before you trust a verdict from it.

## What RigorRun works out, and what it asks

An MCP server publishes operations, not records. RigorRun needs records, fields
and *roles*, because a role is what makes a threshold rule or a
separation-of-duties check possible at all.

It works those out from what your tools hand back, reading structure only —
uniqueness within a returned list, how many distinct values a field holds
across distinct records, whether the same record was ever seen holding two of
them, how many decimal places a number carries, and whether one record's values
are literally another record's identifiers. It never reads a field's *name*,
because a compiler that knows `amount` means money is a compiler with a
business vocabulary in it, and that vocabulary is what stops it working on the
next business.

Structure runs out in three specific places, and there it asks:

- **A unit.** Two decimal places are visible; pounds are not. The unit decides
  what "one more than the limit" means.
- **Whether a string names a person.** Nothing structural separates an
  approver's name from any other text, so the guess is the one that enforces
  nothing.
- **Whether an outsider can write a text field.** No data can answer this, and
  it decides where injection payloads go.

Every question carries the observation that prompted it.

## Nominating reads

At least one tool must be nominated as a way to read the records you care
about. These are called after your agent finishes. A record nobody nominated a
read for cannot be checked, so assertions about it come back inapplicable
rather than passing — see [VERIFICATION.md](VERIFICATION.md).

You nominate the *tools*, not what they return. Which record type each one
gives back is worked out from what comes back, because at the moment you
nominate them those types do not exist yet.

## What a real system costs you

Against an in-memory environment RigorRun can install any starting world it
likes. Against yours it cannot, so:

- Cases are built from situations your system already contains rather than from
  worlds RigorRun constructs. Reset produces a known starting position, and
  cases vary what is asked rather than what is there.
- Anything needing a world that cannot be installed is listed as not testable,
  with the reason, on the benchmark and on every result.

See [ENVIRONMENT_RESET.md](ENVIRONMENT_RESET.md).

## When a system misdescribes itself

A server can annotate a tool `readOnlyHint: true`. RigorRun shows you that it
did, labelled as the server's claim, and does not act on it — a tool nobody has
vouched for counts as writing, whatever it says about itself.

It also checks. When you use a tool during a demonstration that claims to be
read-only, RigorRun reads your system before and after and compares. If
something changed, it says so on the review screen:

> `check_availability` — the server claimed readOnlyHint: true
> state changed after the call

**Nothing about your run changes.** RigorRun already treats that tool as one
that writes. What changes is what you know: a system that misdescribes one tool
may misdescribe others, and you are about to trust what it tells RigorRun about
your agent.

This is not usually anybody being dishonest. The commonest version is an
enquiry counter added for a dashboard six months after the annotation was
written, with nobody revisiting what the tool had claimed.

**The honest limit.** RigorRun can only see a change through the reads you
nominated. A tool that updates something no nominated read returns changes the
system in a way nothing here can observe, and no contradiction is reported —
not because the claim held, but because RigorRun could not tell. That is the
same limit that makes a verdict `PARTIAL` rather than `AUTHORITATIVE`, and it
is worth reading the same way.
