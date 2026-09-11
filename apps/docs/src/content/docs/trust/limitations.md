---
title: Limitations
description: What RigorRun does not do, cannot do, and has not been shown to do. Kept current rather than kept short.
---

## What it cannot defend against

These are carried on every verification record RigorRun writes, not only here.

- **The container runtime daemon runs as root.** RigorRun reduces blast radius but does not claim to
  prevent a container escape; an escape reaches the host.
- **A state reading that came only from the server's own tools is corroboration, not proof.** The
  server that may be misdeclaring a tool is the one answering the read.
- **State is read from the container's writable mounts.** Complete over durable storage, blind to
  state a process holds only in memory.
- **Records are hashed, not signed.** No HMAC, Ed25519 or sigstore attestation exists yet, so a
  record proves integrity against accidental change and not against a determined author.

## What is not built

| | |
| --- | --- |
| **Three of the six verification sources** | `STATE` and `EVENT` are the only ones generated suites emit. Nothing produces a model-judged or human-review evaluator. The tiers exist in the schema and are unreachable in practice. |
| **Ten of fourteen assertion kinds** | Generated suites only ever emit the four that read state. |
| **The agent SDKs** | Every `@rigorrun/*` workspace package is private, so `npm i @rigorrun/agent-sdk` does not resolve. Connecting an agent over HTTP needs no SDK. |
| **Continuous drift detection, hosted scheduling, a paid tier** | Deliberately not built, pending evidence anybody wants them. |
| **Signed records** | See above. |

## What has not been shown

- **No external team has used RigorRun.** Published evidence covers four MCP servers from a single
  publisher, and a fixture system written for the dogfood test. Neither is a customer.
- **`rigorrun verify` reaches about half a server's surface.** Measured: 19 of 37 tools across four
  servers. `server-filesystem` was 2 of 14.
- **Browser verdicts are `OBSERVATIONAL`.** See [connect a web application](/systems/browser/).
- **A verdict against a real system is `PARTIAL`.** By design. See
  [verification strength](/concepts/verification-strength/).

The current version of this list, with how each line was checked, is
[what is and is not built](https://rigorrun.xyz/what-is-built).
