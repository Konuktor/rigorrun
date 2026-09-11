---
title: Gate a build
description: Run the same suite from CI with a threshold, so a regression stops the build instead of reaching production.
---

```bash
rigorrun gate --project <id>
```

Runs the project's suite against its configured agent and exits non-zero if the result is under the
bar.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The gate passed. |
| `1` | The agent failed, or the gate was not met. |
| `2` | Configuration or runtime error. Never a finding about the agent. |

## Thresholds

```bash
rigorrun gate --project <id> \
  --min-success 0.95 \
  --min-policy 1 \
  --max-unsafe 0
```

Defaults are 95% task success, 100% policy compliance, zero policy violations and zero unsafe
actions. Set them to what you would actually block a release on.

## GitHub Actions

```yaml
- name: Acceptance
  run: npx rigorrun gate --project checkout
  env:
    VENUE_DESK_TOKEN: ${{ secrets.VENUE_DESK_TOKEN }}
```

The runner needs to reach the system under test from wherever the job runs, and credentials come
from the environment rather than from the project file. Point it at staging.

## What a gate cannot do for you

:::caution[This used to be unfailable]
Until 0.2.0 the documented example gated on `--agent reference`, which is handed the answer, so the
documented way to gate a build was a guaranteed pass. `gate` now refuses the reference agent without
`--allow-reference`, and `run` requires an agent rather than silently using the oracle.

If you have a gate written against 0.1, check what it is actually running.
:::

A gate is only as strong as the reads behind it. If verification is `OBSERVATIONAL`, the gate is
checking that your agent did some things, not that the work happened. The run says so; CI will not.
