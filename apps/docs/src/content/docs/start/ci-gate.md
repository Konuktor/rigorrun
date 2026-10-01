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

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| `0`  | The gate passed.                                                 |
| `1`  | The agent failed, or the gate was not met.                       |
| `2`  | Configuration or runtime error. Never a finding about the agent. |
| `3`  | The run completed, but too many cases reached no verdict.        |

## Thresholds

```bash
rigorrun gate --project <id> \
  --min-success 0.95 \
  --min-policy 1 \
  --max-unsafe 0
```

Defaults are 95% task success, 100% policy compliance, zero policy violations and zero unsafe
actions. Set them to what you would actually block a release on.

## GitHub Action

```yaml
- name: RigorRun gate
  uses: Konuktor/rigorrun@v0.4.0
  with:
    project: ${{ vars.RIGORRUN_PROJECT }}
    version: 0.4.0
    min-success: '0.95'
    report: rigorrun-report.html
    node-version: 22
  env:
    RIGORRUN_SECRET__VENUE_DESK_TOKEN: ${{ secrets.VENUE_DESK_TOKEN }}
```

The action always adds a Markdown summary, uploads the HTML report when one was written, and keeps
the gate's exit code.

| Input           | Required | Default                             | Meaning                                                            |
| --------------- | -------- | ----------------------------------- | ------------------------------------------------------------------ |
| `project`       | Yes      | —                                   | Project id passed to `gate --project`.                             |
| `version`       | No       | `0.3.1`                             | Exact npm package version; never `latest`.                         |
| `min-success`   | No       | Gate default (`0.95`)               | Optional value passed to `--min-success`.                          |
| `report`        | No       | `rigorrun-report.html`              | Path passed to `--report` and uploaded when it exists.             |
| `rigorrun-home` | No       | `${{ github.workspace }}/.rigorrun` | Project store, exported as `RIGORRUN_HOME`.                        |
| `node-version`  | No       | `22`                                | Node.js version installed by the action.                           |
| `cli`           | No       | —                                   | Local CLI command for action development, such as `pnpm rigorrun`. |

Outputs are `verdict` (`PASS`, `FAIL`, `INCONCLUSIVE`, or `ERROR`) and `exit-code`. Pass every
credential named by the project on the action step as
`RIGORRUN_SECRET__<NAME>: ${{ secrets.NAME }}`; the action does not print the environment.

### Without the action

```yaml
- name: Acceptance
  run: npx rigorrun gate --project checkout
  env:
    RIGORRUN_SECRET__VENUE_DESK_TOKEN: ${{ secrets.VENUE_DESK_TOKEN }}
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
