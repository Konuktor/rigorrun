# Testing an agent that already speaks MCP

This is the adoption path that costs you nothing. An agent built for Claude, or
Cursor, or anything else that speaks MCP does not need a RigorRun SDK, a
rewrite, or to be reshaped into a step function. It needs an endpoint.

## How it works

```
your agent  ──MCP──▶  RigorRun proxy  ──MCP──▶  your system
                            │
                            └── records every call, and the case's limits
```

For each case, RigorRun publishes a session at:

```
http://127.0.0.1:<port>/mcp/<32 hex characters>
```

Your agent connects, calls `tools/list`, does the work, and disconnects. Then
RigorRun reads your system to find out what actually happened.

## What the proxy is not

It grants no new powers. A session is a transport onto the *same* bounded
channel an in-process agent gets:

- the same step budget — the third call with a budget of two is refused;
- the same allowed-tool list, taken from the case, so a tool the case did not
  offer is refused at the proxy and recorded;
- the same production write guard;
- the same recorded steps and evidence.

An agent cannot reach further by arriving over HTTP than by being imported.

Refusals are passed back as refusals rather than softened into something that
reads like success. How an agent behaves when a system says no is most of what
is being measured.

## What the proxy will not show your agent

`tools/list` is built from the public half of the case. The assertions your
agent is judged against never travel through the proxy, so they cannot be
discovered by asking the thing your agent is talking to.

## Lifetime and access

A session id carries 128 bits of randomness, because it is the only thing
between another process on your machine and a live channel into your system.
The endpoint stops existing the moment the case ends — an endpoint that outlived
its case would be a way to touch your system with nobody watching.

The proxy listens on loopback only, checks the `Host` header (a page can resolve
an attacker's domain to 127.0.0.1, but it cannot change the header it sends),
and answers a made-up session exactly as it answers a revoked one, so probing
cannot tell a live session from a dead one.

## Using it from an MCP host

The endpoint is an ordinary streamable-HTTP MCP server, so any compliant client
can connect to it. The exact configuration format differs between hosts and
changes; RigorRun deliberately does not print a snippet claiming to be
`claude_desktop_config.json` or any other named host's format, because a
configuration file that does not work is worse than none.

Point your client at the URL RigorRun shows, the way that client documents.
