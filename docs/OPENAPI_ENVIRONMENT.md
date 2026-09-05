# Connecting an HTTP API

RigorRun reaches your system through a connector. MCP was the first; an OpenAPI
document is the second. Everything after the connection — what it learns, the
questions it asks, the suite it builds, how it verifies — is the same code.

## What you need

- **An OpenAPI 3 document** for your system. JSON or YAML.
- **The address the API is actually served from.** Whatever the document's
  `servers` says is a suggestion; RigorRun uses what you type.
- **Somewhere it is safe to change things.** Staging or a scratch instance.

## Connecting

Paste the document. RigorRun keeps it, rather than the URL you got it from, so
opening the project next month does not depend on that URL still being there.

It reads the operations and shows you what it found, exactly as it does for MCP
tools: the arguments, whether each is required, and anything it could not
express — an argument sent in a cookie, a body that is not JSON. An argument
RigorRun cannot set is a case it cannot generate, so it says which rather than
dropping it.

## What it will not do while you are setting up

**It will not call anything that changes your system.**

This matters more here than it does for MCP. With an MCP server you tick the
tools RigorRun may call. With an OpenAPI document every operation arrives at
once, described by a file, and `POST /orders` looks exactly like `GET /orders`
to anything not reading the method. RigorRun does call your system during setup
— it tries the reads you nominate, and samples them to work out what your
records look like — so "it only reads" has to be enforced rather than intended.

A connection refuses anything not classified READ until a demonstration or a run
begins. `packages/env-openapi/test/openapi.test.ts` drives an entire setup
against a request-counting server and asserts not one non-GET was sent.

The guard comes off when you press **Start recording**, and again when your
agent runs. Both are moments where changing things is the entire point.

## Which operations only read

RigorRun classifies from the method, and records that it did: an HTTP method is
not an annotation. RFC 9110 *requires* GET to be safe, where MCP's specification
says explicitly not to trust `readOnlyHint`. That is better evidence.

It is still not permission. A system can answer GET destructively, so RigorRun
asks you to confirm which operations only read — the same question it asks about
MCP tools, for the same reason.

## Credentials

Give RigorRun the **header name** — `Authorization`, usually — and the *name* of
a secret. The value comes from this machine's credential store when the
connection opens, and is never in the project file. See
[SECURITY_MODEL.md](SECURITY_MODEL.md).

## What is not built yet

- **No OAuth flow.** A static header is the only authentication. If your API
  needs a token refreshed, refresh it and set the secret again.
- **No `$ref` to another document.** Local references are followed; remote ones
  resolve to nothing, because fetching whatever a document points at is a
  request RigorRun would be making to an address you never typed.
- **No reset endpoint.** A reset has to be an operation the API publishes, and
  RigorRun currently only nominates MCP tools for it. Without one, cases are not
  isolated and every verdict says so.
