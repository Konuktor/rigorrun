# Running it in CI

A person connects a system and teaches a job in the interface, because both are
interactive by nature — you are looking at what came back. Running the suite you
already have, and failing a build when it regresses, works with no interface and
no person.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Passed. |
| `1` | The agent failed, or the gate was not met. |
| `2` | Something is wrong with the setup. |

A build server cannot tell those apart from prose, so `2` never means "the agent
was bad" — it means RigorRun could not run the question.

This contract is asserted at the end of `e2e/external-user.spec.ts`: the same
run that sets a project up in a browser then shells out to `rigorrun gate
--project` against that workspace and checks the code. The snippet below is the
command that test runs.

## Commands

```bash
rigorrun projects                                   # what is on this machine
rigorrun run --project p_1a2b3c                     # run and print the result
rigorrun gate --project p_1a2b3c --min-success 0.95 # run and gate
rigorrun compare-runs --project p_1a2b3c run_9f8e7d # what changed
```

Gate thresholds default to `--min-success 0.95`, `--min-policy 1`,
`--max-unsafe 0`.

## What the gate prints

How the verdict was reached, next to the verdict:

```
Gate: Booking agent
metric              observed  required
task success        60.0%     >= 95.0%
policy compliance   60.0%     >= 100.0%
unsafe actions      3         <= 0

verification  PARTIAL   isolation  RESET
limit  RigorRun reads back only what the nominated read operations return.

FAIL  task success 60.0% < 95.0%; policy compliance 60.0% < 100.0%
```

A gate that passed against a system nothing could be read back from is a
different claim from one that passed against a system that could, so both
travel together.

## GitHub Actions

```yaml
name: agent acceptance
on: [pull_request]

jobs:
  acceptance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Your agent, however you build and start it.
      - run: npm ci && npm run start:agent &

      # Your system under test. A container, a fixture loader, whatever a
      # reset in your project points at.
      - run: docker compose up -d staging

      - run: npx rigorrun gate --project ${{ vars.RIGORRUN_PROJECT }}
             --min-success 0.95
        env:
          RIGORRUN_HOME: ${{ github.workspace }}/.rigorrun
          RIGORRUN_SECRET_VALUE: ${{ secrets.DESK_TOKEN }}
```

Two things this example is honest about. The project has to exist on that
machine — `RIGORRUN_HOME` must point at a checked-in or restored project
directory, which contains no credentials. And your agent and your system are
your problem to start; RigorRun does not manage them.

## Where a project lives

```
~/.rigorrun/
  secrets.json                 0600, never committed
  projects/<id>/
    project.json               metadata and connector shape, no credentials
    trace.json                 your recorded demonstration
    contract.json              the compiled contract
    benchmark.json             the suite, including its private checks
    runs/<runId>.json          full results, including real tool arguments
```

`project.json`, `contract.json` and `benchmark.json` are safe to commit if you
want CI to use the same suite as your laptop. `trace.json`, `runs/` and
`secrets.json` contain your data; treat them the way you treat your database.
