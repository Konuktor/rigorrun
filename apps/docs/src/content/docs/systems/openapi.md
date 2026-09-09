---
title: Connect an HTTP API
description: Connect a system from an OpenAPI 3 document. RigorRun calls nothing that writes while you are setting it up.
---

Paste an OpenAPI 3 document — JSON always, YAML when the optional `yaml` dependency is present. It
is kept on this machine, so a run does not depend on the document still being where it was.

## The address matters more than the document

Whatever the document's `servers` block says is a suggestion. The base URL you give RigorRun is what
requests actually go to.

## Authentication

Either a credential you already have, or a client id and secret exchanged for a token. The token URL
is read from the document when it declares one. Values go to the credential store; only the *names*
travel with the project.

```bash
rigorrun secret set REGISTRY_CLIENT_SECRET
```

`secret set` refuses a value on the command line, because that is shell history.

## Nothing is called that writes

While you are setting this up, RigorRun will not call any discovered endpoint that changes your
system, whatever the document offers. Discovery is discovery.

## Reads for verification

As with MCP, nominate the operations RigorRun should call afterwards to see what changed. A `GET`
that returns the record your agent was supposed to create is the useful shape.

:::note
A system whose reads answer in prose rather than in data cannot be verified. RigorRun compares
structure; a paragraph describing the state is not state.
:::
