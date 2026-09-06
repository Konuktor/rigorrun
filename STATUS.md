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
| A stranger connects their own system and their own agent, in a browser, from nothing, reloads the page halfway through, gets a verdict, asks a failing case what happened, changes the agent, is told which case regressed, and gates it from the command line | `pnpm e2e:external` | passing |
| Their work survives the runner being killed with SIGKILL, and a damaged file is reported rather than silently dropped | `pnpm e2e:restart` | passing |
| RigorRun connects to a public MCP server nobody here wrote, and says out loud what it cannot verify about it | `pnpm test` (`*/test/thirdParty.test.ts`) | passing |
| And goes all the way to a verdict against a second one, whose reads answer in records | `pnpm test` (`publicServerJourney.test.ts`) | passing |

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
| Generic core stays generic | `pnpm domain` | 23 directories, 19 business nouns and 2 currency shapes |
| Unit + integration | `pnpm test` | 765 passing across 63 files, plus 8 in Python |
| Build | `pnpm build` | all apps, CLI and extension |
| Local E2E | `pnpm e2e` | 25 passing |
| Accessibility | `pnpm a11y` | 16 passing, zero WCAG A/AA violations |
| Production smoke | `pnpm smoke:prod` | 5 passing |

## What the product does now

A person starts a local runner and connects their own system — an MCP server,
an HTTP API with an OpenAPI document, or a web application through a browser. They do one job through that system's
own tools while RigorRun watches, correct the handful of things structure could
not settle, rule on the rules it proposes, and get an executable suite. Before
trusting it they can have RigorRun break agents on purpose and report how many
the suite caught.

They point their own agent at it — any agent that speaks MCP works unchanged,
whether it listens on an address or is a command RigorRun runs, in TypeScript
or Python or anything that can write a line of JSON — and get **safe
to ship: yes, conditional or no**, read back from their own system. Every case
can be asked what happened: which check failed and which tier of evidence
decided it, what the agent called, what the system said afterwards, and
separately, never scored, what the agent said it did.

Then they change the agent, run again, and are told which case regressed. And
gate a build on it from the command line, against the project they set up in
the browser.

When something goes wrong in production later, an OpenTelemetry trace of it
becomes a permanent case — with only the *situation* taken from the trace, and
what should have happened worked out from the rules they confirmed.

## What it does not do

In full in `docs/ROADMAP.md`. The load-bearing ones: nothing is published to
npm, so every install command in this repository still 404s; the SDKs are all
`private: true`, so the ten-line agent SDK cannot be installed by anybody;
setting a project up is interface-only; and a verdict from a real system is
`PARTIAL` rather than `AUTHORITATIVE`, because RigorRun reads back what the
nominated reads return and no more.

A browser is weaker again. It cannot check its own work — a page saying "done"
is a claim by the system that would have to be wrong for it not to be done — so
a verdict from one says `OBSERVATIONAL` unless something readable is attached
to the same system.

Two limits found by pointing it at systems nobody here wrote, both documented
rather than worked around. A system whose reads answer in prose cannot be
verified — RigorRun reads structure and never prose, and says so when the reads
are nominated rather than after somebody has demonstrated a job. And a
contradiction between what a system claims about a tool and what it does can
only be seen through a nominated read: a change nothing reads is a change
nobody can observe.

`docs/V1_GAP_AUDIT.md` marks every capability WORKING, PARTIAL, DEMO-ONLY,
BROKEN or MISSING, checked by walking the product rather than by reading its
tests. `docs/PRODUCT_REALITY_AUDIT.md` is the earlier one, answering twenty
questions about what an external person could do before and after that work.

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
