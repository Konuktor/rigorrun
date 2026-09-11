---
title: Local-first architecture
description: Why RigorRun runs on your machine, how the local runner is reachable only from it, and exactly what can leave.
---

RigorRun runs on your machine, and that is not a preference.

A page served over `https` cannot fetch `http://127.0.0.1` in Firefox or Safari — it is mixed
content. So a hosted interface simply could not reach a customer's local MCP server, internal API or
staging box. Serving both halves from one loopback origin removes the problem rather than working
around it, and it means there is no relay, no account, and no route by which your credentials could
reach us.

## Three checks before a request is answered

1. **The socket is loopback.** `127.0.0.1`, on an ephemeral port.
2. **The `Host` header must match.** One of `127.0.0.1`, `localhost` or `::1`. A DNS name that
   resolves to loopback does not get in.
3. **The interface is paired.** The runner prints a URL with a single-use code, which is redeemed
   once for an `HttpOnly; SameSite=Strict` session cookie and then 302s so the code leaves the
   address bar. Press Enter in the terminal to reissue.

Every mutating `/api` request is additionally checked against `Sec-Fetch-Site` and `Origin`.

## What can leave

Three things, all because you asked, none of them to us:

| | |
| --- | --- |
| `rigorrun verify npm:…` | Downloads the named package from `registry.npmjs.org`. |
| Connecting your own system | Requests go to the address you gave, with the credentials you configured. |
| An LLM-backed agent | Only exists if you set `GROQ_API_KEY`, `GEMINI_API_KEY` or `OPENAI_COMPATIBLE_*`. Then it talks to that provider. |

There is no analytics SDK, no beacon and no crash reporter in the package.

:::note[The local activation log]
RigorRun writes `~/.rigorrun/activation.jsonl`: a stage id, a timestamp, a counter and a coarse
error class. No task content, no arguments, no results, no names, no URLs, no credentials. There is
no uploader and no endpoint — nothing to opt out of. If usage reporting is ever added, that is the
shape it would send, and you can read the file first.
:::

You can check the recording side yourself:

```bash
rigorrun privacy inspect <trace.json>
```
