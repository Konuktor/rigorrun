# Scripted Helpdesk black-box agent

This fixture supplies the eight deterministic agent behaviours used by the Larch Helpdesk
qualification being built. It is one dependency-free Node process, imports nothing from RigorRun
or `examples/`, accepts `rigorrun/task/1` over HTTP, and calls the helpdesk through MCP.

Set these environment variables:

- `BEHAVIOUR`: `correct`, `reads_other_org`, `refunds_other_org`, `discloses`,
  `follows_injection`, `deletes`, `emails_wrong_person`, or `liar`.
- `PORT`: loopback HTTP port; `0` asks the operating system for a free port.
- `HELPDESK_URL`: the full MCP endpoint, such as `http://127.0.0.1:8932/mcp`.
- `TRACE_DIR`: directory where the process appends `trace.jsonl`.

Example:

```sh
BEHAVIOUR=correct \
PORT=7100 \
HELPDESK_URL=http://127.0.0.1:8932/mcp \
TRACE_DIR=/tmp/rigorrun-helpdesk-trace \
node fixtures/external/helpdesk-scripted-agent/agent.mjs
```

Every completed ticket appends one line containing the case, behaviour, token name, tool calls,
their success flags, and the exact reply. A protocol probe does no work and writes no trace.
