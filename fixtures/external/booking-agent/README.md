# Booking agent — an agent RigorRun did not write

A customer's own agent. It owns its loop, speaks MCP, and touches RigorRun in
exactly one place: `src/main.ts` wraps it in `defineAgent` and serves it.

```bash
cd fixtures/external/booking-agent
pnpm install
pnpm start                                    # careful, on 127.0.0.1:8900
RIGORRUN_AGENT_BEHAVIOUR=careless pnpm start  # with the bug
```

`careless` skips the deposit check before confirming. That is the regression
the dogfood test introduces on purpose, and what RigorRun has to notice without
being told.
