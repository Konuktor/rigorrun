---
title: Credentials
description: Where RigorRun keeps secrets, why no command prints one, and what travels with an exported project.
---

Credentials go to the operating system's credential store: Keychain on macOS, libsecret on Linux,
DPAPI on Windows. The backend is chosen by a write-read-delete round trip rather than by platform
name, so RigorRun knows it works rather than assuming. Where none is present, an owner-only file is
used instead. `rigorrun doctor` reports which one you got.

```bash
rigorrun secrets list
rigorrun secret set VENUE_DESK_TOKEN
rigorrun secret remove VENUE_DESK_TOKEN
```

## No command prints a secret

There is deliberately no `secrets get`. And `secret set` refuses a value passed on the command line,
because that is shell history.

## Only names travel

A project stores the *names* of the credentials it needs. The values stay in the store. An exported
project therefore carries no secrets unless you explicitly ask for them with `--with-secrets`.

## In CI

Set them in the environment the way you would for anything else. RigorRun reads from the environment
when the store has no entry, so a CI job needs no keychain.
