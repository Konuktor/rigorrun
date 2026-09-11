---
title: Security
description: The boundaries RigorRun defends, the ones it does not, and how to report a vulnerability.
---

RigorRun connects to systems holding your real records, using your real credentials. The useful
thing to publish is therefore where the boundaries are, not a reassurance.

Start with [local-first architecture](/trust/local-first/) for the runner's isolation, and
[credentials](/systems/credentials/) for where secrets go.

## Refusals rather than warnings

- **A project marked `production` cannot mutate.** Your agent still gets to try; you see what it
  would have done. Suite quality checking is also unavailable there, because it runs the suite
  several times and most of those runs write.
- **An imported project is inert until approved.** A connector that arrived in a file is a command
  to run or a URL to open with your credentials. `rigorrun trust <id>` shows it in full. This is a
  refusal, not a warning, because opening it *is* the harmful act.
- **No command prints a secret,** and `secret set` refuses a value on the command line.

## Annotations are claims, not permissions

`readOnlyHint` and its siblings are displayed with their source named and never enforced against.
When a tool claims read-only and state changes anyway, that is recorded as a mismatch. This is the
same principle [`rigorrun verify`](/cli/verify/) applies to published servers.

## Reporting a vulnerability

Write to **security@rigorrun.xyz** with what you did, what happened, and the output of
`rigorrun --version`. You will get a reply within 72 hours.

Please do not open a public issue for anything that could be used against somebody else's machine
before it is fixed. There is no bounty — advertising one with no revenue behind it would be
dishonest — but you will be credited in the changelog if you would like to be.

## Verifying what you installed

```bash
npm audit signatures
npm view rigorrun dist.integrity
```

The package is published by a GitHub Actions workflow that holds no npm token, using npm trusted
publishing, with a SLSA build provenance attestation. The source that built it is public, which is
the point: provenance pointing at a repository nobody can open proves very little.
