---
title: Connect an MCP server
description: Connect a stdio or streamable-HTTP MCP server, nominate the tools RigorRun may use to check what happened, and handle OAuth.
---

If you already run an MCP server for Claude, Cursor or anything else, that is the one.

## On this machine (stdio)

RigorRun runs the command directly rather than through a shell, so nothing you type is interpreted
as shell syntax.

- **Command** — just the program, no arguments. For example `npx`.
- **Arguments** — one per line; everything you would type after the command.

## Somewhere else (streamable HTTP)

A private address is fine. RigorRun runs on your machine, so anything this machine can reach, it can
reach.

Authentication is either a credential you already hold, sent as a header, or OAuth. Signing in opens
your browser once; the tokens go into this machine's credential store with everything else, and
never into the project file. A second connection opens no browser.

### Upgrading an existing OAuth connection to 0.6.1

This release requires MCP SDK 1.32.1 or newer. OAuth credentials saved by an older
SDK may not record their authorization server (`issuer`). RigorRun does not guess
that issuer from the MCP server's current metadata. On the next connection it
discards an unbound OAuth session for that server only and asks you to sign in
again. Other servers and non-OAuth credentials are unchanged.

Use **Reconnect**, then complete the sign-in for a server you trust. Headless
sessions print the sign-in URL; open it in a browser on the machine running
RigorRun. Newly saved client information and tokens retain their issuer. If the
authorization server changes, credentials bound to the old issuer are not sent
to the new authorization server; a new sign-in is required.

This does not establish that earlier credentials were compromised. If you
previously connected an OAuth client to an untrusted or compromised MCP server,
revoke its tokens and rotate any affected client secret with your identity
provider, as described in the
[SDK security advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h).

## Two questions RigorRun has to ask

Neither can be worked out from the outside.

**Which tools only look.** Your server can annotate a tool `readOnlyHint: true`, and RigorRun shows
you when it does — labelled as the *server's claim*. It will not enforce against it. An annotation
is a claim by the software being tested, and treating it as a permission is exactly the failure
[`rigorrun verify`](/cli/verify/) exists to find.

**Which tools check what happened.** After your agent finishes, RigorRun calls these to see what
really changed. Without at least one, there is no verdict worth having, and RigorRun says so rather
than producing one.

## A reset

If one tool puts the system back, nominate it. RigorRun calls it before every case so each starts
from the same place. Note that a nominated reset gives [`DECLARED` isolation](/concepts/isolation/),
not `RESET` — RigorRun has not run it twice and compared.

## When the session drops

The stdio connector is a child process, so it does not survive a runner restart. The project shows
**not connected** with a **Reconnect** button; nothing is lost.
