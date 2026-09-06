# An agent RigorRun cannot start

The other three ways in assume RigorRun can invoke your agent: post to a URL,
or run a command. A great many real agents are neither. They live inside a
product behind a login, in a notebook somebody runs by hand, or on
infrastructure that will not accept an inbound request from a laptop.

So this one is inverted. RigorRun prepares the world, publishes one case, and
waits. Your agent asks what to do, works through the address it is handed, and
says when it is finished.

Everything after that is unchanged: the same proxy, the same step budget, the
same evidence, and the same rule that your agent's own account of what it did
is displayed and never scored. The verdict still comes from reading the system
afterwards.

## Setting one up

In the interface, at the agent step, choose **RigorRun cannot start it — I will
drive it**. You get a key, once.

The key is shown on that screen and nowhere else. It is in this machine's
credential store, and there is deliberately no command or endpoint that prints
it back — the same rule every other credential here follows, and the reason a
project file can be copied without carrying anything. If you lose it, make
another agent.

The agent is not connected until your loop asks for work. There is nothing to
probe: RigorRun cannot call it, so the only evidence available that it exists
is a driver turning up with the right key.

## The loop

Two endpoints. Both take the key as a bearer header.

```
GET  /api/drive/<agentId>            → { "waiting": <case> | null }
POST /api/drive/<agentId>/finished   ← { "caseId", "status", "output" }
```

A case looks like this:

```json
{
  "caseId": "case_live__existing_bookingId_BKG-4002",
  "index": 3,
  "total": 12,
  "task": {
    "instruction": "Confirm the held booking.",
    "inputs": { "bookingId": "BKG-4002" },
    "policyBrief": "A booking may only be confirmed after a sign-off is recorded."
  },
  "mcpUrl": "http://127.0.0.1:8931/mcp/9f2c…",
  "expiresAt": "2026-09-06T10:31:00.000Z",
  "maxSteps": 20
}
```

`mcpUrl` is an MCP endpoint scoped to that one case. It is how your agent
touches the system, and it stops existing when the case does — which is what
makes the evidence identical to an agent RigorRun called itself.

In TypeScript:

The runner's address is the one it printed when you started it, and the agent's
id is shown with the key.

```ts
const runner = 'http://127.0.0.1:<the port the runner printed>';
const agentId = 'a_1a2b3c4d';
const key = process.env.RIGORRUN_AGENT_KEY;
const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };

for (;;) {
  const { waiting } = await (await fetch(`${runner}/api/drive/${agentId}`, { headers })).json();
  if (!waiting) {
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }

  // Your agent, however it normally works. Everything it does goes through
  // waiting.mcpUrl, which is an ordinary streamable-HTTP MCP server.
  const output = await myAgent(waiting.task, waiting.mcpUrl);

  await fetch(`${runner}/api/drive/${agentId}/finished`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ caseId: waiting.caseId, status: 'completed', output }),
  });
}
```

In Python, the same thing:

```python
import os, time, urllib.request, json

runner, agent_id = "http://127.0.0.1:<the port the runner printed>", "a_1a2b3c4d"
headers = {"Authorization": f"Bearer {os.environ['RIGORRUN_AGENT_KEY']}",
           "Content-Type": "application/json"}

def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"{runner}{path}", data=data, headers=headers)
    with urllib.request.urlopen(request) as answer:
        return json.load(answer)

while True:
    waiting = call(f"/api/drive/{agent_id}")["waiting"]
    if waiting is None:
        time.sleep(1)
        continue
    output = my_agent(waiting["task"], waiting["mcpUrl"])
    call(f"/api/drive/{agent_id}/finished",
         {"caseId": waiting["caseId"], "status": "completed", "output": output})
```

Then press **Run** in the interface. The run shows which case your agent is on
while it works, so a run that is waiting on you looks different from a run that
is stuck.

## What the key can do

Three things: see the case that is waiting, say it is finished, and nothing
else. It does not drive the runner — `/api/projects` refuses it, exactly as it
refuses a stranger.

It is still worth protecting. The waiting case carries the MCP endpoint for
that case, so whoever holds the key can act on your system through it, which is
inherent in being the thing that acts on your system. Deleting the agent
revokes the key.

Everything under `/api/drive` answers a wrong key, a key for another agent, and
an agent that does not exist with the same 401 and the same body, because
telling them apart tells somebody which of their guesses was closer.

## The parts worth knowing

**One case at a time.** The state of your system is the thing under test, and
two cases running at once against one system means neither result means
anything. A second run against the same agent is refused while the first is
open.

**It stops waiting.** A case waits ten minutes. If nobody answers one, the rest
of that run fail immediately rather than waiting ten minutes each — a suite of
twenty cases telling you nobody was listening should take ten minutes, not
three hours.

**Answer the case you were given.** `finished` names a `caseId`, and an answer
for anything other than the case currently open is refused with a 409. If your
loop retried, or two copies are running, that is what stops the wrong answer
being scored against the wrong case.

**Nothing survives a restart.** The waiting slot lives in the running process.
A runner that is restarted has nothing waiting, which is the truth about the
case it died in the middle of. Start the run again.
