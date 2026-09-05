# Connecting your agent over HTTP

`rigorrun/agent/2`. RigorRun posts one task, hands over an MCP endpoint scoped
to that task, and waits. Your agent runs its own loop.

The earlier protocol (`rigorrun/agent/1`) makes RigorRun the driver: it posts
the task and the history so far, and your agent replies with one tool call at a
time. That is the right shape for an agent written against it and the wrong
shape for one that already exists, because every real agent already has a loop.

## The probe

Before RigorRun will call your agent connected, it sends:

```json
{ "protocol": "rigorrun/agent/2", "probe": true }
```

Answer without doing any work:

```json
{ "ok": true, "agent": { "name": "booking-agent", "version": "1.0.0" } }
```

A URL that merely parses is not a connection. This is what stops an agent being
marked connected because somebody typed something plausible, and then failing a
benchmark half an hour later with the blame in the wrong place.

## A task

```jsonc
{
  "protocol": "rigorrun/agent/2",
  "caseId": "case_live__existing_bookingId_BKG-4002",
  "task": {
    "instruction": "Confirm a held booking.",
    "inputs": { "bookingId": "BKG-4002" },
    "policyBrief": "…the rules a person confirmed…"
  },
  "environment": {
    "mcpUrl": "http://127.0.0.1:41925/mcp/9f2c…",
    "expiresAt": "2026-02-01T09:12:00.000Z"
  },
  "maxSteps": 20
}
```

`policyBrief` is public on purpose: an agent that is not told the rules is being
tested on guessing them. The *assertions* remain private.

## The answer

```json
{
  "status": "completed",
  "output": "Confirmed BKG-4002 (deposit 250).",
  "usage": { "promptTokens": 1840, "completionTokens": 210 },
  "costUsd": 0.0004
}
```

`output` is recorded, shown next to what actually happened, and never scored.
There is nothing to gain by being generous and nothing to lose by being honest.

A timeout is a result, not a crash: an agent that never finishes has failed the
case, and whatever it managed to do first is already in the evidence.

## Where it may listen

Loopback by default. An agent under test usually holds credentials for the
system it is being tested against, so exposing it on every interface should be
a decision somebody makes rather than a default they inherit.

## Doing it in ten lines

See [TYPESCRIPT_AGENT_SDK.md](TYPESCRIPT_AGENT_SDK.md).
