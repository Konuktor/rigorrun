---
title: Evidence methodology
description: How the numbers on rigorrun.xyz are produced, why they are regenerable, and what they do not establish.
---

Nothing user-visible on the RigorRun site is a number somebody typed. Both sets are written by a
script and checked in CI.

## The pipeline figures

`scripts/build-proof.mjs` runs the real compiler, generator, runner and quality checker over the
bundled workflows and writes what they produced. `node scripts/build-proof.mjs --check` runs in CI
and fails the build if the page no longer matches a fresh run.

:::note[Why the check exists]
The site once carried these as literals and drifted: it claimed 18 events, 17 cases and 10
categories while the pipeline produced 7, 22 and 9. The first version of the freshness gate diffed
the whole file, which can never pass — three of its fields are a clock — so it compared nothing and
the page fell thirteen commits behind while saying it was what the pipeline produces.
:::

## The third-party figures

`scripts/build-evidence.mjs` shells out to the shipped CLI, running
[`rigorrun verify`](/cli/verify/) against four pinned public MCP servers in Docker. It requires a
container runtime and exits rather than emitting a plausible file if one is absent.

Every record names its digest, its base image, whether network egress was permitted, how isolation
was measured, and every tool it did not exercise with the reason.

## What the published numbers do not establish

- **Nothing about the wider registry.** Four servers, one publisher, all well maintained. That is
  the weakest possible sample.
- **No security claim about any of them.** A server that contradicted nothing contradicted nothing
  *this harness can observe*, on the tools it could exercise, at one digest, on one day.
- **No claim that unexercised tools are safe.** They are unexercised.
- **No market validation.** Our own scan is not a user.

Reproduce any of it:

```bash
rigorrun verify npm:@modelcontextprotocol/server-memory@2026.8.31
```
