# RigorRun — build status

Updated against executed commands, not intent.

There are two tiers here and the order matters. The **product gate** measures
whether somebody who has never seen this source can use RigorRun. The
**technical gates** measure whether RigorRun works on material that ships inside
RigorRun. Both are worth having; only one of them is the point, and a release
where only the second is green is not a release.

## Installation gate

| What | Command | Result |
| ---- | ------- | ------ |
| The published package builds, packs, contains only what it should, carries no credentials, installs into a clean directory, runs, explains itself on an old Node, and completes the fresh-user journey | `pnpm verify:package` | see below |

It publishes nothing. Its last line says whether publishing would be safe, and
prints the exact command.

## Product gate

| What | Command | Result |
| ---- | ------- | ------ |
| A stranger connects their own system and their own agent, in a browser, from nothing, and gets a verdict — then breaks the agent and is told which case regressed | `pnpm e2e:external` | passing |

That test starts the runner exactly as the quickstart says to, pairs through
the URL it prints, and drives Chromium. The system it connects is
`fixtures/external/mcp-venue-desk` — a separate package, spawned as a child
process, reached over MCP, importing nothing from RigorRun. The agent is
`fixtures/external/booking-agent` — a separate process that drives itself
through the proxy with its own MCP client and touches RigorRun only through the
public agent SDK. Screenshots of what the person saw are written to
`docs/external-user-run/`.

## Technical gates

| Layer | Command | Result |
| ----- | ------- | ------ |
| Design tokens | `pnpm contrast` | 45/45 pairs meet WCAG contrast |
| Lint | `pnpm lint` | clean |
| Types | `pnpm typecheck` | clean |
| Generic core stays generic | `pnpm domain` | 13 packages checked against 19 business nouns |
| Unit + integration | `pnpm test` | 638 passing across 42 files |
| Build | `pnpm build` | all apps, CLI and extension |
| Local E2E | `pnpm e2e` | 23 passing |
| Accessibility | `pnpm a11y` | 16 passing, zero WCAG A/AA violations |
| Production smoke | `pnpm smoke:prod` | 5 passing |

## What the product does now

A person starts a local runner, connects their own MCP server, does one job
through that system's own tools while RigorRun watches, corrects the handful of
things structure could not settle, rules on the rules it proposes, and gets an
executable suite. They point their own agent at it — any agent that speaks MCP
works unchanged — and get a pass or fail read back from their own system, with
how it was reached beside it and every gap it could not cover named.

Then they change the agent, run again, and are told which case regressed.

## What it does not do

In full in `docs/ROADMAP.md`. The load-bearing ones: MCP is the only connector,
there is no browser execution lane, nothing is published to npm, setting a
project up is interface-only, and a verdict from a real system is `PARTIAL`
rather than `AUTHORITATIVE` because RigorRun reads back what the nominated
reads return and no more.

`docs/PRODUCT_REALITY_AUDIT.md` answers twenty questions about what an external
person can do, before and after this work.

## Deployed

| | |
| --- | --- |
| Landing, quickstart, `/proof` and the bundled example | <https://rigorrun.pages.dev> |
| Northstar Support (the example's app) | <https://rigorrun-crm.pages.dev> |
| Four schema-driven systems | <https://rigorrun-ops.pages.dev> |
| Control plane | <https://rigorrun.takhiroverbol.workers.dev> — deployed, tested, and called by nothing |

The product itself is not on any of these. It is served by the runner on the
machine that has the systems, because a page on `https` cannot reach
`http://127.0.0.1` and most of what people want tested is only reachable from
there.
