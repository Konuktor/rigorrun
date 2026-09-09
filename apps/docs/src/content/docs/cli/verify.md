---
title: rigorrun verify
description: Pin a published MCP server to the bytes the registry served, run it in a container with no network, exercise every tool it safely can, and compare what it did against what it declared.
---

```bash
rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31
```

An MCP server can annotate a tool `readOnlyHint: true`. Nothing checks that, and agents use it to
decide whether a tool may be called without asking you first.

RigorRun fetches the server, pins it to the exact bytes the registry published, runs it in a
container with no network and no access to your machine, calls each tool with arguments derived from
its own schema, and reads the container's filesystem before and after to see what actually changed.
Then it compares that with what the server declared.

No project, no browser, no agent, nothing to configure first. Needs a container runtime, because
every server runs in a container that is thrown away afterwards.

## References

| Form | Pinned by |
| --- | --- |
| `npm:<package>@<version>` | the registry's sha512 |
| `dir:<path>` | `dirhash:sha256:<hex>` |

The prefixes differ so a fixture record can never be mistaken for a registry one.

## Verdicts

| | Meaning |
| --- | --- |
| `CONFORMS` | The declaration held, as far as this harness could observe. |
| `CONTRADICTED` | The server did something its own declaration says it does not. |
| `UNDETERMINED` | Not enough was established to say either way. Never collapsed into "no". |

A contradiction is flagged **permission-relevant** when it widens what an agent may do without
asking — a tool claiming to be read-only and writing is exactly that.

## What it will not claim

Nothing it could not establish is reported as a fact. A tool it could not exercise safely is listed
with the reason, and `untested` is a required field on every record: a record that omits what it
could not reach is not a cleaner record, it is a false one.

Every record also carries the harness's own caveats — that the container daemon runs as root, and
that a state reading which came only from the server's own tools is corroboration rather than proof.

See [the published results](https://rigorrun.xyz/evidence): four servers, 19 of 37 tools exercised,
with the other 18 named.
