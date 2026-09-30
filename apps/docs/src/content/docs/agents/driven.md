---
title: An agent you drive
description: When RigorRun cannot start or reach your agent, it makes a key and your own loop pulls work instead.
---

Some agents cannot be called: they live behind a login, in a notebook, in another network, or in a
product you do not control. RigorRun never calls these. Your loop asks for work instead.

## Make a key

In the interface, choose **RigorRun cannot start it — I will drive it** and press **Make a key**.

:::caution
Copy it then. It is not stored anywhere you can read it back, and it is not in the project file.
:::

## The loop

Two endpoints, both taking the key as a bearer header:

```
GET  /api/drive/<agentId>            → { "waiting": <case> | null }
POST /api/drive/<agentId>/finished   ← { "caseId", "status", "output" }
```

A waiting case carries `caseId`, `task` (`instruction`, `inputs`, `policyBrief`), `mcpUrl` — an MCP
address scoped to that one case, which is how your agent touches the system — `expiresAt` and
`maxSteps`.

```python
import json, os, time, urllib.request

RUNNER = "http://127.0.0.1:41925"   # the address the runner printed
AGENT = "a_1a2b3c4d"                # shown with the key
HEADERS = {"Authorization": f"Bearer {os.environ['RIGORRUN_AGENT_KEY']}",
           "Content-Type": "application/json"}

def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(urllib.request.Request(RUNNER + path, data=data, headers=HEADERS)) as r:
        return json.load(r)

while True:
    waiting = call(f"/api/drive/{AGENT}")["waiting"]
    if waiting is None:
        time.sleep(1)                   # nothing published yet; press Run in the interface
        continue
    output = your_agent(waiting["task"], waiting["mcpUrl"])
    call(f"/api/drive/{AGENT}/finished",
         {"caseId": waiting["caseId"], "status": "completed", "output": output})
```

About twenty lines. `output` is shown next to what actually happened and never scored. The loop has to
run on this machine: the runner and the per-case MCP address both listen on loopback only.

## Why this exists

The alternative is an agent that has to be reachable from this machine, which for a lot of real
agents means changing where they run in order to test them. Testing something should not require
moving it.
