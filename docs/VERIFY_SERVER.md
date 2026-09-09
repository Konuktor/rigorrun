# Verifying a server

```bash
rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31
```

No project, no agent, no browser, nothing to configure first. A server
reference is enough.

## What it does

```
resolve → pin the digest → stage → build an image → run it in a container
→ list the tools → call them → read state before and after → compare against
what the server declared → write a record
```

Every one of those happens on your machine. The container has no network, no
access to your filesystem, and no environment variables.

## What comes out

```
npm:@modelcontextprotocol/server-memory@2026.8.31
  resolved   2026.8.31
  digest     sha512-ljj/3S4aGjxdNSQWw6gucKKGnTLdBPWxzapyY/MT2tOVyZwvxChve...
  runtime    docker 28.5.2
  isolation  RESET
  egress     none

Declared, versus what it did
tool              declared                result        verification
----------------  ----------------------  ------------  ------------
read_graph        readOnlyHint: true      CONFORMS      PARTIAL
create_entities   readOnlyHint: false     CONFORMS      PARTIAL
lookup_user       readOnlyHint: true      CONTRADICTED  PARTIAL
```

and, where something is contradicted, the file that proves it:

```
lookup_user — readOnlyHint: true is CONTRADICTED, and that widens what an
agent may do without asking
  the tool declares itself read-only and was observed changing state RigorRun
  read independently of the server.
  wrote /work/target/audit.log
```

The machine-readable record goes to `.rigorrun/records/<id>.json`. `--json`
prints it to stdout and nothing else.

## Why `readOnlyHint` matters more than it looks

It is not documentation. At least one major client uses `readOnlyHint` and
`destructiveHint` to decide whether a tool may run **without asking the
person**. A tool that declares itself read-only and writes is therefore a
permission bypass rather than a stale comment, and the record marks it
`permissionRelevant`.

## The three answers

| | |
|---|---|
| `CONFORMS` | The declaration matched what the tool was observed to do. |
| `CONTRADICTED` | It did not, and RigorRun read the difference independently of the server. |
| `UNDETERMINED` | RigorRun could not establish it either way. |

`UNDETERMINED` is a real answer and is never quietly turned into `CONFORMS`.
It is the answer when nothing readable changed either way, and it is also the
answer when the only thing that noticed a change was the server's own read
tools — because the server that might be misdeclaring a tool is the same server
answering the read. Corroboration, never proof.

## Tools it will not call

Listed in the record's `untested` array, always, with the reason. The field is
required and may be empty but never absent: a record that hides what it could
not reach is a defect, not a cleaner report.

| Reason | Meaning |
|---|---|
| `UNSAFE_TO_EXERCISE` | The server declares the tool destructive. RigorRun believes that, because believing it means doing less. |
| `NEEDS_FIXTURE` | The tool refused generated arguments and nothing changed. It needs a real record to point at. Discovered by trying, not guessed from the schema. |
| `NEEDS_CREDENTIAL` | You said so with `--needs-credential`. Never inferred — there is no honest structural signal for it. |
| `UNDETERMINED` | Its schema does not describe a value RigorRun will invent, such as a string constrained by a regex. |

A `readOnlyHint: true` declaration earns a tool **no** gentler treatment. That
annotation is the thing under test, and relaxing caution because a tool claims
to be safe would mean handling the tools most worth catching the most gently.

## Arguments

Derived from each tool's own input schema: enum values sorted so the choice is
a property of the set, numbers inside declared bounds, arrays with exactly one
element, and inert generated tokens for strings. Every argument's provenance is
in the record's `derivation`, so a reader can see where each value came from.

Nothing generated ever contains a path separator, a wildcard, a leading dash,
`..`, or more than 64 characters. Not escaped — never generated, because
escaping is a bet on somebody else's parser. This is a fixed table, not a
fuzzer: the goal is one safe deterministic exercise per tool.

## Exit codes

```
0  verified, nothing contradicted
1  a declaration was contradicted by observed behaviour
2  the verification could not be run — no runtime, bad reference, build failed
3  it ran, but too little was established to be worth much
```

Code 2 is never produced for a finding about the server, and codes 1 and 3 are
never produced for a problem with RigorRun. `--max-undetermined` and
`--min-exercised` set where 3 begins; `--strict` makes minor contradictions
blocking too.

## References

| Form | Notes |
|---|---|
| `npm:<package>@<version>` | Pinned to the sha512 the registry published for that version, checked before anything unpacks. |
| `npm:<package>` | Resolves `latest` once and then pins the exact version it found. The record keeps both. |
| `dir:<path>` | A server on this machine. Digested over its own bytes, with a visibly different prefix so it cannot be mistaken for a published artifact. |

An OCI image, a git ref and a remote endpoint are planned. They are refused
rather than half-supported, because a reference that half-works produces a
record that looks like the others and means less.

## Requirements and limits

A container runtime. `rigorrun doctor` says whether you have one and whether it
runs rootless.

Read [SANDBOX_MODEL.md](SANDBOX_MODEL.md) before relying on this for anything
that matters. The short version is at the top of that page: **RigorRun does not
claim to prevent a container escape.**
