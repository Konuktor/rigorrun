---
title: Install and run
description: One command starts the RigorRun runner on your machine. Node 20.11 or newer; nothing to sign up for.
---

```bash
npx rigorrun
```

That is the whole install. It prints a URL containing a single-use pairing code and opens your
browser; on a headless machine, the printed URL is the interface.

## What you need

| | |
| --- | --- |
| **Node** | 20.11 or newer. `rigorrun` refuses to start on anything older and says so rather than crashing. |
| **A system it is safe to change** | Staging, a scratch instance, or a local copy. RigorRun refuses to write to a project marked `production`. |
| **A way to read that system back** | One operation RigorRun can call afterwards to see what changed. Without one it can still watch, but every verdict says `OBSERVATIONAL`. |
| **Docker** | Only for [`rigorrun verify`](/cli/verify/). Nothing else needs it. |

## Check the machine

```bash
npx rigorrun doctor
```

Reports the Node version, whether a container runtime is present and whether it is rootless, which
credential store you got, and the state of every project on this machine. Exit `0` when everything
it needs is present, `2` when something is not.

## Verify what you installed

The package is published from a GitHub Actions workflow that holds no npm token, using npm trusted
publishing, and carries a SLSA build provenance attestation.

```bash
npm audit signatures
npm view rigorrun dist.integrity
```

## Where things are kept

Everything lives under `~/.rigorrun`: projects, recordings, generated suites, run history and
verification records. Credentials go to the operating system's credential store — Keychain,
libsecret or DPAPI — and never into a project file. Nothing is uploaded, because there is no
service to upload to.
