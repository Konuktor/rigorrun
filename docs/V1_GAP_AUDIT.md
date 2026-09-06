# v1 gap audit

Written against commit `7ef0750` on 6 September 2026 by walking the product
rather than by reading its tests, and re-answered at `v0.1.0` against what the
public registry serves.

**A test passing is not evidence a capability exists.** A test proves that a
path works when called the way the test calls it. Half the entries below were
marked down after doing the thing by hand and finding a step nobody had ever
had to take — the install command that 404s is the largest, and it is green in
a test that asserts the *documentation* says it.

So each row names what was actually done. Where the evidence is a command, it
is one you can run.

| Mark | Means |
| --- | --- |
| **WORKING** | A person outside this repository can do this, against their own system. Checked by doing it. |
| **PARTIAL** | Real, reachable, and narrower than the sentence describing it. The narrowing is named. |
| **DEMO-ONLY** | Works, and only for material that ships inside RigorRun. |
| **BROKEN** | Documented, reachable, and does not work. |
| **MISSING** | Not built. |

---

## The thing that was broken

**Installing it. Was BROKEN. Now WORKING.**

For the whole of this project's life, every install instruction in it pointed
at a package that did not exist. That is fixed:

```console
$ npm view rigorrun version
0.1.0
$ npm view rigorrun dist-tags
{ latest: '0.1.0' }
```

Checked the way it matters — a clean `HOME`, a clean npm cache, a directory
that is not this repository, nothing linked:

```console
$ npx --yes rigorrun --version
0.1.0
```

The cache that run created holds
`https://registry.npmjs.org/rigorrun/-/rigorrun-0.1.0.tgz` with the same
integrity hash the registry publishes, so that command genuinely fetched the
public artifact rather than anything local.

**The SDKs are still BROKEN, for the original reason.** All seventeen workspace
packages remain `private: true`. `docs/TYPESCRIPT_AGENT_SDK.md` opens with an
`npm i @rigorrun/agent-sdk` that resolves only inside this checkout. The Python
SDK is standard-library only and can be vendored by copying one file, which is
the only SDK anybody outside can use today.

---

## Getting to a verdict

| Capability | Mark | How it was checked |
| --- | --- | --- |
| One command starts a runner, which prints a URL and opens a browser | **WORKING** | `npx rigorrun` from the public registry, in a clean `HOME` and cache; it prints a paired URL and serves an interface. A headless box gets the URL printed, which is the only fallback that works everywhere. |
| Connect an MCP server on this machine (stdio) | **WORKING** | Against `@modelcontextprotocol/server-filesystem` and `server-memory` from npm, unmodified — software nobody here wrote. `docs/THIRD_PARTY_DOGFOOD.md`. And, from the registry-installed package, against a lending desk written for the occasion in a business RigorRun has never seen: seven tools discovered, four rules learned from one demonstration, a verdict, and a regression caught. |
| Connect a remote MCP server (streamable HTTP) | **WORKING** | Against a server in its own process over real HTTP. |
| Sign in to an MCP server that requires OAuth | **WORKING** | Against an authorization server that issues metadata, registers dynamically, and checks the PKCE challenge, with the MCP server behind a gateway that answers 401 the way a resource server must. Tokens land in the credential store; a second connection opens no browser. |
| Connect an HTTP API from an OpenAPI 3 document | **WORKING** | JSON natively, YAML when the optional dependency is present. No discovered write endpoint is ever called during setup. |
| Connect a web application through a browser | **PARTIAL** | Works, and a browser cannot verify itself: without a readable system attached, every verdict from one says `OBSERVATIONAL`, and the type refuses to let a browser be its own verifier. That is the honest ceiling, not a gap to close. |
| Teach one job by doing it, and have it survive a reload | **WORKING** | Demonstrated in a browser, page reloaded mid-recording, resumed. A read-only recording resumes too — that took a fix, because "no entries yet" had been read as "no recording". |
| A contract compiled from that job, with every rule traceable | **WORKING** | Each rule names the step it came from; unconfirmed rules explore and do not gate. |
| Counterfactual cases, and checks synthesised from confirmed rules | **WORKING** | Produced from one demonstration against a system RigorRun did not author. How many of the ten categories appear depends on what the job touched: nine for the bundled refund workflow, fewer for a job of two steps. |
| A verdict that leads with the decision | **WORKING** | `SAFE TO SHIP? YES / CONDITIONAL / NO`, where CONDITIONAL is the common case against a real system, because verification is `PARTIAL` and it says so on the same line as the answer. |
| Per-failure evidence a person can act on | **WORKING** | The task, what the agent saw, what it did, what changed, which rule failed, what should have happened, and which tier verified it. The agent's own account is shown separately and never scored. |
| Break the agent, see which case regressed | **WORKING** | Driven in a browser end to end, and from the command line. |
| Gate a build on it | **WORKING** | `rigorrun gate --project …` with exit codes 0 passed, 1 the agent failed, 2 the setup is wrong. A build server cannot tell those apart from prose. |

---

## Trusting the verdict

| Capability | Mark | How it was checked |
| --- | --- | --- |
| Say how strongly a run was verified | **WORKING** | `AUTHORITATIVE` / `PARTIAL` / `OBSERVATIONAL`, computed from what the connected system can actually read back, and shown beside the verdict rather than in a log. |
| Say whether cases were isolated | **WORKING** | `RESET` or `NONE`, and a system with no reset is refused repeat mutating cases rather than quietly running them. |
| Refuse to write against production | **WORKING** | A project marked production cannot have its suite quality-checked (that runs it several times, and most of those runs write) and cannot mutate at all. |
| Annotations treated as claims, not permissions | **WORKING** | `readOnlyHint` and friends are shown with their source named and never enforced against. When a tool claimed read-only and state changed anyway, that is recorded as a mismatch. |
| Measure whether the suite would catch a worse agent | **WORKING** | Mutation testing with a `must_survive` control, reported as kill rate and independent kill rate, in the interface where somebody deciding whether to trust the suite is looking. |
| The evidence hierarchy | **PARTIAL** | `STATE`, `EVENT`, `OUTPUT`, `HUMAN`, `MODEL` exist and the tier is shown beside every check. Only `STATE` and `EVENT` are ever emitted: nothing produces a `model_judged` or `human_review` evaluator, so three of the five tiers are unreachable today. |
| A verdict against a real system is AUTHORITATIVE | **PARTIAL, by design** | It is `PARTIAL`. RigorRun reads back what the nominated reads return and no more, and says so. Claiming otherwise would be the single most damaging thing this product could do. |

---

## Keeping the work

| Capability | Mark | How it was checked |
| --- | --- | --- |
| Work survives a restart | **WORKING** | The runner is killed with SIGKILL mid-flow and restarted; the project, the recording and the suite are all there. |
| A damaged file is reported, not silently dropped | **WORKING** | A project file corrupted on purpose comes back as a broken project naming the file, rather than the project vanishing from a product whose promise is that your work survives. |
| Writes cannot be half-applied | **WORKING** | Every write is to a temporary file, fsynced, renamed, and the directory fsynced. |
| Back up, restore, export and import a project | **WORKING** | `rigorrun backup`, `restore`, `export-project`, `import-project`. Secrets are excluded from an export unless asked for. |
| An imported project is inert until somebody agrees to it | **WORKING** | A connector that arrived in a file is a command to run or a URL to open with your credentials. It is refused until somebody has seen it in full and said yes — a refusal, not a warning, because opening it *is* the harmful act. |
| Credentials in the OS keychain | **WORKING** | macOS Keychain, libsecret, Windows DPAPI, with an owner-only file when none is present. The backend is chosen by a write-read-delete round trip rather than by platform name, and `rigorrun doctor` says which one you got. |
| No command prints a secret | **WORKING** | There is deliberately none. `rigorrun secrets set` refuses a value on the command line, because that is shell history. |
| Orphaned servers are cleaned up | **WORKING** | Measured, not assumed: four children survived `kill -9` of the runner. The next runner finds and ends them. |

---

## Ways in for an agent

| Capability | Mark | How it was checked |
| --- | --- | --- |
| An HTTP endpoint | **WORKING** | The agent answers one JSON request per case. |
| A command on this machine | **WORKING** | One line of JSON in, one out. Only a command a person typed at this machine can run — never one from a benchmark file, tool output, remote config or an imported trace. |
| A TypeScript SDK | **PARTIAL** | Ten lines, real, and not installable — see the broken row at the top. |
| A Python SDK | **WORKING** | Standard library only; an agent exception becomes a failed case, not a transport error. |
| An agent RigorRun does not launch, pulling cases and pushing results | **WORKING** | A driver holding that agent's key asks for work, does it through the MCP endpoint it is handed, and posts a result. Driven end to end against the booking agent, over HTTP, with the key proven not to authorise anything else. `docs/DRIVEN_AGENT.md`. |

---

## Living with it

| Capability | Mark | How it was checked |
| --- | --- | --- |
| Turn a production failure into a permanent case | **WORKING** | An OpenTelemetry trace becomes a case: only the *situation* comes from the trace, and what should have happened is computed from the confirmed rules. |
| Infer state from telemetry | **MISSING, deliberately** | Telemetry describes what an agent did and never what the system held. Reading authoritative state out of it would be a guess wearing a verdict's clothes. |
| Reconnect after the runner stops | **PARTIAL** | Discovery and an open connection do not survive the runner stopping; reconnecting reports anything that changed about the tools while you were away. |
| Set a project up from the command line | **MISSING** | Connecting and teaching are interface-only. Running, gating and comparing are not — which is the half CI needs. |
| More than one demonstration per contract | **MISSING** | Rules come from a single recording. |
| More than one person | **MISSING** | The runner is one person's process on one machine. |
| Cloud sync | **MISSING, and now deliberately so** | The control plane was deployed and called by nothing, so it was deleted rather than shipped. There is no cloud sync and no hosted component. Recoverable from git history. |
| Induction proposes only rules worth confirming | **PARTIAL** | It over-produces: roughly a quarter of proposed rules get discarded during review. Reviewing is the point, and this is still more work than it should be. |
| OAuth for the OpenAPI connector | **PARTIAL** | `client_credentials` works: the token endpoint is read out of the document, the token is exchanged once and replaced when the API refuses it. A flow that ends in a browser is not built there, because it is the flow an API under test almost never uses. |

---

## How to reproduce any of this

```bash
pnpm verify:package   # build, pack, install clean, run, fresh-user journey, audit, SBOM
pnpm e2e:external     # a stranger, in a browser, own system, own agent, regression, CI gate
pnpm e2e:restart      # SIGKILL the runner mid-flow; resume; corrupt a file on purpose
pnpm test             # unit and integration, including two public MCP servers from npm
pnpm domain           # no business noun in generic code
```

The screenshots in `docs/external-user-run/` are what the person in
`pnpm e2e:external` actually saw, regenerated at the commit they document.
