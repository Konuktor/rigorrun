# Security model

RigorRun runs untrusted agents against systems that matter, using credentials
that matter, on your machine. This is what is defended and how.

## The rule everything else follows from

**A configuration that can start a process or open a connection may only ever
come from the person running RigorRun.** Never from a benchmark file, never
from an imported trace, never from something a connected server said.

A benchmark is a document people download and share. The moment one of them can
name a command, running somebody else's benchmark becomes running somebody
else's code.

## Threats and what is done

### A malicious or careless MCP server

Its tool descriptions are text shown to a person and never parsed for meaning.
Its annotations are claims with a named source and never permissions — see
[MCP_ENVIRONMENT.md](MCP_ENVIRONMENT.md). Its JSON Schema is walked under hard
caps on depth, node count, property count and enum size, so a schema that
references itself returns rather than recursing forever. Its results are data:
they never reach an assertion path, and the compiler's path builder refuses
filter-language punctuation in any value that came from outside.

### Command injection through a connector

A local connector is a binary and an argument array, never one string, and the
command is rejected if it contains shell metacharacters. The process is spawned
directly; no shell is involved. The child receives a small allowlist of
environment variables plus the credentials you named.

### SSRF through a remote connector

Private addresses are allowed, because a staging system is usually on one — a
blanket ban would make the product useless for its main case. Non-HTTP schemes,
credentials embedded in the URL, and the cloud metadata addresses
(`169.254.169.254`, `metadata.google.internal`) are refused. Agent endpoints are
held to a stricter rule: loopback unless you opt out.

### Another page on your machine driving the runner

Loopback keeps other machines out and keeps nothing else out: every tab on your
machine can reach `127.0.0.1`. Three defences, each covering a different
mistake.

The socket listens on loopback only. The `Host` header is checked, because a
page can make a domain it owns resolve to `127.0.0.1` but cannot change the
header the browser sends — that is DNS rebinding. And every API call needs the
session token, which a page gets only by being opened from the URL the runner
printed.

The pairing code is single-use and expires in ten minutes. It ends up in shell
history, terminal scrollback and possibly a screenshot, so spending it on first
use makes the copies worthless. The session cookie is `HttpOnly` and
`SameSite=Strict`. Comparisons are constant-time.

### Reaching a live proxy session

A session id carries 128 bits of randomness and stops existing when its case
ends. A made-up id and a revoked one get the same answer, so probing cannot
distinguish them.

A proxy session grants no powers an in-process agent lacks: same step budget,
same allowed tools, same write guard, same evidence.

### Damaging production

Every environment is marked `production`, `staging`, `local` or `ephemeral`.
There is no default, because somebody has to decide. On `production` every
write is refused at the tool channel and recorded as a refused step — the agent
still gets to try, so the evidence shows what it would have done.

### Prompt injection through business data

Content authored by outsiders is the flagship *measurement*, not an edge case.
RigorRun asks, for every free-text field, whether somebody outside your
organisation can write it, because no data can answer that and it decides where
injection payloads go. Nothing in RigorRun ever treats that content as
instruction.

### Secrets leaking

Credentials live in one owner-only file for the install. A project carries the
*names* of the secrets it needs and never the values, so a project file can be
read, copied or attached to a support request safely. There is no command that
prints a secret back. Run results are owner-only too, because they contain real
tool arguments.

## What is not defended

Stated because a threat model that lists only wins is not one.

- **A malicious command you configure yourself.** If you tell RigorRun to run
  something, it runs it. There is no sandbox around the child process.
- **A hostile agent endpoint you point at.** RigorRun posts a task to it and
  reads a bounded reply; it does not defend against what that endpoint does
  with the proxy URL beyond the limits above.
- **Anything after the credentials leave.** RigorRun passes named secrets to the
  server you configured. What that server does with them is between you and it.
- **Multi-user access.** There is none. The runner is one person's process on
  one machine, and everything above is written on that assumption.
