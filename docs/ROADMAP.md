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
  2025-11-25. Tool annotations are carried as the server's claims, never acted
  on, and checked: a tool that says it only reads and then changes something a
  nominated read can see is reported.
- An OpenAPI connector, and an agent that is a command rather than a service.
  Both arrive at the same engine as MCP does.
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
- A CLI gate with a usable exit-code contract, asserted at the end of the same
  browser journey that sets a project up.
- Credentials in the operating system's own store where there is one, and
  RigorRun saying which one it actually got.
- A store that survives the process being killed: atomic writes, a project that
  says it is damaged rather than disappearing, a copy taken before any
  migration, and servers a crash left running ended by the next start.
- Projects that can leave the machine — `backup`, `restore`, `export-project`,
  `import-project` — carrying credential *names* and never values, and inert
  on arrival until somebody has read the command their connector would run.

**The engine underneath**, unchanged and still true: one compiler over five
bundled workflows and a sixth that exists only inside a test file, with a build
check that fails if a business noun reaches generic code.

## What is honestly not built

~~**No OpenAPI connector.**~~ Built. An HTTP API with an OpenAPI 3 document is
connected the same way an MCP server is, and everything after the connection is
the same code — `docs/OPENAPI_ENVIRONMENT.md`. What it does not have yet: an
OAuth flow (a static header is the only authentication), remote `$ref`
resolution, and a reset that is an API operation rather than an MCP tool.

~~**No browser execution lane.**~~ Built — `docs/BROWSER_ENVIRONMENT.md`. An
agent that works by clicking can be watched doing it, and a browser cannot
verify itself: without something readable attached, every verdict from one says
`OBSERVATIONAL`, and the type will not let a browser be its own verifier. What
is missing: a recorder for somebody's own browser, file upload, and stored
logins.

~~**No CLI agent adapter.**~~ Built. An agent that is a command reads one line
of JSON and writes one back — `docs/CLI_AGENT.md`. It gets the same per-case
MCP endpoint and produces the same evidence as one behind a URL, and a command
can still only come from a person at this machine.

~~**No Python SDK.**~~ Built — `docs/PYTHON_AGENT_SDK.md`. Standard library
only, because an agent under test should not have to reconcile its dependencies
with its test harness's. Not on PyPI: it is one file with no dependencies, so
copying it is a reasonable install until there is a reason it is not.

~~**No trace import, and no OpenTelemetry ingest.**~~ Built —
`docs/TRACE_IMPORT.md`. An OpenTelemetry trace of a production failure becomes a
permanent case, with only the *situation* taken from the trace and what should
have happened computed from the confirmed rules. What is missing: importing
RigorRun's own run artefacts, and any way to recover a starting state from
telemetry — which is not an oversight, because telemetry describes what an agent
did and never what the system held.

~~**No way to test an agent RigorRun cannot start.**~~ Built —
`docs/DRIVEN_AGENT.md`. An agent behind a login, in a notebook, or on
infrastructure that will not take an inbound request now works: RigorRun
prepares the world, publishes one case, and waits for whoever is driving to do
it. Everything after that — the proxy, the step budget, the evidence, the
verdict — is the same code. What is missing: the waiting slot lives in the
running process, so a runner that restarts mid-run has nothing waiting.

~~**No OAuth for MCP, only a static header.**~~ Built —
`docs/MCP_ENVIRONMENT.md`. A hosted MCP server that answers a 401 with
`WWW-Authenticate` is discovered, registered with, and signed in to in a
browser with PKCE, and the tokens go into the credential store rather than the
project. The redirect comes back to a loopback listener that lives for the
length of one sign-in. What is missing: the same for the OpenAPI connector,
which is still a static header.

**A system whose reads answer in prose cannot be verified.** RigorRun reads
structure and never prose. It now says so when the reads are nominated, rather
than at the end — but it is a real limit, and a large share of MCP servers in
the wild are on the wrong side of it.

**Not yet published to npm.** The package builds, packs, installs into a clean
directory, runs, and completes the whole fresh-user journey from the tarball —
`pnpm verify:package` says so and prints the publish command. Until somebody
runs it, `npx rigorrun@alpha` is a promise the registry cannot keep.

**No cloud sync, and the control plane is unused.** A real D1-backed service is
deployed and tested and nothing in the product calls it. Either it becomes
opt-in sync or it should be deleted.

**A live connection does not survive the runner stopping.** Discovery and an
unfinished recording do — they are files under `~/.rigorrun`, and a reload
mid-recording resumes where you were, proved in a browser by
`e2e/external-user.spec.ts`. What is gone when the runner stops is the child
process behind a local MCP server. The project page says so and offers
**Reconnect**, which also reports anything that changed about your tools while
it was closed.

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
2. **Publishing the SDKs.** Every workspace package is `private: true`, so the
   ten-line TypeScript agent SDK cannot be installed by anybody. The Python one
   is a file to copy, which is fine and is not the same as a package.
3. **A headless setup path.** Running and gating a project works from CI;
   creating one does not. A `rigorrun project import` taking a description file
   would make a project reproducible from a repository.
4. **Reconnect without a round trip.** Discovery and recordings persist now, so
   what is left is the child process behind a local MCP server: the runner
   stopping means somebody presses **Reconnect** before they can run. Holding
   the connection across a restart, or reopening it on demand, would remove the
   last step nobody asked for.
5. **A Python agent SDK.** The protocol is a line of JSON each way, so this is
   a small package rather than a port — but "small" is not "written".
6. **Decide about the control plane.** It is deployed, tested, and called by
   nothing. Either it becomes opt-in sync for teams who want a shared history,
   or it should be deleted.
