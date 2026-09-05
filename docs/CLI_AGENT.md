# An agent that is a command

If your agent is a program rather than a service, RigorRun runs it. Same
protocol as the HTTP agent, same evidence, same verdict — the transport is
stdin and stdout instead of a socket.

## The protocol

RigorRun writes **one line of JSON** to your program's stdin and waits for
**one line of JSON** back.

The request:

```json
{
  "protocol": "rigorrun/agent/2",
  "caseId": "case_...",
  "task": { "instruction": "...", "inputs": { }, "policyBrief": "..." },
  "environment": { "mcpUrl": "http://127.0.0.1:PORT/mcp/...", "expiresAt": "..." },
  "maxSteps": 40
}
```

The reply:

```json
{ "status": "completed", "output": "what you did, in your own words" }
```

`output` is shown beside the verdict and **never scored**. RigorRun decides by
reading your system afterwards, not by reading this.

A probe arrives as `{"protocol":"rigorrun/agent/2","probe":true}` and must be
answered with `{"ok":true}` — optionally with `{"agent":{"name":"…"}}`, which
RigorRun uses as the name if you left it blank. Your agent is not connected
until it answers one.

## The whole integration

```ts
import { createInterface } from 'node:readline';

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.probe) {
    process.stdout.write(JSON.stringify({ ok: true, agent: { name: 'my-agent' } }) + '\n');
    continue;
  }
  const output = await myAgent(request.task, request.environment.mcpUrl);
  process.stdout.write(JSON.stringify({ status: 'completed', output }) + '\n');
  break;
}
```

`request.environment.mcpUrl` is an ordinary streamable-HTTP MCP endpoint scoped
to that one case. Connect to it however your agent already connects to MCP.

A working one is in `fixtures/external/process-agent`, which imports nothing
from RigorRun.

## One process per case

RigorRun starts your program again for every case, and expects it to exit after
answering. A case is the isolation unit everywhere else in this product; a
long-lived process lets case seven inherit case six's memory, which is exactly
what `isolation: RESET` claims did not happen.

If it has not answered within two minutes it gets `SIGTERM`, then `SIGKILL` five
seconds later. A timeout is a *result* — that case failed — not a crash.

## What is bounded

Everything, because it is your program and not ours: the reply is read up to
256KB, stderr up to 8KB and only shown if something went wrong, and the process
is killed whatever happens. A harness that can be made to hang by the thing it
is testing is a harness nobody leaves running.

## Where a command may come from

Only from you, at this machine — typed into the interface, or into the CLI.

Exactly one file in RigorRun starts a process (`packages/daemon/src/exec.ts`),
it never uses a shell, and every caller has to declare in TypeScript where its
command came from. No schema anywhere declares that field, so no JSON — a
benchmark, an imported project, a tool result, a trace — can produce one. A
test asserts all three, and another asserts that a command smuggled into a
project file is dropped rather than ignored.

An imported project's agents arrive with their confirmation cleared, whatever
the file said. RigorRun will not run one until you have looked at the command
and said yes. See [SECURITY_MODEL.md](SECURITY_MODEL.md).
