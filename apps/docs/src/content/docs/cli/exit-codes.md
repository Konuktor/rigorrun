---
title: Exit codes
description: What each RigorRun exit code means, and why a harness failure is never reported as a finding.
---

```
0  success, or the gate passed
1  the benchmark failed, the gate was not met, or a declaration was
   contradicted by what the server was observed to do
2  configuration or runtime error
3  verify only: it ran, but established too little to be worth much
```

## Why 2 is separate from 1

`2` means RigorRun itself could not do its job — a missing runtime, an unreachable system, a
malformed document. It is never a finding about the thing under test, and it is never dressed up as
one. A CI job that treats every non-zero exit the same will report a broken Docker socket as a
failing agent.

```yaml
- run: npx rigorrun gate --project checkout
  # 0 ships, 1 blocks, 2 is your problem not the agent's
```

## Why 3 exists

`rigorrun verify` can complete without establishing much: if only two of fourteen tools could be
safely exercised, "nothing was contradicted" is true and close to meaningless. `3` says so rather
than returning `0` and letting the number of tools go unread.

Precedence is `2 > 1 > 3 > 0`.
