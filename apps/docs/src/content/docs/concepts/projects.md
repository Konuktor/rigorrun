---
title: Projects and workflows
description: What a RigorRun project holds, where it lives, and what survives a crash.
---

A project is one job you want an agent to do, in one of your systems. It holds the connection, the
tools you vouched for, the recording, the derived contract, the generated suite, the agents you have
connected and the history of runs.

## Where it lives

Everything is under `~/.rigorrun`. Credentials are the exception: they go to the operating system's
credential store — Keychain, libsecret or DPAPI — chosen by a write-read-delete round trip rather
than by platform name, with an owner-only file when none is present. `rigorrun doctor` says which
one you got.

## What survives

- **A crash.** The runner can be killed with `SIGKILL` mid-flow; the project, the recording and the
  suite are all there when it comes back.
- **A half-written file.** Every write goes to a temporary file, is fsynced, renamed, and the
  directory fsynced.
- **Damage.** A corrupted project file comes back as a broken project naming the file, rather than
  the project vanishing from a product whose promise is that your work survives.

## Moving a project

```bash
rigorrun export-project <id>
rigorrun import-project <file>
rigorrun trust <id>
```

Secrets are excluded from an export unless you ask for them.

:::caution[An imported project is inert until you agree to it]
A connector that arrived in a file is a command to run, or a URL to open with your credentials.
RigorRun refuses it until somebody has seen it in full and said yes. That is a refusal rather than a
warning, because opening it *is* the harmful act. `rigorrun trust <id>` shows exactly what it would
run.
:::
