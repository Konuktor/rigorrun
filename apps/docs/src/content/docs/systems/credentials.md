---
title: Credentials
description: Where RigorRun keeps secrets, why no command prints one, and what travels with an exported project.
---

Credentials go to the operating system's credential store: Keychain on macOS, libsecret on Linux,
DPAPI on Windows. The backend is chosen by a write-read-delete round trip rather than by platform
name, so RigorRun knows it works rather than assuming. Where none is present, an owner-only file is
used instead. `rigorrun doctor` reports which one you got.

```bash
npx rigorrun secrets list
npx rigorrun secrets set VENUE_DESK_TOKEN      # prompts, without echo
npx rigorrun secrets remove VENUE_DESK_TOKEN
```

## No command prints a secret

There is deliberately no `secrets get`. And `secret set` refuses a value passed on the command line,
because that is shell history.

## Only names travel

A project stores the *names* of the credentials it needs. The values stay in the store. An exported
project therefore carries no secrets unless you explicitly ask for them with `--with-secrets`.

## In CI

A credential the project names `VENUE_DESK_TOKEN` can arrive as `RIGORRUN_SECRET__VENUE_DESK_TOKEN`:
the name upper-cased, with anything but letters and digits made `_`. RigorRun reads it only when the
store has no entry, so a CI job needs no keychain, and a value on your laptop is never overridden by a
stray variable. Values that arrive this way are never written into an exported project.
