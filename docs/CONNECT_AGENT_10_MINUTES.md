# Point RigorRun at your agent

Your agent keeps its own loop. RigorRun hands each case an MCP address scoped to
that one case, your agent does the job through it, and the verdict comes from
reading the system afterwards — never from the agent's own account.

Agents belong to a project: connect a system, show RigorRun the job once,
confirm the rules, build the suite, then add the agent. `npx rigorrun` walks you
through it; `rigorrun setup <spec.json>` does it without the interface.

## Three ways in

| Your agent | Choose, at the agent step | Doc |
| --- | --- | --- |
| Answers HTTP on this machine | **It listens on an address** | [HTTP_AGENT.md](HTTP_AGENT.md) |
| Is a command you can run | **It is a command on this machine** | [CLI_AGENT.md](CLI_AGENT.md) |
| Cannot be started or reached by RigorRun | **RigorRun cannot start it — I will drive it** | [DRIVEN_AGENT.md](DRIVEN_AGENT.md) |

All three speak `rigorrun/agent/2`: one task in (`instruction`, `inputs`,
`policyBrief`, and the case's `mcpUrl`), one answer out
(`{ "status": "completed" | "failed", "output": "…" }`). `output` is shown next
to what actually happened and never scored.

## A complete HTTP agent

The runnable server in [the HTTP agent page](../apps/docs/src/content/docs/agents/http.md)
is about thirty lines and is started against RigorRun's own probe on every change,
so it cannot drift from the protocol. Replace `yourAgent` with your loop and give
it the `mcpUrl`.

## Run it and gate on it

```bash
npx rigorrun run --project <project-id> --agent <agent-id>
npx rigorrun gate --project <project-id> --agent <agent-id> --min-success 0.95
```

`gate` exits 0 when the agent passed, 1 when it failed, 2 when the setup is
wrong and 3 when too many cases could not be decided — so a CI job can tell them
apart. See [CI.md](CI.md).

## Safety, and why it is in your way

An agent's address comes from your own project, never from a file somebody sent
you. Redirects are refused, responses are size-capped, and every reply is
validated before use. The runner and the per-case MCP address listen on loopback
only, so the agent runs on the same machine as RigorRun.

## What your agent is graded on

The state of the system after it finishes, read through the reads you nominated.
The agent's report is carried so a person can read the claim next to the
evidence, and a confident false report cannot make a failing check pass.
