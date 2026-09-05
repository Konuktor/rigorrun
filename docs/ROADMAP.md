# Roadmap

What exists, what does not, and what comes next. The point of this page is that
the second list is honest.

## What works today

**For somebody who is not us.** A person can install nothing but this
repository, start the runner, connect their own MCP server, teach it one job
through that system's own tools, review what it worked out, rule on it,
generate a suite, connect their own agent, and get a pass or fail read back
from their own system. Then break the agent, run again, and be told which case
regressed. `e2e/external-user.spec.ts` does exactly that in a browser against
two packages that import nothing from RigorRun.

- A real MCP client, stdio and streamable HTTP, on SDK 1.30 / protocol
  2025-11-25. Tool annotations are carried as the server's claims and never
  acted on.
- Record schemas induced from what a system hands back, using structure only —
  never field names — with everything structure cannot settle asked as a
  question carrying its evidence.
- An MCP proxy, so an agent that already speaks MCP is tested by being given a
  URL, with no rewrite and no SDK.
- An agent protocol where the agent owns its loop, a probe that must be
  answered before anything is called connected, and a ten-line TypeScript SDK.
- Projects that persist, with credentials in one owner-only file and never in
  the project.
- Capability-tiered environments: a verdict says whether the system was read
  back in full, in part, or not at all, and whether cases were isolated.
- Run-to-run comparison that names the case that regressed.
- A CLI gate with a usable exit-code contract.

**The engine underneath**, unchanged and still true: one compiler over five
bundled workflows and a sixth that exists only inside a test file, with a build
check that fails if a business noun reaches generic code.

## What is honestly not built

**No OpenAPI connector.** MCP is the only way to connect a system. A REST API
has to be wrapped.

**No browser execution lane.** An agent that only works by clicking cannot be
tested. This remains the largest single gap for anybody whose system has no
API.

**No CLI agent adapter.** `AgentKind` has declared `'process'` for months with
nothing behind it. An agent that is a local command has to be wrapped in the
HTTP SDK.

**No Python SDK.**

**No trace import, and no OpenTelemetry ingest.** Everybody starts from zero.

**Nothing is published to npm.** `npx rigorrun` is what the docs will say; today
it is a clone and `pnpm rigorrun`.

**No cloud sync, and the control plane is unused.** A real D1-backed service is
deployed and tested and nothing in the product calls it. Either it becomes
opt-in sync or it should be deleted.

**Discovery and recordings live in memory.** Reloading the page mid-flow loses
the open connection and an unfinished recording. The interface says so and
offers the way back rather than looking broken, but it is a limitation.

**No multi-user anything.** The runner is one person's process on one machine.

**Induction over-produces**, and roughly a quarter of confirmed rules turn out
to decide anything on the generated cases. Reported on `/proof`, not fixed.

**One recording, one contract.** Rules come from a single demonstration.

### Near term

1. **Playwright execution lane.** Same cases, same checks, driven through a
   real UI, with verification still going through the adapter rather than the
   DOM.
2. **A second recording per workflow**, and cross-demonstration recall as the
   headline generalisation number.
3. **Rule consolidation.** Three-quarters of confirmed rules never decide
   anything. Merging or dropping them at compile time would make review
   shorter and the suite sharper.
4. **Importing a policy document** so a threshold has better provenance than a
   sentence on a page.

### Medium term

5. **Regression tracking.** Which case started failing, on which agent version.
6. **A model judge, properly.** Never as arbiter: a second opinion that can
   only flag a deterministic PASS for human review, never overturn a FAIL.
7. **Signed reports.**
8. **A recorder that is not Chrome-only.**

### Longer term

9. **The independent verification layer for AI labour.** The unit of trust in
   agent procurement should be "verified against the buyer's own workflow", not
   "scored well on a public benchmark".
10. **Portable workflow contracts** a buyer can hand to three vendors.
11. **Continuous verification** on every agent update.

## Explicitly not planned

- A public model leaderboard. The value is that the benchmark is private.
- Production trace ingestion as the primary input. Working *before* there is
  traffic is the whole idea.
- A model that writes test cases.
- Production observability. Different product, different buyer.
- An agent framework.

## Next, in the order it would matter

1. **Publish to npm.** `pnpm dlx rigorrun` is the single largest piece of
   friction between this and a stranger using it, and it is not a technical
   problem.
2. **An OpenAPI connector.** MCP being the only path means anybody whose system
   is a REST API has to write a server first. OpenAPI is also the easier
   induction problem, because the schemas arrive declared rather than inferred.
3. **A headless setup path.** Running and gating a project works from CI;
   creating one does not. A `rigorrun project import` taking a description file
   would make a project reproducible from a repository.
4. **Persist discovery.** A page reload mid-flow loses the open connection and
   an unfinished recording. The interface handles it honestly and a person
   still repeats a step.
5. **The browser execution lane.** Still the largest gap for anybody whose
   system has no API at all, and still the hardest verification story: DOM text
   is not authoritative state.
6. **Decide about the control plane.** It is deployed, tested, and called by
   nothing. Either it becomes opt-in sync for teams who want a shared history,
   or it should be deleted.
