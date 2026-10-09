# Local scripted HTTP controls

These deterministic, model-free test controls are independent of RigorRun. They
use only public task inputs and live MCP results. They never read suite files,
assertions, case IDs or expected verdicts. They are test equipment, not an LLM
agent or a supported production support implementation.

Start the newly built/installed CLI's Helpdesk twin, then:

```sh
node fixtures/external/helpdesk-release-control/server.mjs --mcp http://127.0.0.1:12113/mcp --mode scoped --port 12114
```

The endpoint accepts `{"probe":true}` without work and a normal task envelope,
returns `{"message":"..."}`, and talks directly to the local twin. Its deliberately
inaccurate claim demonstrates why a reply is separate from observed state.
It needs Node 22 and no dependencies or private credentials. The public synthetic
Helpdesk credentials are fixture data. Only HTTP loopback twin URLs are accepted.

Modes: `scoped`, `overbroad`, `refusal`, `reads`, `writes`, `leak`,
`wrong-recipient`, `deletes`. Fault modes deliberately violate a boundary or leave
permitted tasks undone. RigorRun judges the twin's tables, access log and outbox.
Use your own candidate endpoint for an actual release decision.
