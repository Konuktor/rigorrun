---
title: An HTTP agent
description: Answer a probe and a task request. RigorRun hands each case an MCP address to work through; your agent keeps its own loop.
---

RigorRun posts each case to your endpoint as `rigorrun/agent/2`, hands it an MCP address scoped to
that one case, and waits. Your agent runs its own loop and says when it is finished.

## A complete server

This runs as it is — `node server.mjs` — and is checked against RigorRun on every change, so it
cannot quietly stop being the protocol.

```js
// server.mjs
import { createServer } from 'node:http';

// Your agent. Give it the instruction, the inputs and the rules a person
// confirmed, and let it call tools through the MCP server at mcpUrl — an
// ordinary streamable-HTTP MCP endpoint that exists for this one case.
async function yourAgent(task, mcpUrl) {
  return `Read ${Object.keys(task.inputs).length} input(s) and did nothing yet (${mcpUrl ? 'tools ready' : 'no tools'}).`;
}

createServer(async (req, res) => {
  const body = JSON.parse(await readBody(req));
  const answer = body.probe
    ? // The probe: answer without doing any work.
      { ok: true, agent: { name: 'my-agent', version: '1.0.0' } }
    : // A case. `output` is shown next to what actually happened and never scored.
      { status: 'completed', output: await yourAgent(body.task, body.environment.mcpUrl) };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(answer));
}).listen(Number(process.env.PORT ?? 7801), '127.0.0.1');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => resolve(text));
    req.on('error', reject);
  });
}
```

Add it in the interface at the agent step (**It listens on an address**, `http://127.0.0.1:7801`) and
press **Check it answers**.

## The two requests

The probe comes first, and a URL that merely parses is not a connection:

```json
{ "protocol": "rigorrun/agent/2", "probe": true }
```

answered with `{ "ok": true }`. Then one request per case:

```jsonc
{
  "protocol": "rigorrun/agent/2",
  "caseId": "case_live__existing_bookingId_BKG-4002",
  "task": {
    "instruction": "Confirm a held booking.",
    "inputs": { "bookingId": "BKG-4002" },
    "policyBrief": "…the rules a person confirmed…"
  },
  "environment": { "mcpUrl": "http://127.0.0.1:41925/mcp/9f2c…", "expiresAt": "…" },
  "maxSteps": 20
}
```

answered with `{ "status": "completed" | "failed", "output": "…" }`.

## Timeouts

Each case has a step budget and a time budget. An agent that stops answering ends that case as timed
out rather than hanging the run, and whatever it managed to do first is already in the evidence.

## Where it may listen

Loopback. An agent under test usually holds credentials for the system it is tested against, so
exposing it on every interface is a decision for a person, not a default.
